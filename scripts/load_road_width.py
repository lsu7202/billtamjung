#!/usr/bin/env python3
"""도로폭 적재 + 건물별 접도 산출(0033). 멱등 — 몇 번 돌려도 같다.

  1) data/tools/_road_width.csv → master.road_segment
  2) 건물별 전면/측면/후면 폭 → master.building_road

전면은 추측하지 않는다. 도로명주소(road_addr)의 도로명과 일치하는 구간이 곧 전면 도로다.
(검증 — 노량진동 54-8: road_addr '장승배기로 170' → 장승배기로 25m.
 원본 브리핑의 '전면 25m'와 일치. 같은 건물을 연속지적도 도로 필지로 추정했을 땐 9.3m로 빗나갔다.)

사용: python3 scripts/load_road_width.py [DSN]
"""
import asyncio
import csv
import os
import sys

import asyncpg

DSN = sys.argv[1] if len(sys.argv) > 1 else os.environ.get(
    "BT_DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")
CSV_PATH = os.environ.get("BT_ROAD_CSV", "data/tools/_road_width.csv")

BUILD_ROAD = """
INSERT INTO master.building_road(building_pk, front_m, side_m, rear_m, front_rn, n_roads)
WITH near AS (
  SELECT b.building_pk, r.rn, r.road_bt,
         (b.road_addr IS NOT NULL AND b.road_addr LIKE '%' || r.rn || '%') AS is_front
  FROM master.buildings b
  JOIN master.road_segment r ON ST_DWithin(b.geom::geography, r.geom::geography, 30)
),
agg AS (
  SELECT building_pk,
         max(road_bt) FILTER (WHERE is_front)                 AS front_m,
         (array_agg(DISTINCT rn) FILTER (WHERE is_front))[1]  AS front_rn,
         array_agg(DISTINCT road_bt ORDER BY road_bt DESC)
           FILTER (WHERE NOT is_front)                        AS others,
         count(DISTINCT rn)                                   AS n_roads
  FROM near GROUP BY 1
)
SELECT building_pk,
       COALESCE(front_m, others[1]),
       CASE WHEN front_m IS NULL THEN others[2] ELSE others[1] END,
       CASE WHEN front_m IS NULL THEN others[3] ELSE others[2] END,
       front_rn, n_roads
FROM agg
"""


async def main() -> None:
    c = await asyncpg.connect(DSN)
    await c.execute("SET statement_timeout = 0")

    if os.path.exists(CSV_PATH):
        rows = []
        with open(CSV_PATH) as f:
            for r in csv.DictReader(f):
                rows.append((r["rn_cd"], r["rn"], float(r["road_bt"] or 0),
                             float(r["road_lt"] or 0), r["cls"], r["sig_cd"], r["wkt"]))
        await c.execute("TRUNCATE master.road_segment")
        await c.execute("CREATE TEMP TABLE _rw(rn_cd text, rn text, road_bt numeric,"
                        " road_lt numeric, cls text, sig_cd text, wkt text)")
        await c.copy_records_to_table("_rw", records=rows)
        await c.execute("""INSERT INTO master.road_segment(rn_cd,rn,road_bt,road_lt,cls,sig_cd,geom)
                           SELECT rn_cd,rn,road_bt,road_lt,cls,sig_cd,ST_GeomFromText(wkt,4326) FROM _rw""")
        print(f"road_segment {len(rows):,}건 적재")
    else:
        print(f"⚠️ {CSV_PATH} 없음 — 적재 건너뜀(build_road_width.py 먼저 실행)")

    await c.execute("TRUNCATE master.building_road")
    await c.execute(BUILD_ROAD)
    row = await c.fetchrow("""SELECT count(*) n, count(front_m) f, count(front_rn) rn,
                                     round(avg(front_m),1) avg FROM master.building_road""")
    print(f"building_road {row['n']:,}건 · 전면폭 {row['f']:,} · 도로명 확정 {row['rn']:,} · 평균 {row['avg']}m")
    await c.close()


if __name__ == "__main__":
    asyncio.run(main())
