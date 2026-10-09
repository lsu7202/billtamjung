#!/usr/bin/env python3
"""검색 파생값 — master.building_derived (0174).

읽을 때 계산하는 값은 없다. 평단가·공시비율·공시 상승률·실거래 등락·건폐/용적 여유·
도로/역 점수를 여기 담고, 검색은 칸을 읽기만 한다. 산식은 DB 함수 **한 벌**
(master.refresh_building_derived, 0174)이라 이 스크립트는 그 함수를 부르는 것뿐이다.

언제 도나: 적정가(parcel_sale_est)·법정치(building_legal)·
계산 건폐/용적(building_calc)·실거래(sales_agg)·공시지가가 새로 들어온 뒤. 파이프라인 DERIVES 의
마지막 단계다(pipeline/units.py).

    BT_DATABASE_URL=... backend/.venv/bin/python scripts/build_building_derived.py
"""
import asyncio
import os
import time

import asyncpg

DSN = os.environ.get("BT_DATABASE_URL") or os.environ.get(
    "DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")


async def main() -> None:
    con = await asyncpg.connect(DSN)
    try:
        t = time.time()
        n = await con.fetchval("SELECT master.refresh_building_derived()")
        have = await con.fetchrow(
            """SELECT count(*) AS rows, count(pp_total) AS pp, count(gongsi_up5) AS up5,
                      count(far_slack) AS far, count(sale_pnl) AS pnl FROM master.building_derived""")
        print(f"building_derived: {n:,}동 갱신 · {time.time()-t:.1f}s · "
              f"추정가 평단가 {have['pp']:,} · 공시5년 {have['up5']:,} · 용적여유 {have['far']:,} · 실거래등락 {have['pnl']:,}")
    finally:
        await con.close()


if __name__ == "__main__":
    asyncio.run(main())
