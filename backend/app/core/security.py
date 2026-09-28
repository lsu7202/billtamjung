"""JWT access/refresh + 비밀번호 해시(argon2). 01-상세설계 §5.2."""
import datetime as dt
import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from .config import settings

_ph = PasswordHasher()


def hash_password(raw: str) -> str:
    return _ph.hash(raw)


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, raw)
    except VerifyMismatchError:
        return False


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def make_access(account_id: int, team_id: int | None, role: str | None, tier: str,
                kind: str = "중개사") -> str:
    # 고객(kind=고객)은 팀이 없다 — team_id · role 이 비어서 나간다(S05, 2026-09-28)
    payload = {
        "sub": str(account_id), "team_id": team_id, "role": role, "tier": tier, "kind": kind,
        "typ": "access", "exp": _now() + dt.timedelta(minutes=settings.access_ttl_min),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_alg)


def make_refresh(account_id: int) -> str:
    payload = {
        "sub": str(account_id), "typ": "refresh",
        "exp": _now() + dt.timedelta(days=settings.refresh_ttl_days),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_alg)


def decode(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_alg])
