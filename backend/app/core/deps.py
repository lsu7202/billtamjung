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
    team_id: int
    role: str
    tier: str


def current_user(cred: HTTPAuthorizationCredentials = Depends(_bearer)) -> CurrentUser:
    try:
        payload = security.decode(cred.credentials)
        if payload.get("typ") != "access":
            raise ValueError("not an access token")
        return CurrentUser(
            account_id=int(payload["sub"]),
            team_id=int(payload["team_id"]),
            role=payload["role"],
            tier=payload["tier"],
        )
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired token")
