"""asyncpg 커넥션 풀. SQL 우선(01-상세설계 §1.1)."""
import asyncpg
from contextlib import asynccontextmanager
from .config import settings

_pool: asyncpg.Pool | None = None


async def connect() -> None:
    global _pool
    if _pool is None:
        # statement_timeout: 클라이언트가 HTTP를 끊어도 서버 쿼리는 계속 돈다 → 폭주 쿼리가
        # 풀(max 10)을 잠식해 서비스 전체 행업(QA에서 실측: 1h22m짜리 12개 누적). 30s 상한.
        _pool = await asyncpg.create_pool(
            settings.database_url, min_size=1, max_size=10,
            # timezone: 손님은 전부 한국 중개인이다. DB가 UTC로 돌면 자정~오전 9시(KST)에
            # current_date 가 어제라서 「오늘」이 비고 커밋 날짜가 하루 밀린다(2026-08-15 실측).
            server_settings={"statement_timeout": "30000", "timezone": "Asia/Seoul"},
        )


async def disconnect() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> asyncpg.Pool:
    assert _pool is not None, "pool not initialized"
    return _pool


@asynccontextmanager
async def tx():
    """트랜잭션 경계 = 서비스 함수 1개(크레딧 차감 등 원자성)."""
    async with pool().acquire() as conn:
        async with conn.transaction():
            yield conn
