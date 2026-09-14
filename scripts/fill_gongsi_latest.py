#!/usr/bin/env python3
"""master.buildings.gongsi_latest — 시계열의 가장 최근 값을 건물에 되붙인다.

## 왜 따로 필요한가 (2026-09-07)

`gongsi_series` 는 공시지가 단위가 갱신하는데, 화면과 파생이 실제로 읽는 것은
**건물 표의 `gongsi_latest` 칸**이다. 그 칸은 대장 빌드(`export_seoul`)가 구워 넣는다.
그래서 공시지가만 갱신하면 시계열은 새것인데 건물의 값은 옛것으로 남는다.

승강기(`elevator_ext`)·필지 용도지역(`load_parcel_luris`)과 같은 자리다 —
**대장 CSV 를 거치지 않고 적재 뒤에 붙인다.** 대장을 다시 실어도 그 뒤에 또 붙는다.

이 값을 적정가(`build_sale_est`)·임대추정(`build_floor`·`build_bldg`)·
가격지수(`build_price_index`) 넷이 읽는다. 어긋나면 그 넷이 옛 지가로 계산한다.

    BT_DATABASE_URL=... backend/.venv/bin/python scripts/fill_gongsi_latest.py
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
        # 살아 있는 세대를 뷰에서 찾는다. **세대 이름을 박지 않는다**(2026-09-06 parcels_v6 사고)
        tbl = await c.fetchval(
            r"""SELECT regexp_replace(pg_get_viewdef(c.oid), '.*FROM master\.([a-z_0-9]+).*',
                                      '\1', 'ns')
                  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'master' AND c.relname = 'buildings'""")
        if not tbl or not tbl.startswith("buildings"):
            sys.exit(f"✗ master.buildings 가 가리키는 표를 못 찾았습니다 — {tbl!r}")

        # 필지 쪽도 같은 칸이 있다(parcels.gongsi_latest). export_parcels 가 빌드 시점 값을 굽고
        # 그 뒤로 아무도 안 갈아서, gongsi 단위만 돌리면 건물은 새것·필지는 옛것이 됐다(2026-09-07 추적 이상 5).
        ptbl = await c.fetchval(
            r"""SELECT regexp_replace(pg_get_viewdef(c.oid), '.*FROM master\.([a-z_0-9]+).*', '\1', 'ns')
                  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'master' AND c.relname = 'parcels'""")
        await c.execute("""CREATE TEMP TABLE latest AS
                           SELECT DISTINCT ON (pnu) pnu, price FROM master.gongsi_series ORDER BY pnu, year DESC""")
        await c.execute("CREATE INDEX ON latest(pnu)")
        for name in (tbl, ptbl):
            if not name:
                continue
            before = await c.fetchval(f"SELECT count(gongsi_latest) FROM master.{name}")
            r = await c.execute(f"""
                UPDATE master.{name} t SET gongsi_latest = l.price
                  FROM latest l WHERE l.pnu = t.pnu AND t.gongsi_latest IS DISTINCT FROM l.price""")
            after = await c.fetchval(f"SELECT count(gongsi_latest) FROM master.{name}")
            print(f"  master.{name} · 고친 줄 {r.split()[-1]} · 값 있는 줄 {before:,} → {after:,}")
        return 0
    finally:
        await c.close()


sys.exit(asyncio.run(main()))
