"""인증: 가입(원자 트랜잭션)·로그인·refresh·비번변경/재설정. specs S00 · 01-상세설계 §5."""
import os
import secrets
import uuid
import datetime as dt
from fastapi import APIRouter, File, HTTPException, Response, Cookie, UploadFile
from pydantic import BaseModel, EmailStr, Field
from ..core import security, storage
from ..core.db import tx, pool
from ..core.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)          # 서버측 8자 검증(S00 §3.2)
    name: str | None = None                      # 미입력 시 이메일 앞부분(온보딩 1단계에서 수집)
    office_name: str | None = None
    phone: str | None = None                     # 선택 — 연락처
    job_role: str | None = None                  # 직군(분석용): broker|assistant|investor|landlord|etc
    referral_source: str | None = None           # 가입경로(분석용): referral|search|sns|ad|etc
    interest_region: str | None = None           # 관심 지역(자유입력)
    gender: str | None = None                    # 성별(선택): male|female|none
    terms_agreed: bool = False                   # 이용약관 동의(필수)
    privacy_agreed: bool = False                 # 개인정보 수집·이용 동의(필수)
    marketing_agreed: bool = False               # 마케팅 수신 동의(선택)
    kind: str = "중개사"                          # 계정 종류(S05 §1) — 중개사 · 고객. 고객은 팀 없이 가입한다


class LoginIn(BaseModel):
    email: EmailStr
    password: str
    remember: bool = True                        # 미체크=세션쿠키(로그인 유지 off)


class TokenOut(BaseModel):
    access_token: str


def _set_refresh(resp: Response, account_id: int, remember: bool = True) -> None:
    resp.set_cookie(
        "refresh", security.make_refresh(account_id),
        httponly=True, secure=True, samesite="lax",
        # path="/": dev(Vite 프록시 /api/auth/refresh)·prod(임의 프리픽스) 모두 전송되게. 그 외 경로엔 httponly라 노출 없음
        # remember=False → max_age 생략(세션쿠키, 브라우저 종료 시 만료)
        max_age=settings.refresh_ttl_days * 86400 if remember else None, path="/",
    )


async def _issue(resp: Response, acc: dict, remember: bool = True) -> TokenOut:
    row = await pool().fetchrow(
        "SELECT team_id, role FROM app.team_members WHERE account_id=$1 AND left_at IS NULL LIMIT 1",
        acc["id"],
    )
    # 가입 중엔 아직 커밋 전이라 풀에서 안 보인다 — 가입이 넘겨준 kind 를 먼저 쓴다(고객 토큰이 중개사로 찍히던 버그)
    kind = acc.get("kind") or await pool().fetchval("SELECT kind FROM app.accounts WHERE id=$1", acc["id"]) or "중개사"
    # 팀이 없는 계정(고객)도 들어온다 — 전엔 row 가 None 이면 500 이었다
    access = security.make_access(acc["id"], row["team_id"] if row else None,
                                  row["role"] if row else None, kind)
    _set_refresh(resp, acc["id"], remember)
    return TokenOut(access_token=access)


SIGNUP_CLOSED = "관리자만 이용 가능합니다."


@router.get("/public-config")
async def public_config():
    """로그인 화면이 가입 UI를 켤지 판단하는 공개 설정(인증 불필요)."""
    return {"signups_open": settings.signups_open}


@router.post("/signup", response_model=TokenOut)
async def signup(body: SignupIn, resp: Response):
    if not settings.signups_open:
        raise HTTPException(403, SIGNUP_CLOSED)
    if not body.terms_agreed or not body.privacy_agreed:
        raise HTTPException(400, "이용약관과 개인정보 수집·이용에 동의해야 가입할 수 있습니다")
    if body.kind not in ("중개사", "고객"):
        raise HTTPException(422, "계정 종류는 중개사 · 고객")
    pw = security.hash_password(body.password)
    async with tx() as conn:  # 원자: account → team → member(고객은 account 만)
        exists = await conn.fetchval("SELECT 1 FROM app.accounts WHERE email=$1", body.email)
        if exists:
            raise HTTPException(409, "이미 가입된 이메일입니다")
        acc = await conn.fetchrow(
            """INSERT INTO app.accounts(email,password_hash,name,office_name,phone,
                   job_role,referral_source,interest_region,gender,
                   terms_agreed_at,privacy_agreed_at,marketing_agreed_at,kind)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,
                      now(),now(),CASE WHEN $10 THEN now() END,$11)
               RETURNING id, kind""",
            body.email, pw, body.name or body.email.split("@")[0], body.office_name, body.phone,
            body.job_role, body.referral_source, body.interest_region, body.gender, body.marketing_agreed,
            body.kind,
        )
        if body.kind != "고객":
            team_name = body.office_name or f"{body.name or body.email.split(chr(64))[0]} 팀"
            team_id = await conn.fetchval(
                "INSERT INTO app.teams(name,owner_account_id) VALUES($1,$2) RETURNING id",
                team_name, acc["id"],
            )
            await conn.execute(
                "INSERT INTO app.team_members(team_id,account_id,role) VALUES($1,$2,'owner')",
                team_id, acc["id"],
            )
    # 토큰은 커밋 **뒤에** 만든다 — _issue 는 풀에서 팀 · 종류를 읽는데, 커밋 전엔 안 보여
    # 새 중개사 토큰에 팀이 비고 고객 토큰에 「중개사」가 찍혔다(2026-09-30)
    return await _issue(resp, dict(acc))


def login_blocked(email: str | None) -> bool:
    """개발서버 빗장(2026-08-20) — 허용 목록이 있으면 그 밖의 계정은 못 들어온다.

    설문 링크를 밖으로 뿌리는 동안 쓴다. 목록이 비어 있으면(운영) 아무 것도 막지 않는다.
    거절 문구는 기존과 **같게** 둔다 — 「이 계정은 막혀 있다」는 말은 계정 존재를 알려 준다.
    """
    allow = [x.strip().lower() for x in (settings.login_allow or "").split(",") if x.strip()]
    return bool(allow) and (email or "").strip().lower() not in allow


@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn, resp: Response):
    acc = await pool().fetchrow(
        "SELECT id, password_hash FROM app.accounts WHERE email=$1 AND deleted_at IS NULL",
        body.email,
    )
    # 존재여부 은닉: 실패 메시지 통일(S00 §3.2)
    if not acc or not security.verify_password(body.password, acc["password_hash"] or "") \
       or login_blocked(body.email):
        raise HTTPException(401, "이메일 또는 비밀번호가 올바르지 않습니다")
    return await _issue(resp, dict(acc), remember=body.remember)


@router.post("/refresh", response_model=TokenOut)
async def refresh(resp: Response, refresh: str | None = Cookie(default=None)):
    if not refresh:
        raise HTTPException(401, "no refresh token")
    try:
        payload = security.decode(refresh)
        assert payload.get("typ") == "refresh"
        account_id = int(payload["sub"])
    except Exception:
        raise HTTPException(401, "invalid refresh token")
    acc = await pool().fetchrow("SELECT id FROM app.accounts WHERE id=$1", account_id)
    if not acc:
        raise HTTPException(401, "account not found")
    return await _issue(resp, dict(acc))


@router.post("/logout")
async def logout(resp: Response):
    resp.delete_cookie("refresh", path="/")
    return {"ok": True}


from ..core.deps import current_user, any_user, CurrentUser  # noqa: E402
from fastapi import Depends  # noqa: E402


@router.get("/me")
async def me(user: CurrentUser = Depends(any_user)):
    row = await pool().fetchrow("SELECT name, email, job_role, job_title, gender, phone, photo_path FROM app.accounts WHERE id=$1", user.account_id)
    return {"account_id": user.account_id, "team_id": user.team_id, "job_role": row["job_role"] if row else None, "gender": row["gender"] if row else None,
            "role": user.role, "kind": user.kind,
            "name": row["name"] if row else None, "email": row["email"] if row else None,
            "phone": row["phone"] if row else None, "job_title": row["job_title"] if row else None,
            "photo": photo_url(user.account_id, row["photo_path"]) if row else None}


# ── 프로필 사진(0219) ─────────────────────────────────
# 중개사 사진은 매물 카드에 선다 — 고객도 보는 자리라 주소로 바로 열린다(<img> 는 토큰을 못 싣는다).
# 고객 사진은 남에게 안 보인다 — 주소로는 중개사 것만 열고, 본인 것은 /auth/me/photo 로 받는다.
def photo_url(account_id: int, path: str | None) -> str | None:
    """사진 주소 — 바꿀 때마다 키가 바뀌니 ?v= 로 캐시를 넘긴다"""
    return f"/api/auth/photo/{account_id}?v={path.rsplit('_', 1)[-1].split('.')[0][:8]}" if path else None


@router.post("/me/photo")
async def upload_photo(file: UploadFile = File(...), user: CurrentUser = Depends(any_user)):
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(422, "이미지 파일만 올릴 수 있습니다")
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(422, "5MB 보다 작은 사진을 올려 주세요")
    key = f"avatars/acc{user.account_id}_{uuid.uuid4().hex}{os.path.splitext(file.filename or '')[1][:8] or '.png'}"
    await storage.save(key, data, file.content_type or "image/png")
    await pool().execute("UPDATE app.accounts SET photo_path=$1 WHERE id=$2", key, user.account_id)
    return {"ok": True, "photo": photo_url(user.account_id, key)}


@router.delete("/me/photo")
async def delete_photo(user: CurrentUser = Depends(any_user)):
    await pool().execute("UPDATE app.accounts SET photo_path=NULL WHERE id=$1", user.account_id)
    return {"ok": True}


def _img(data: bytes) -> str:
    return "image/png" if data[:4] == b"\x89PNG" else "image/webp" if data[8:12] == b"WEBP" else "image/gif" if data[:3] == b"GIF" else "image/jpeg"


@router.get("/me/photo")
async def my_photo(user: CurrentUser = Depends(any_user)):
    key = await pool().fetchval("SELECT photo_path FROM app.accounts WHERE id=$1", user.account_id)
    data = await storage.load(key) if key else None
    if data is None:
        raise HTTPException(404, "사진이 없습니다")
    return Response(content=data, media_type=_img(data), headers={"Cache-Control": "private, max-age=300"})


@router.get("/photo/{account_id}")
async def broker_photo(account_id: int):
    key = await pool().fetchval(
        "SELECT photo_path FROM app.accounts WHERE id=$1 AND kind='중개사' AND deleted_at IS NULL", account_id)
    data = await storage.load(key) if key else None
    if data is None:
        raise HTTPException(404, "사진이 없습니다")
    return Response(content=data, media_type=_img(data), headers={"Cache-Control": "public, max-age=86400"})


# ── 비밀번호 변경 · 재설정 ───────────────────────────
class PwChange(BaseModel):
    current: str
    new: str = Field(min_length=8)


class ProfileIn(BaseModel):
    name: str | None = None
    job_role: str | None = None
    office_name: str | None = None
    office_status: str | None = None   # has|preparing|none
    career_years: str | None = None    # lt1|y1_3|y3_10|gt10
    prior_tools: str | None = None     # yes|no(사용 경험 유무)
    expect_feature: str | None = None  # 기대 기능: search|valuation|report|manage
    referral_source: str | None = None
    interest_region: str | None = None
    gender: str | None = None
    job_title: str | None = None       # 직급(0206) — "" 를 보내면 지운다


@router.patch("/profile")
async def patch_profile(body: ProfileIn, user: CurrentUser = Depends(any_user)):
    """온보딩(/welcome) 단계별 저장 — 보낸 필드만 갱신(소셜·이메일 가입 공통 수집 경로)."""
    sets, args = [], []
    for k in ("name", "job_role", "office_name", "office_status", "career_years", "prior_tools", "expect_feature", "referral_source", "interest_region", "gender"):
        v = getattr(body, k)
        if v is not None and str(v).strip() != "":
            args.append(v.strip()); sets.append(f"{k}=${len(args)}")
    if body.job_title is not None and body.job_title.strip() == "":
        sets.append("job_title=NULL")              # 빈 값은 지우기(클릭-편집 칸 규칙)
    elif body.job_title is not None:
        args.append(body.job_title.strip()); sets.append(f"job_title=${len(args)}")
    if not sets:
        return {"ok": True}
    args.append(user.account_id)
    await pool().execute(f"UPDATE app.accounts SET {', '.join(sets)} WHERE id=${len(args)}", *args)
    return {"ok": True}


@router.patch("/password")
async def change_password(body: PwChange, user: CurrentUser = Depends(any_user)):
    acc = await pool().fetchrow("SELECT password_hash FROM app.accounts WHERE id=$1", user.account_id)
    if not acc or not security.verify_password(body.current, acc["password_hash"] or ""):
        raise HTTPException(400, "현재 비밀번호가 올바르지 않습니다")
    await pool().execute(
        "UPDATE app.accounts SET password_hash=$1 WHERE id=$2",
        security.hash_password(body.new), user.account_id,
    )
    return {"ok": True}


class PwResetReq(BaseModel):
    email: EmailStr


@router.post("/password/reset-request")
async def reset_request(body: PwResetReq):
    """재설정 토큰 발급. 존재여부 은닉(있든 없든 동일 응답). 베타=콘솔 로그, 정식=메일 발송."""
    acc = await pool().fetchrow(
        "SELECT id FROM app.accounts WHERE email=$1 AND deleted_at IS NULL", body.email
    )
    if acc:
        token = secrets.token_urlsafe(24)
        await pool().execute(
            "INSERT INTO app.password_resets(account_id,token,expires_at) VALUES($1,$2,$3)",
            acc["id"], token, _now() + dt.timedelta(hours=2),
        )
        print(f"[비밀번호 재설정] {body.email} → 토큰: {token} (2시간 유효)", flush=True)  # 베타 발송 스텁
    return {"ok": True}


class PwResetConfirm(BaseModel):
    token: str
    new: str = Field(min_length=8)


@router.post("/password/reset-confirm")
async def reset_confirm(body: PwResetConfirm):
    async with tx() as conn:
        row = await conn.fetchrow(
            "SELECT id, account_id, expires_at, used_at FROM app.password_resets WHERE token=$1 FOR UPDATE",
            body.token.strip(),
        )
        if not row or row["used_at"] or row["expires_at"] < _now():
            raise HTTPException(400, "유효하지 않거나 만료된 재설정 링크입니다")
        await conn.execute(
            "UPDATE app.accounts SET password_hash=$1 WHERE id=$2",
            security.hash_password(body.new), row["account_id"],
        )
        await conn.execute("UPDATE app.password_resets SET used_at=now() WHERE id=$1", row["id"])
    return {"ok": True}
