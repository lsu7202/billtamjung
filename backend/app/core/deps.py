"""인증 의존성. team_id는 토큰에서만 도출(팀 격리, 01-상세설계 §9)."""
from dataclasses import dataclass
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from . import security

_bearer = HTTPBearer(auto_error=True)


@dataclass
class CurrentUser:
    account_id: int
    team_id: int | None      # 고객은 None. current_user 를 거치면 늘 int 다
    role: str | None
    tier: str
    kind: str = "중개사"     # 중개사 · 고객 — 권한의 기준(S05 §1)


def _decode(cred: HTTPAuthorizationCredentials) -> CurrentUser:
    try:
        payload = security.decode(cred.credentials)
        if payload.get("typ") != "access":
            raise ValueError("not an access token")
        tid = payload.get("team_id")
        return CurrentUser(
            account_id=int(payload["sub"]),
            team_id=int(tid) if tid is not None else None,
            role=payload.get("role"),
            tier=payload["tier"],
            kind=payload.get("kind") or "중개사",   # 0191 이전 토큰엔 kind 가 없다 = 중개사
        )
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired token")


def current_user(cred: HTTPAuthorizationCredentials = Depends(_bearer)) -> CurrentUser:
    """중개사 전용 — 매물관리 · 팀 칸 · 크롤링 자료. **기본값이다.** 고객에게 여는 라우트만 any_user 를 쓴다."""
    u = _decode(cred)
    if u.kind != "중개사" or u.team_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "중개사 전용입니다")
    return u


def any_user(cred: HTTPAuthorizationCredentials = Depends(_bearer)) -> CurrentUser:
    """누구나 — 검색 · 건물 상세 · 실거래 · 소식 · 광고 보기. 팀 값은 u.team_id 가 None 이면 SQL 에서 빠진다."""
    return _decode(cred)


def is_broker(u: CurrentUser) -> bool:
    return u.kind == "중개사" and u.team_id is not None
