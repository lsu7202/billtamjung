"""bt_ai 접속 풀 — 모델이 SQL 을 돌리는 유일한 길. 정본 10-AI-어시스턴트 §3-2

앱 접속(core.db)은 postgres 슈퍼유저라 모델에게 절대 안 준다.
여기는 `BT_AI_DATABASE_URL` 로 붙는 **별도 롤** bt_ai 다(0167). master·ref 만 읽고,
읽기 전용이고, 10초에 끊긴다. 막는 것은 프롬프트가 아니라 포스트그레스다.

비어 있으면 풀이 안 서고 query 도구가 AI_TOOL_FAILED 를 낸다(키와 같은 어법).
"""
from __future__ import annotations

import asyncpg

from ..core.config import settings

_pool: asyncpg.Pool | None = None


def configured() -> bool:
    return bool(settings.ai_database_url)


async def pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        if not configured():
            raise RuntimeError("BT_AI_DATABASE_URL 이 비어 있다 — bt_ai 롤(0167)로 붙는 접속이 필요하다")
        _pool = await asyncpg.create_pool(
            settings.ai_database_url, min_size=0, max_size=4,
            # 롤에 이미 10s 가 걸려 있지만 접속 단에서도 한 번 더. 두 겹.
            server_settings={"statement_timeout": "10000", "timezone": "Asia/Seoul"},
        )
    return _pool


async def close() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
