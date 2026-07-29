"""master.floor_rent_est 재적재 — 층별 임대/보증금 추정. rent_common 로직 사용.

    python scripts/rent_estimate/build_floor.py
DSN 환경변수 RENT_DSN 로 오버라이드 가능(기본 로컬 도커).
"""
import os
import asyncio
from collections import defaultdict

import asyncpg
from rent_common import EXCL, rate_for, pick_rate, market_adj, SANG_SQL, BLDG_FILTER, pick_series, DEPOSIT_MULT

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")


async def main():
    c = await asyncpg.connect(DSN)
    await c.execute(
        "DROP TABLE IF EXISTS master.floor_rent_est_bak;"
        "CREATE TABLE master.floor_rent_est_bak AS TABLE master.floor_rent_est;"
        "TRUNCATE master.floor_rent_est;")
    bldgs = await c.fetch(
        f"SELECT b.building_pk pk, b.land_use lu, b.total_area::float ta, {SANG_SQL} sang "
        f"FROM master.buildings b WHERE {BLDG_FILTER}")
    fo = await c.fetch(
        f"SELECT fo.building_pk pk, fo.seq, fo.floor, fo.use, fo.exclusive_area::float a "
        f"FROM master.floor_outline fo JOIN master.buildings b USING(building_pk) WHERE {BLDG_FILTER}")
    FL = defaultdict(list)
    for r in fo:
        FL[r['pk']].append(r)
    ins = []
    for b in bldgs:
        rows = FL.get(b['pk'], [])
        tot = sum(r['a'] or 0 for r in rows)
        off = sum((r['a'] or 0) for r in rows
                  if any(k in (r['use'] or '') for k in ['사무', '업무', '오피스', '연구', '교육', '학원']))
        series = pick_series(b['ta'], b['lu'], off, tot)
        rate, _ = rate_for(series, b['sang'])
        if not rate:
            continue
        for r in rows:
            u = r['use'] or ''
            a = r['a'] or 0
            if any(k in u for k in EXCL) or a <= 0:
                rent = 0
            else:
                rt = pick_rate(series, r['floor'], rate)
                rent = int(rt * 1000 * a * market_adj(r['floor'])) if rt else 0
            ins.append((b['pk'], r['seq'], rent, int(rent * DEPOSIT_MULT)))
    await c.executemany(
        "INSERT INTO master.floor_rent_est(building_pk,seq,rent_est,deposit_est) VALUES($1,$2,$3,$4)", ins)
    print(f"floor_rent_est 재적재: {len(ins)}행 · 수익>0 {sum(1 for x in ins if x[2] > 0)}")
    await c.close()


if __name__ == "__main__":
    asyncio.run(main())
