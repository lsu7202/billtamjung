"""master.floor_rent_est 재적재 — 층별 임대/보증금 추정. rent_common 로직 사용.

    python scripts/rent_estimate/build_floor.py
DSN 환경변수 RENT_DSN 로 오버라이드 가능(기본 로컬 도커).
"""
import os
import asyncio
from collections import defaultdict

import asyncpg
from rent_common import (EXCL, EFF_RATIO, rate_for, pick_rate, market_adj, SANG_SQL, BLDG_FILTER,
                         pick_series, deposit_mult, v4_unit, V4)

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")


async def main():
    c = await asyncpg.connect(DSN)
    await c.execute(
        "DROP TABLE IF EXISTS master.floor_rent_est_bak;"
        "CREATE TABLE master.floor_rent_est_bak AS TABLE master.floor_rent_est;"
        "TRUNCATE master.floor_rent_est;")
    bldgs = await c.fetch(
        f"SELECT b.building_pk pk, b.land_use lu, b.total_area::float ta, {SANG_SQL} sang, "
        f"       b.gongsi_latest::float g, b.approval_ymd ay, b.station_dist::float sd "
        f"FROM master.buildings b WHERE {BLDG_FILTER}")
    fo = await c.fetch(
        f"SELECT fo.building_pk pk, fo.seq, fo.floor, fo.use, fo.floor_area::float a "
        f"FROM master.floor_outline fo JOIN master.buildings b USING(building_pk) WHERE {BLDG_FILTER}")
    FL = defaultdict(list)
    for r in fo:
        FL[r['pk']].append(r)
    ins = []
    n4 = n3 = 0                                  # v4(공시지가) · v3(상권요율 폴백) 층 수
    print(f"산식: {'v4 공시지가 주축' if V4 else 'v3 상권요율(계수 파일 없음 — fit_rent_v4.py 를 먼저 돌리세요)'}")
    for b in bldgs:
        rows = FL.get(b['pk'], [])
        tot = sum(r['a'] or 0 for r in rows)
        off = sum((r['a'] or 0) for r in rows
                  if any(k in (r['use'] or '') for k in ['사무', '업무', '오피스', '연구', '교육', '학원']))
        series = pick_series(b['ta'], b['lu'], off, tot)
        rate, _ = rate_for(series, b['sang'])
        if not rate:
            continue
        dmult = deposit_mult(series, b['sang'])      # 보증금 배율(상권 전환율)
        for r in rows:
            u = r['use'] or ''
            a = r['a'] or 0
            if any(k in u for k in EXCL) or a <= 0:
                rent = 0
            else:
                # v4 — 공시지가 주축(2026-08-30). 단가는 이미 임대가능면적 기준이라
                # EFF_RATIO 를 또 곱하지 않는다(눈금 K 가 v3×EFF_RATIO 에 맞춰져 있다).
                u4 = v4_unit(b['g'], r['floor'], series, b['sang'], b['ay'], b['sd'])
                if u4:
                    rent = int(u4 * a)
                    n4 += 1
                else:           # 공시지가가 없는 건물 — v3(상권 요율)로 돌아간다
                    rt = pick_rate(series, r['floor'], rate)
                    rent = int(rt * 1000 * a * EFF_RATIO * market_adj(r['floor'])) if rt else 0
                    n3 += 1
            ins.append((b['pk'], r['seq'], rent, int(rent * dmult)))
    await c.executemany(
        "INSERT INTO master.floor_rent_est(building_pk,seq,rent_est,deposit_est) VALUES($1,$2,$3,$4)", ins)
    print(f"floor_rent_est 재적재: {len(ins)}행 · 수익>0 {sum(1 for x in ins if x[2] > 0)}")
    print(f"  v4(공시지가) {n4:,}층 · v3 폴백 {n3:,}층")
    # 검색 수익률이 이 값을 층 단위로 쓰는 하이브리드라(0030) 롤업 MV를 함께 굴린다.
    for mv in ("master.floor_est_by_floor", "master.floor_est_total"):
        try:
            await c.execute(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {mv}")
            print(f"  · {mv} 갱신")
        except Exception as e:
            print(f"  ⚠️ {mv} 갱신 실패(무시): {e}")
    await c.close()


if __name__ == "__main__":
    asyncio.run(main())
