"""인증: 가입(원자 트랜잭션)·로그인·refresh·비번변경/재설정. specs S00 · 01-상세설계 §5."""
import secrets
import datetime as dt
from fastapi import APIRouter, HTTPException, Response, Cookie
from pydantic import BaseModel, EmailStr, Field
from ..core import security
from ..core.db import tx, pool
from ..core.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)          # 서버측 8자 검증(S00 §3.2)
    name: str
    office_name: str | None = None
    terms_agreed: bool = False                   # 약관 동의 게이팅


class LoginIn(BaseModel):
    email: EmailStr
    password: str
    remember: bool = True                        # 미체크=세션쿠키(로그인 유지 off)


class TokenOut(BaseModel):
    access_token: str
    tier: str


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
    access = security.make_access(acc["id"], row["team_id"], row["role"], acc["tier"])
    _set_refresh(resp, acc["id"], remember)
    return TokenOut(access_token=access, tier=acc["tier"])


@router.post("/signup", response_model=TokenOut)
async def signup(body: SignupIn, resp: Response):
    if not body.terms_agreed:
        raise HTTPException(400, "약관에 동의해야 가입할 수 있습니다")
    pw = security.hash_password(body.password)
    async with tx() as conn:  # 원자: account → team → member → 체험 크레딧
        exists = await conn.fetchval("SELECT 1 FROM app.accounts WHERE email=$1", body.email)
        if exists:
            raise HTTPException(409, "이미 가입된 이메일입니다")
        acc = await conn.fetchrow(
            """INSERT INTO app.accounts(email,password_hash,name,office_name,tier,
                   trial_started_at,trial_ends_at,terms_agreed_at)
               VALUES($1,$2,$3,$4,'trial',now(),now()+interval '1 month',now())
               RETURNING id, tier""",
            body.email, pw, body.name, body.office_name,
        )
        team_name = body.office_name or f"{body.name} 팀"
        team_id = await conn.fetchval(
            "INSERT INTO app.teams(name,owner_account_id) VALUES($1,$2) RETURNING id",
            team_name, acc["id"],
        )
        await conn.execute(
            "INSERT INTO app.team_members(team_id,account_id,role) VALUES($1,$2,'owner')",
            team_id, acc["id"],
        )
        await conn.execute(
            """INSERT INTO app.credit_entries(account_id,type,bucket,amount,reason)
               VALUES($1,'grant','earned',$2,'trial')""",
            acc["id"], settings.trial_credits,
        )
    return await _issue(resp, dict(acc))


@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn, resp: Response):
    acc = await pool().fetchrow(
        "SELECT id, tier, password_hash FROM app.accounts WHERE email=$1 AND deleted_at IS NULL",
        body.email,
    )
    # 존재여부 은닉: 실패 메시지 통일(S00 §3.2)
    if not acc or not security.verify_password(body.password, acc["password_hash"] or ""):
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
    acc = await pool().fetchrow("SELECT id, tier FROM app.accounts WHERE id=$1", account_id)
    if not acc:
        raise HTTPException(401, "account not found")
    return await _issue(resp, dict(acc))


@router.post("/logout")
async def logout(resp: Response):
    resp.delete_cookie("refresh", path="/")
    return {"ok": True}


from ..core.deps import current_user, CurrentUser  # noqa: E402
from fastapi import Depends  # noqa: E402


@router.get("/me")
async def me(user: CurrentUser = Depends(current_user)):
    row = await pool().fetchrow("SELECT name, email FROM app.accounts WHERE id=$1", user.account_id)
    return {"account_id": user.account_id, "team_id": user.team_id,
            "role": user.role, "tier": user.tier,
            "name": row["name"] if row else None, "email": row["email"] if row else None}


# ── 비밀번호 변경 · 재설정 ───────────────────────────
class PwChange(BaseModel):
    current: str
    new: str = Field(min_length=8)


@router.patch("/password")
async def change_password(body: PwChange, user: CurrentUser = Depends(current_user)):
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
