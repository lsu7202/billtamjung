"""임대 추정 — 주변 호가를 comp 로 쓴다(2026-08-29).

noise_floor_rent.py 가 오차의 지도를 그려 줬다:

    매물간(같은 건물·같은 층)  로그SD 0.056   ← 못 줄이는 바닥. 거의 없다
    건물간(같은 상권·같은 층)  로그SD 0.439   ← 줄일 수 있는 몫
    현행 예측 잔차             로그SD 0.541
    v2(공시·역거리·연식)       로그SD 0.512   ← 자리 변수를 넣어도 0.03 밖에 못 줄였다

바닥이 0.056 인데 우리가 0.512 라면, 못 맞히는 게 아니라 **안 보고 있는 것**이다.
지금 산식이 보는 건 (상권, 층) 둘뿐이다. 상권은 서울을 68칸으로 나눈 거친 격자라,
같은 상권 안 건물끼리 벌어지는 0.439 를 통째로 못 본다.

그런데 우리에겐 **실제 호가가 39,319동** 있다(크롤). 적정가(F-17)는 주변 실거래를
comp 로 쓰면서, 임대는 왜 통계표 요율만 쓰나. 같은 어법으로 바꿔 본다:

    주변 반경 R 안 · 같은 층대 · 다른 건물의 실제 호가 단가 → 거리가중 기하평균

leave-one-out — 자기 건물은 comp 에서 뺀다(미래정보 누출과 같은 반칙).

    backend/.venv/bin/python scripts/rent_estimate/experiment_rent_comp.py
"""
import argparse
import asyncio
import math
import os
import statistics as st

import asyncpg

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")


def bucket(n):
    if n < 0:
        return "B"
    if n <= 3:
        return str(n)
    if n <= 5:
        return "4-5"
    if n <= 10:
        return "6-10"
    return "11+"


async def load(minads):
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=1800)
    rows = await c.fetch(f"""
        SELECT cr.building_pk pk, cr.floor,
               count(*) ads,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY cr.rent/cr.area_c) unit,
               ST_X(b.geom) lng, ST_Y(b.geom) lat
          FROM master._crawl_rent cr
          JOIN master.buildings b ON b.building_pk = cr.building_pk
         WHERE cr.building_pk IS NOT NULL AND cr.floor IS NOT NULL
           AND cr.rent/cr.area_c BETWEEN 3000 AND 400000
           AND b.geom IS NOT NULL
         GROUP BY 1,2,5,6 HAVING count(*) >= {minads}""")
    await c.close()
    out = []
    for r in rows:
        out.append({"pk": r["pk"], "n": r["floor"], "b": bucket(r["floor"]),
                    "u": float(r["unit"]), "ads": r["ads"],
                    "lng": float(r["lng"]), "lat": float(r["lat"])})
    return out


_R = 6371008.8


def dist(a, b):
    x = math.radians(b["lng"] - a["lng"]) * math.cos(math.radians((a["lat"] + b["lat"]) * 0.5))
    y = math.radians(b["lat"] - a["lat"])
    return _R * math.hypot(x, y)


def grid_index(rows, cell_m=250):
    """격자 색인 — 반경 검색을 O(n²) 에서 내린다. 250m 칸에 담고 이웃 칸만 본다."""
    g = {}
    for r in rows:
        gx = int(r["lng"] * 111320 * math.cos(math.radians(r["lat"])) / cell_m)
        gy = int(r["lat"] * 111320 / cell_m)
        r["_g"] = (gx, gy)
        g.setdefault((gx, gy), []).append(r)
    return g


def neighbors(g, r, span):
    gx, gy = r["_g"]
    out = []
    for dx in range(-span, span + 1):
        for dy in range(-span, span + 1):
            out += g.get((gx + dx, gy + dy), [])
    return out


def run(rows, R=500.0, minc=3, w_pow=1.0, same_floor=False, cell=250):
    """leave-one-out 예측 — 주변 같은 층대 호가의 거리가중 기하평균."""
    g = grid_index(rows, cell)
    span = int(R / cell) + 1
    rat, used = [], []
    for t in rows:
        num = den = 0.0
        k = 0
        for c in neighbors(g, t, span):
            if c["pk"] == t["pk"]:
                continue
            if (c["n"] != t["n"]) if same_floor else (c["b"] != t["b"]):
                continue
            d = dist(t, c)
            if d > R:
                continue
            w = 1.0 / ((d + 50) ** w_pow)
            num += w * math.log(c["u"])
            den += w
            k += 1
        if k < minc:
            continue
        pred = math.exp(num / den)
        rat.append(pred / t["u"])
        used.append(k)
    if not rat:
        return None
    ape = [abs(x - 1) * 100 for x in rat]
    return {"n": len(rat), "cover": len(rat) / len(rows) * 100,
            "med": st.median(rat), "MdAPE": st.median(ape),
            "hit20": sum(1 for e in ape if e <= 20) / len(ape) * 100,
            "sd": st.pstdev([math.log(x) for x in rat if x > 0]),
            "ncomp": st.median(used)}


def show(name, r):
    if not r:
        print(f"{name:34s}  —")
        return
    print(f"{name:34s} n={r['n']:6d} 덮음 {r['cover']:4.1f}%  비율 {r['med']:5.2f}"
          f"  MdAPE {r['MdAPE']:5.1f}%  ±20% {r['hit20']:4.1f}%  로그SD {r['sd']:.3f}"
          f"  comp {r['ncomp']:.0f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--minads", type=int, default=1)
    a = ap.parse_args()
    rows = asyncio.run(load(a.minads))
    print(f"표본 {len(rows):,}(건물×층) · {len({r['pk'] for r in rows}):,}동")
    print("현행 요율 방식: MdAPE 33.1% · 로그SD 0.541 / v2(자리변수) 31.3% · 0.512\n")

    print("[반경] 층대(지하·1·2·3·4-5·6-10·11+)를 맞춘 comp")
    for R in (200, 300, 500, 800, 1200):
        show(f"  R={R}m", run(rows, R=float(R)))

    print("\n[최소 comp 수] R=500m")
    for m in (1, 2, 3, 5, 10):
        show(f"  comp>={m}", run(rows, R=500.0, minc=m))

    print("\n[거리 가중 지수] R=500m")
    for p in (0.5, 1.0, 1.5, 2.0):
        show(f"  1/(d+50)^{p}", run(rows, R=500.0, w_pow=p))

    print("\n[같은 층만 vs 층대] R=500m")
    show("  층대(버킷)", run(rows, R=500.0))
    show("  정확히 같은 층", run(rows, R=500.0, same_floor=True))

    print("\n[매물 2건 이상인 층만 잣대로] — 호가 노이즈를 더 걷어내고")
    rows2 = [r for r in rows if r["ads"] >= 2]
    print(f"  표본 {len(rows2):,}")
    show("  R=500m", run(rows2, R=500.0))


if __name__ == "__main__":
    main()
