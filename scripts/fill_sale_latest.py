#!/usr/bin/env python3
"""master.buildings 의 last_sale_ym · last_sale_price 를 되붙인다 — 실거래 단위.

## 왜 (2026-09-07)

실거래(`sales_history`)는 월마다 새로 실리는데, 건물 표의 마지막 매각 두 칸은 대장 빌드가
`_sales_est.json` → SQLite → CSV 로 구워 넣은 값이라 **다음 대장 빌드까지 90일 묵었다**
(09-표별-칸별-사슬 §5 buildings 이상 8). 공시지가·승강기와 같은 모양인데 이쪽만 되붙임이 없었다.

정본은 `master.sales_agg`(sales_history 를 건물별로 집계한 MV · 로더가 sales 적재마다 REFRESH).
거기서 최근 계약년월·가격을 가져와 살아 있는 세대 표에 UPDATE 한다.

    BT_DATABASE_URL=... backend/.venv/bin/python scripts/fill_sale_latest.py
"""
import asyncio
import os
import sys

import asyncpg

DSN = os.environ.get("BT_DATABASE_URL") or os.environ.get(
    "DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")


async def main() -> int:
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=3600)
    try:
        tbl = await c.fetchval(
            r"""SELECT regexp_replace(pg_get_viewdef(c.oid), '.*FROM master\.([a-z_0-9]+).*', '\1', 'ns')
                  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'master' AND c.relname = 'buildings'""")
        if not tbl or not tbl.startswith("buildings"):
            sys.exit(f"✗ master.buildings 가 가리키는 표를 못 찾았습니다 — {tbl!r}")
        before = await c.fetchval(f"SELECT count(last_sale_price) FROM master.{tbl}")
        r = await c.execute(f"""
            WITH latest AS (
              SELECT DISTINCT ON (building_pk) building_pk, contract_ym, price
                FROM master.sales_history WHERE price > 0
               ORDER BY building_pk, contract_ym DESC)
            UPDATE master.{tbl} b
               SET last_sale_ym = l.contract_ym, last_sale_price = l.price
              FROM latest l
             WHERE l.building_pk = b.building_pk
               AND (b.last_sale_ym IS DISTINCT FROM l.contract_ym
                    OR b.last_sale_price IS DISTINCT FROM l.price)""")
        after = await c.fetchval(f"SELECT count(last_sale_price) FROM master.{tbl}")
        print(f"  master.{tbl} · 고친 줄 {r.split()[-1]} · 매각가 있는 건물 {before:,} → {after:,}")
        return 0
    finally:
        await c.close()


sys.exit(asyncio.run(main()))
