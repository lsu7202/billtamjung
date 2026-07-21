"""asyncpg 커넥션 풀. SQL 우선(01-상세설계 §1.1)."""
import asyncpg
from contextlib import asynccontextmanager
from .config import settings

_pool: asyncpg.Pool | None = None


async def connect() -> None:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=10)


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
