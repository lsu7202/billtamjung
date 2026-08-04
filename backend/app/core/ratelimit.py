"""경량 per-IP rate limit — 인증 엔드포인트 무차별 대입·봇 가입 방어.
인메모리(인스턴스별)라 max-instances=4면 실효 한도는 표기의 최대 4배 — 베타 규모엔 충분.
정식(다중 인스턴스 엄밀 한도 필요)엔 Cloud Armor+LB 또는 Redis로 전환.
"""
import time
from collections import defaultdict, deque

# 경로 prefix → (윈도우 초, 허용 횟수). 로그인 10/분·가입 5/분·비번재설정 5/분.
RULES: list[tuple[str, int, int]] = [
    ("/auth/login", 60, 10),
    ("/auth/signup", 60, 5),
    ("/auth/password", 60, 5),
]

_hits: dict[tuple[str, str], deque] = defaultdict(deque)
_MAX_KEYS = 50_000          # 메모리 상한(키 폭주 방지) — 초과 시 전체 리셋(오탐보다 가용성)


def client_ip(headers, fallback: str) -> str:
    """Cloud Run은 X-Forwarded-For에 실클라이언트 IP를 실음(맨 앞 값)."""
    xff = headers.get("x-forwarded-for", "")
    return xff.split(",")[0].strip() if xff else fallback


def check(path: str, ip: str) -> int | None:
    """제한 초과면 retry-after 초 반환, 아니면 None. /api 프리픽스 겸용."""
    p = path[4:] if path.startswith("/api/") else path
    for prefix, window, limit in RULES:
        if p.startswith(prefix):
            if len(_hits) > _MAX_KEYS:
                _hits.clear()
            now = time.monotonic()
            q = _hits[(prefix, ip)]
            while q and now - q[0] > window:
                q.popleft()
            if len(q) >= limit:
                return int(window - (now - q[0])) + 1
            q.append(now)
            return None
    return None
