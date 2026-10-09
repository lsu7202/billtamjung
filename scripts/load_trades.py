#!/usr/bin/env python3
"""실거래 적재 — master.trade · master.trade_match (2026-10-08 · 스펙 12 §1).

data/tools/build_trades.py 가 낸 CSV 둘을 한 트랜잭션으로 갈아 끼운다. 빈칸은 NULL(모르면 비운다).
거래 id 는 원천 값으로 만든 것이라 다시 받아도 같은 거래는 같은 id 다.

    BT_DATABASE_URL=... backend/.venv/bin/python scripts/load_trades.py [CSV 폴더]
"""
import asyncio
import os
import sys

import asyncpg

DSN = os.environ.get("BT_DATABASE_URL") or os.environ.get(
    "DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data", "exports", "_load")


async def main() -> None:
    t_csv, m_csv = os.path.join(DIR, "trade.csv"), os.path.join(DIR, "trade_match.csv")
    for p in (t_csv, m_csv):
        if not os.path.exists(p):
            sys.exit(f"✗ {p} 가 없습니다 — build_trades.py 를 먼저 돌리세요")
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=3600)
    try:
        before = await c.fetchval("SELECT count(*) FROM master.trade")
        async with c.transaction():
            await c.execute("TRUNCATE master.trade_match, master.trade")
            cols = open(t_csv, encoding="utf-8").readline().strip().split(",")
            await c.copy_to_table("trade", schema_name="master", source=t_csv, columns=cols,
                                  format="csv", header=True, null="")
            await c.copy_to_table("trade_match", schema_name="master", source=m_csv, columns=["trade_id", "pnu", "method"],
                                  format="csv", header=True, null="")
        # 지번 실거래 집계(0245) — 검색 · 모델 매물 표가 읽는다. 유일 색인이 있어 조회를 안 막는다
        # 0245 전(건물 단위 sales_agg)이면 건너뛴다 — 그 판은 trade 를 안 읽는다
        if await c.fetchval("SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'sales_agg_pnu')"):
            await c.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY master.sales_agg")
        # 지번 실거래 전부(0249) — 상세 실거래 표 · 실거래 보기 핀이 읽는다
        if await c.fetchval("SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'trade_parcel_id')"):
            await c.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY master.trade_parcel")
        n = await c.fetchval("SELECT count(*) FROM master.trade")
        m = await c.fetchval("SELECT count(*) FROM master.trade_match")
        print(f"  trade {before:,} → {n:,}줄 · 지번에 붙은 것 {m:,}", flush=True)
    finally:
        await c.close()


if __name__ == "__main__":
    asyncio.run(main())
