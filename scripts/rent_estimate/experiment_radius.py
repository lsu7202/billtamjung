"""주변 임대시세 — 반경을 바꾸면 층별 평당가가 실제로 얼마나 움직이나.

「주변 상권 정의하기」(사용자가 원/폴리곤을 그리는 도구)를 없애도 되는지 재는 실험이다.
값이 반경에 따라 크게 흔들리면 도구가 필요하고, 거의 안 움직이면 고정해도 된다.

market.py 의 nearby 와 **같은 쿼리**를 쓴다 — 마스터 추정(floor_rent_est × floor_outline)을
건물·층으로 집계하고 가까운 300건, 층별 평균. 팀 입력(app.floor_rents)은 여기서 안 본다
(순수 추정치 기준을 재는 자리라).

    data/.venv/bin/python scripts/rent_estimate/experiment_radius.py --gu 11680 --n 60
"""
import argparse
import asyncio
import os
import statistics

import asyncpg

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")
FLOORS = ("지하1층", "1층", "2층", "3층")          # 층은 시세가 갈리는 축이라 나눠 본다
RADII = (300, 500, 800, 1200)

SQL = """
WITH near AS (
  SELECT building_pk, geom FROM master.buildings b
   WHERE building_pk <> $1
     AND ST_DWithin(b.geom::geography, ST_SetSRID(ST_MakePoint($2,$3),4326)::geography, $4)),
agg AS (
  SELECT fo.floor, n.building_pk,
         sum(fo.floor_area)::float AS area,
         sum(fre.rent_est)::float  AS rent,
         ST_Distance(n.geom::geography, ST_SetSRID(ST_MakePoint($2,$3),4326)::geography) AS d
    FROM near n
    JOIN master.floor_rent_est fre ON fre.building_pk = n.building_pk
    JOIN master.floor_outline  fo  ON fo.building_pk = fre.building_pk AND fo.seq = fre.seq
   WHERE fre.rent_est > 0
   GROUP BY n.building_pk, n.geom, fo.floor),
cap AS (SELECT * FROM agg ORDER BY d LIMIT 300)
SELECT floor, count(*) AS n,
       avg(rent / (area / 3.305785)) AS per_rent
  FROM cap WHERE area > 0 GROUP BY floor
"""


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gu", default="11680")
    ap.add_argument("--n", type=int, default=60)
    a = ap.parse_args()
    conn = await asyncpg.connect(DSN)

    subs = await conn.fetch("""
        SELECT building_pk, ST_X(geom) AS lng, ST_Y(geom) AS lat
          FROM master.buildings
         WHERE bjd_code LIKE $1 || '%' AND geom IS NOT NULL
           AND (land_use = ANY(ARRAY['상업용','업무용','상업기타','주상용','주상기타']))
         ORDER BY building_pk LIMIT $2""", a.gu, a.n)

    # 건물마다 반경별 층별 평당가 → 500m 기준 대비 변화율
    gap = {f: {r: [] for r in RADII} for f in FLOORS}
    cnt = {r: [] for r in RADII}
    for s in subs:
        vals: dict[int, dict[str, float]] = {}
        for r in RADII:
            rows = await conn.fetch(SQL, s["building_pk"], s["lng"], s["lat"], r)
            vals[r] = {x["floor"]: float(x["per_rent"]) for x in rows if x["per_rent"]}
            cnt[r].append(sum(x["n"] for x in rows))
        base = vals.get(500, {})
        for f in FLOORS:
            b = base.get(f)
            if not b:
                continue
            for r in RADII:
                v = vals[r].get(f)
                if v:
                    gap[f][r].append(abs(v - b) / b * 100)
    await conn.close()

    print(f"구 {a.gu} · 건물 {len(subs)}동 · 500m 대비 층별 평당임대료 변화율(중앙값)\n")
    print(f"{'층':8s}" + "".join(f"{str(r)+'m':>12s}" for r in RADII))
    for f in FLOORS:
        line = f"{f:8s}"
        for r in RADII:
            xs = gap[f][r]
            line += f"{(statistics.median(xs) if xs else float('nan')):11.1f}%"
        print(line)
    print(f"\n{'표본 수':8s}" + "".join(
        f"{statistics.median(cnt[r]):11.0f}건" for r in RADII))


if __name__ == "__main__":
    asyncio.run(main())
