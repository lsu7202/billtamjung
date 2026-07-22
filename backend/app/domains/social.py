"""소셜 로그인(카카오·네이버) OAuth — 기능목록 §1(베타, 재분류 2026-07-22).
키(BT_KAKAO_CLIENT_ID 등) 미설정 시 503. 스키마=0013_social_accounts.
토큰은 refresh 쿠키만 설정 → 프론트 부트스트랩 refresh()가 access 획득(세션유지와 동일 경로).
"""
import secrets
import urllib.parse
import httpx
from fastapi import APIRouter, HTTPException, Query, Cookie
from fastapi.responses import RedirectResponse
from ..core.db import tx
from ..core.config import settings
from .auth import _set_refresh

router = APIRouter(prefix="/auth/social", tags=["auth"])

# 제공자별 OAuth 엔드포인트·스코프. cid/secret은 런타임 조회(env 주입 반영).
PROVIDERS = {
    "kakao": {
        "authorize": "https://kauth.kakao.com/oauth/authorize",
        "token": "https://kauth.kakao.com/oauth/token",
        "profile": "https://kapi.kakao.com/v2/user/me",
        "cid": lambda: settings.kakao_client_id,
        "secret": lambda: settings.kakao_client_secret,
        "scope": "account_email",
    },
    "naver": {
        "authorize": "https://nid.naver.com/oauth2.0/authorize",
        "token": "https://nid.naver.com/oauth2.0/token",
        "profile": "https://openapi.naver.com/v1/nid/me",
        "cid": lambda: settings.naver_client_id,
        "secret": lambda: settings.naver_client_secret,
        "scope": "",
    },
}


def _redirect_uri(provider: str) -> str:
    # 브라우저 → 이 URL(프론트 오리진 /api 프록시) → 백엔드 콜백. 제공자 콘솔에 등록 필요.
    return f"{settings.frontend_base}/api/auth/social/{provider}/callback"


def _cfg(provider: str) -> dict:
    p = PROVIDERS.get(provider)
    if not p:
        raise HTTPException(404, "지원하지 않는 소셜 제공자")
    if not p["cid"]():
        raise HTTPException(503, f"{provider} 소셜 로그인 미설정(개발자센터 키 필요)")
    return p


def _parse_profile(provider: str, j: dict) -> tuple[str, str | None, str | None]:
    """제공자 프로필 → (provider_uid, email, name)."""
    if provider == "kakao":
        acc = j.get("kakao_account", {}) or {}
        return str(j["id"]), acc.get("email"), (acc.get("profile") or {}).get("nickname")
    r = j.get("response", {}) or {}                    # naver
    return str(r["id"]), r.get("email"), r.get("name") or r.get("nickname")


async def _find_or_create(conn, provider: str, uid: str, email: str | None, name: str | None) -> dict:
    """소셜 정체성 → 계정 매칭/생성(신규는 1인팀+체험크레딧, signup과 동일 프로비저닝)."""
    row = await conn.fetchrow(
        "SELECT account_id FROM app.social_accounts WHERE provider=$1 AND provider_uid=$2", provider, uid)
    if row:
        return dict(await conn.fetchrow("SELECT id, tier FROM app.accounts WHERE id=$1", row["account_id"]))

    acc = None
    if email:                                          # 같은 이메일 기존 계정에 연결
        acc = await conn.fetchrow(
            "SELECT id, tier FROM app.accounts WHERE email=$1 AND deleted_at IS NULL", email)
    if not acc:                                        # 신규: 계정→팀→멤버→체험크레딧
        acc = await conn.fetchrow(
            """INSERT INTO app.accounts(email,name,tier,trial_started_at,trial_ends_at,terms_agreed_at)
               VALUES($1,$2,'trial',now(),now()+interval '1 month',now()) RETURNING id, tier""",
            email, name or "소셜 사용자")
        team_id = await conn.fetchval(
            "INSERT INTO app.teams(name,owner_account_id) VALUES($1,$2) RETURNING id",
            f"{name or '소셜'} 팀", acc["id"])
        await conn.execute(
            "INSERT INTO app.team_members(team_id,account_id,role) VALUES($1,$2,'owner')", team_id, acc["id"])
        await conn.execute(
            """INSERT INTO app.credit_entries(account_id,type,bucket,amount,reason)
               VALUES($1,'grant','earned',$2,'trial')""", acc["id"], settings.trial_credits)
    await conn.execute(
        "INSERT INTO app.social_accounts(account_id,provider,provider_uid,email) VALUES($1,$2,$3,$4)",
        acc["id"], provider, uid, email)
    return dict(acc)


@router.get("/{provider}/start")
async def start(provider: str):
    """제공자 동의화면으로 리다이렉트. state 쿠키로 CSRF 방어."""
    p = _cfg(provider)
    state = secrets.token_urlsafe(16)
    q = urllib.parse.urlencode({
        "response_type": "code", "client_id": p["cid"](),
        "redirect_uri": _redirect_uri(provider), "state": state, "scope": p["scope"],
    })
    resp = RedirectResponse(f"{p['authorize']}?{q}")
    resp.set_cookie("oauth_state", state, httponly=True, secure=True, samesite="lax", max_age=600, path="/")
    return resp


@router.get("/{provider}/callback")
async def callback(provider: str, code: str = Query(...), state: str = Query(None),
                   oauth_state: str | None = Cookie(default=None)):
    """code 교환 → 프로필 → 계정 매칭/생성 → refresh 쿠키 → 프론트 /search 리다이렉트."""
    p = _cfg(provider)
    if not state or state != oauth_state:
        raise HTTPException(400, "state 불일치(CSRF 방어)")
    async with httpx.AsyncClient(timeout=10) as client:
        tok = await client.post(p["token"], data={
            "grant_type": "authorization_code", "client_id": p["cid"](),
            "client_secret": p["secret"](), "redirect_uri": _redirect_uri(provider), "code": code})
        access = tok.json().get("access_token")
        if not access:
            raise HTTPException(502, "소셜 토큰 교환 실패")
        prof = await client.get(p["profile"], headers={"Authorization": f"Bearer {access}"})
        uid, email, name = _parse_profile(provider, prof.json())

    async with tx() as conn:
        acc = await _find_or_create(conn, provider, uid, email, name)
    redirect = RedirectResponse(f"{settings.frontend_base}/search")
    _set_refresh(redirect, acc["id"])
    redirect.delete_cookie("oauth_state", path="/")
    return redirect
