"""임대 comp 방식 + 건물 변수 — 어디까지 줄어드나(2026-08-29).

experiment_rent_comp.py 가 낸 것:
    현행 요율        MdAPE 33.1%  로그SD 0.541
    주변 호가 comp   MdAPE 25.8%  로그SD 0.440   ← -7.3p

그런데 0.440 은 noise_floor_rent.py 가 잰 「같은 상권·같은 층의 건물간 흩어짐」(0.439)과
정확히 같다. 즉 comp 는 **자리를 훨씬 촘촘히 잡았을 뿐, 건물 자체의 차이는 여전히 못 본다.**
바닥은 0.056 이니 아직 멀었다.

그래서 comp 예측 위에 건물 변수를 얹는다. 이번엔 상권 중앙이 아니라
**그 comp 들의 중앙 대비** 상대값이다 — 비교 대상이 곧 기준이어야 결이 맞는다.

    backend/.venv/bin/python scripts/rent_estimate/experiment_rent_comp2.py
"""
import argparse
import asyncio
import math
import os
import statistics as st

import asyncpg

from experiment_rent_comp import bucket, dist, grid_index, neighbors

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")


async def load(minads=2):
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=1800)
    rows = await c.fetch(f"""
        SELECT cr.building_pk pk, cr.floor,
               count(*) ads,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY cr.rent/cr.area_c) unit,
               ST_X(b.geom) lng, ST_Y(b.geom) lat,
               b.gongsi_latest::float g, b.approval_ymd, b.total_area::float ta,
               b.land_area::float la, b.station_dist::float sd, b.elevator::float ev,
               b.road_frontage rf, b.use_zone uz
          FROM master._crawl_rent cr
          JOIN master.buildings b ON b.building_pk = cr.building_pk
         WHERE cr.building_pk IS NOT NULL AND cr.floor IS NOT NULL
           AND cr.rent/cr.area_c BETWEEN 3000 AND 400000
           AND b.geom IS NOT NULL
         GROUP BY 1,2,5,6,7,8,9,10,11,12,13,14 HAVING count(*) >= {minads}""")
    await c.close()
    out = []
    for r in rows:
        y = str(r["approval_ymd"] or "")[:4]
        out.append({"pk": r["pk"], "n": r["floor"], "b": bucket(r["floor"]),
                    "u": float(r["unit"]), "ads": r["ads"],
                    "lng": float(r["lng"]), "lat": float(r["lat"]),
                    "g": r["g"], "age": (2026 - int(y)) if y.isdigit() else None,
                    "ta": r["ta"], "sd": r["sd"], "ev": r["ev"],
                    "far": (r["ta"] / r["la"] * 100) if (r["ta"] and r["la"]) else None})
    return out


def clip(x, lo=0.4, hi=2.5):
    return max(lo, min(hi, x))


def run(rows, R=500.0, minc=3, w_pow=2.0, kg=0.0, ka=0.0, ks=0.0, kf=0.0, cell=250):
    g = grid_index(rows, cell)
    span = int(R / cell) + 1
    rat = []
    for t in rows:
        num = den = 0.0
        gs, ages, k = [], [], 0
        for c in neighbors(g, t, span):
            if c["pk"] == t["pk"] or c["b"] != t["b"]:
                continue
            d = dist(t, c)
            if d > R:
                continue
            w = 1.0 / ((d + 50) ** w_pow)
            num += w * math.log(c["u"]); den += w; k += 1
            if c["g"]:
                gs.append(c["g"])
            if c["age"] is not None:
                ages.append(c["age"])
        if k < minc:
            continue
        pred = math.exp(num / den)
        # comp 들의 중앙 대비 이 건물의 자리 — 비교 대상이 곧 기준이다
        if kg and t["g"] and len(gs) >= 3:
            pred *= clip(t["g"] / st.median(gs)) ** kg
        if ka and t["age"] is not None and len(ages) >= 3:
            pred *= (1.0 - ka) ** ((t["age"] - st.median(ages)) / 10)
        if ks and t["sd"] is not None:
            pred *= clip(t["sd"] / 400.0) ** (-ks)
        if kf and t["far"]:
            pred *= clip(t["far"] / 300.0) ** kf
        rat.append(pred / t["u"])
    if not rat:
        return None
    ape = [abs(x - 1) * 100 for x in rat]
    return {"n": len(rat), "med": st.median(rat), "MdAPE": st.median(ape),
            "hit20": sum(1 for e in ape if e <= 20) / len(ape) * 100,
            "sd": st.pstdev([math.log(x) for x in rat if x > 0])}


def show(name, r, base=None):
    if not r:
        print(f"{name:34s}  —")
        return
    d = f" ({r['MdAPE']-base:+5.1f}p)" if base is not None else " " * 9
    print(f"{name:34s} n={r['n']:6d} 비율 {r['med']:5.2f}  MdAPE {r['MdAPE']:5.1f}%{d}"
          f"  ±20% {r['hit20']:4.1f}%  로그SD {r['sd']:.3f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--minads", type=int, default=2)
    a = ap.parse_args()
    rows = asyncio.run(load(a.minads))
    print(f"표본 {len(rows):,}(건물×층, 매물 {a.minads}건 이상) · {len({r['pk'] for r in rows}):,}동\n")

    b0 = run(rows)
    show("C0 주변 호가 comp", b0)
    base = b0["MdAPE"]
    print()

    print("[공시지가 — comp 중앙 대비]")
    bg = (0.0, base)
    for kg in (0.1, 0.2, 0.3, 0.4, 0.5):
        r = run(rows, kg=kg); show(f"  공시^{kg:.1f}", r, base)
        if r and r["MdAPE"] < bg[1]:
            bg = (kg, r["MdAPE"])
    kg = bg[0]

    print("\n[연식 — comp 중앙 대비, 10년당]")
    ba = (0.0, bg[1])
    for ka in (0.02, 0.04, 0.06, 0.08, 0.12):
        r = run(rows, kg=kg, ka=ka); show(f"  +연식 -{ka*100:.0f}%/10y", r, base)
        if r and r["MdAPE"] < ba[1]:
            ba = (ka, r["MdAPE"])
    ka = ba[0]

    print("\n[역거리 · 용적률]")
    bs = (0.0, ba[1])
    for ks in (0.05, 0.1, 0.2):
        r = run(rows, kg=kg, ka=ka, ks=ks); show(f"  +역^-{ks:.2f}", r, base)
        if r and r["MdAPE"] < bs[1]:
            bs = (ks, r["MdAPE"])
    ks = bs[0]
    bf = (0.0, bs[1])
    for kf in (0.05, 0.1, 0.2):
        r = run(rows, kg=kg, ka=ka, ks=ks, kf=kf); show(f"  +용적^{kf:.2f}", r, base)
        if r and r["MdAPE"] < bf[1]:
            bf = (kf, r["MdAPE"])
    kf = bf[0]

    print("\n[최종]")
    show("C0 주변 호가 comp", b0)
    fin = run(rows, kg=kg, ka=ka, ks=ks, kf=kf)
    show(f"C2 공시^{kg} 연식{ka} 역{ks} 용적{kf}", fin, base)
    print(f"\n  현행 요율 방식 33.1% · 로그SD 0.541")
    print(f"  오차 바닥(매물간)      로그SD 0.056")


if __name__ == "__main__":
    main()
