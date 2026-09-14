"""임대 오차의 바닥 — 호가 자체가 얼마나 흩어지나(2026-08-29).

experiment_rent_v2.py 결과가 이상했다. 공시지가·역거리·연식을 다 넣어도
33.1% → 31.3% 로 1.8p 밖에 안 줄었다. 잔차와 상관이 ρ=0.355 나 되는 변수를
넣었는데 이만큼밖에 안 준다면, **줄일 수 없는 몫**이 크다는 뜻이다.

그 몫을 직접 잰다: **같은 건물 같은 층에 나온 매물끼리** 호가가 얼마나 다른가.
같은 건물 같은 층이면 우리가 아는 정보로는 완전히 같은 자리다 — 그런데도
호가가 다르다면, 그 차이는 어떤 산식으로도 못 맞힌다. 그게 오차의 바닥이다.

    backend/.venv/bin/python scripts/rent_estimate/noise_floor_rent.py
"""
import asyncio
import math
import os
import statistics as st

import asyncpg

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")


async def main():
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=900)

    print("[1] 같은 건물·같은 층에 매물이 둘 이상인 경우 — 매물끼리의 흩어짐")
    rows = await c.fetch("""
        SELECT building_pk, floor, count(*) n,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY rent/area_c) med,
               min(rent/area_c) lo, max(rent/area_c) hi,
               stddev_pop(ln(rent/area_c)) sd
          FROM master._crawl_rent
         WHERE building_pk IS NOT NULL AND floor IS NOT NULL
           AND rent/area_c BETWEEN 3000 AND 400000
         GROUP BY 1,2 HAVING count(*) >= 2""")
    sds = [float(r["sd"]) for r in rows if r["sd"] is not None]
    spread = [float(r["hi"]) / float(r["lo"]) for r in rows if r["lo"] and float(r["lo"]) > 0]
    print(f"  (건물,층) 조합 {len(rows):,}개 · 매물 2건 이상")
    print(f"  로그 표준편차 중앙 {st.median(sds):.3f}  ← 우리 예측의 로그SD 0.512 와 견줄 값")
    print(f"  최고÷최저 배율 중앙 {st.median(spread):.2f}")

    # 한 매물을 다른 매물로 맞힌다고 치면 오차가 얼마인가(같은 층 안에서)
    ap = []
    for r in rows:
        if r["med"] and float(r["med"]) > 0 and r["sd"] is not None:
            # 로그정규 가정: 중앙값으로 맞힐 때의 MdAPE ≈ exp(0.674·sd) − 1
            ap.append((math.exp(0.674 * float(r["sd"])) - 1) * 100)
    if ap:
        print(f"  → 같은 층 매물을 그 층 중앙값으로 맞힐 때 MdAPE ≈ {st.median(ap):.1f}%")

    print("\n[2] 매물 수별 — 표본이 많을수록 중앙값이 안정된다")
    for lo, hi in ((2, 2), (3, 4), (5, 9), (10, 999)):
        v = [float(r["sd"]) for r in rows if r["sd"] is not None and lo <= r["n"] <= hi]
        if v:
            print(f"  매물 {lo}~{hi if hi < 999 else '+'}건  조합 {len(v):6,}개  로그SD 중앙 {st.median(v):.3f}")

    print("\n[3] 같은 건물 안 층끼리 — 층 보정이 잡아야 할 몫")
    b = await c.fetch("""
        WITH f AS (
          SELECT building_pk, floor,
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY rent/area_c) u
            FROM master._crawl_rent
           WHERE building_pk IS NOT NULL AND floor IS NOT NULL
             AND rent/area_c BETWEEN 3000 AND 400000
           GROUP BY 1,2)
        SELECT building_pk, count(*) nf, stddev_pop(ln(u)) sd
          FROM f GROUP BY 1 HAVING count(*) >= 3""")
    v = [float(r["sd"]) for r in b if r["sd"] is not None]
    print(f"  층 3개 이상인 건물 {len(b):,}동 · 층간 로그SD 중앙 {st.median(v):.3f}")

    print("\n[4] 건물끼리 — 같은 상권·같은 층에서 건물이 얼마나 다른가")
    g = await c.fetch("""
        WITH f AS (
          SELECT cr.building_pk, cr.floor,
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY cr.rent/cr.area_c) u
            FROM master._crawl_rent cr
           WHERE cr.building_pk IS NOT NULL AND cr.floor IS NOT NULL
             AND cr.rent/cr.area_c BETWEEN 3000 AND 400000
           GROUP BY 1,2)
        SELECT sg.nm, f.floor, count(*) nb, stddev_pop(ln(f.u)) sd
          FROM f
          JOIN master.buildings b ON b.building_pk = f.building_pk
          JOIN master.sanggwon sg ON ST_Contains(sg.geom, b.geom)
         GROUP BY 1,2 HAVING count(*) >= 10""")
    v2 = [float(r["sd"]) for r in g if r["sd"] is not None]
    print(f"  (상권,층) 조합 {len(g):,}개 · 건물간 로그SD 중앙 {st.median(v2):.3f}")
    print(f"    ← 이게 우리가 줄일 수 있는 몫이다. 매물간({st.median(sds):.3f})은 못 줄인다.")

    await c.close()

    print("\n[정리]")
    print(f"  매물간(같은 건물·같은 층)  로그SD {st.median(sds):.3f}   ← 어떤 산식으로도 못 줄이는 바닥")
    print(f"  건물간(같은 상권·같은 층)  로그SD {st.median(v2):.3f}   ← 자리 변수로 줄일 수 있는 몫")
    print(f"  현행 예측 잔차             로그SD 0.541")
    print(f"  v2(공시·역거리·연식)       로그SD 0.512")


if __name__ == "__main__":
    asyncio.run(main())
