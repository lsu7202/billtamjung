"""master.building_rent_est 재적재 — 건물 총액 임대추정. rent_common 로직 사용.

    python scripts/rent_estimate/build_bldg.py
"""
import os
import asyncio
from collections import defaultdict

import asyncpg
from rent_common import (EXCL, M2P, EFF_RATIO, rate_for, pick_rate, market_adj, SANG_SQL,
                         BLDG_FILTER, pick_series, deposit_mult, v4_unit, V4)

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")


async def main():
    c = await asyncpg.connect(DSN)
    await c.execute(
        "DROP TABLE IF EXISTS master.building_rent_est_bak;"
        "CREATE TABLE master.building_rent_est_bak AS TABLE master.building_rent_est;"
        "TRUNCATE master.building_rent_est;")
    bldgs = await c.fetch(
        f"SELECT b.building_pk pk, b.land_use lu, b.total_area::float ta, {SANG_SQL} sang, "
        f"       b.gongsi_latest::float g, b.approval_ymd ay, b.station_dist::float sd "
        f"FROM master.buildings b WHERE {BLDG_FILTER}")
    fo = await c.fetch(
        f"SELECT fo.building_pk pk, fo.floor, fo.use, fo.floor_area a "
        f"FROM master.floor_outline fo JOIN master.buildings b USING(building_pk) WHERE {BLDG_FILTER}")
    FO = defaultdict(list)
    for r in fo:
        FO[r['pk']].append((r['floor'], r['use'] or '', float(r['a'] or 0)))
    ins = []
    n_map = 0
    print(f"산식: {'v4 공시지가 주축' if V4 else 'v3 상권요율(계수 파일 없음)'}")
    for b in bldgs:
        off = tot = 0
        flrs = []
        for fl, u, a in FO.get(b['pk'], []):
            tot += a
            if any(k in u for k in EXCL) or a <= 0:
                continue
            flrs.append((fl, a))
            if any(kw in u for kw in ['사무', '업무', '오피스', '연구', '교육', '학원']):
                off += a
        if not flrs or tot <= 0:
            continue
        series = pick_series(b['ta'], b['lu'], off, tot)
        rate, mapped = rate_for(series, b['sang'])
        if not rate:
            continue
        wol = rentable = 0
        for fl, a in flrs:
            # v4 — 공시지가 주축(2026-08-30). 층 빌더와 같은 산식·같은 단위.
            u4 = v4_unit(b['g'], fl, series, b['sang'], b['ay'], b['sd'])
            if u4:
                wol += u4 * a
                rentable += a * EFF_RATIO
                continue
            rt = pick_rate(series, fl, rate)      # 공시지가 없는 건물 — v3 폴백
            if rt:
                wol += rt * 1000 * a * EFF_RATIO * market_adj(fl)
                rentable += a * EFF_RATIO
        if wol <= 0 or rentable <= 0:
            continue
        py = rentable / M2P
        ins.append((b['pk'], b['sang'] if mapped else None, series, int(wol), int(wol * 12),
                    int(wol / py) if py else 0, int(wol * deposit_mult(series, b['sang'])),
                    round(rentable, 1), mapped))
        if mapped:
            n_map += 1
    await c.executemany(
        "INSERT INTO master.building_rent_est"
        "(building_pk,sanggwon,series,monthly_rent,annual_rent,per_py_rent,deposit_est,rentable_m2,mapped)"
        " VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", ins)
    print(f"building_rent_est 재적재: {len(ins)}동 (상권매핑 {n_map}={n_map / len(ins) * 100:.0f}%)")
    await c.close()


if __name__ == "__main__":
    asyncio.run(main())
