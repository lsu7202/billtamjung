"""인증: 가입(원자 트랜잭션)·로그인·refresh. specs S00 · 01-상세설계 §5."""
from fastapi import APIRouter, HTTPException, Response, Cookie
from pydantic import BaseModel, EmailStr
from ..core import security
from ..core.db import tx, pool
from ..core.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])


class SignupIn(BaseModel):
    email: EmailStr
    password: str
    name: str
    office_name: str | None = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    tier: str


def _set_refresh(resp: Response, account_id: int) -> None:
    resp.set_cookie(
        "refresh", security.make_refresh(account_id),
        httponly=True, secure=True, samesite="lax",
        # path="/": dev(Vite 프록시 /api/auth/refresh)·prod(임의 프리픽스) 모두 전송되게. 그 외 경로엔 httponly라 노출 없음
        max_age=settings.refresh_ttl_days * 86400, path="/",
    )


async def _issue(resp: Response, acc: dict) -> TokenOut:
    row = await pool().fetchrow(
        "SELECT team_id, role FROM app.team_members WHERE account_id=$1 AND left_at IS NULL LIMIT 1",
        acc["id"],
    )
    access = security.make_access(acc["id"], row["team_id"], row["role"], acc["tier"])
    _set_refresh(resp, acc["id"])
    return TokenOut(access_token=access, tier=acc["tier"])


@router.post("/signup", response_model=TokenOut)
async def signup(body: SignupIn, resp: Response):
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
    return await _issue(resp, dict(acc))


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
            "name": row["name"] if row else None}
