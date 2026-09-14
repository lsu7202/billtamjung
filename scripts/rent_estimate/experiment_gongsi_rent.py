"""공시지가로 임대료를 어디까지 맞힐 수 있나(2026-08-29).

물음: 부동산원 표는 상권×층까지만 준다. 그 안에서 「이 건물이 어디 서 있나」를
공시지가로 대신할 수 있나?

공시지가가 관계가 있는 건 이미 봤다(잔차와의 순위상관 +0.355 · 분위별 0.84→1.47).
그런데 산식에 넣으니 오차가 33.1% → 32.3% 로 0.8%p 밖에 안 줄었다.
관계는 있는데 왜 안 줄어드는지를 확인한다.

세 갈래를 같은 잣대로 나란히 잰다:
  ① 상권 요율만          — 지금 방식
  ② 공시지가만           — 땅값으로 임대료를 직접 설명
  ③ 상권 요율 + 공시지가  — 둘을 합친 것
  ④ 주변 호가            — 옆 건물이 실제로 받는 값

    backend/.venv/bin/python scripts/rent_estimate/experiment_gongsi_rent.py
"""
import asyncio
import math
import statistics as st
from collections import defaultdict

import rent_common as RC
from backtest_rent import load, predict
from residual_rent import enrich, spearman
from experiment_rent_comp import bucket, dist, grid_index, neighbors


def fit_pow(xs, ys):
    """로그-로그 최소제곱: y = a · x^b. (a, b) 반환."""
    lx = [math.log(x) for x in xs]
    ly = [math.log(y) for y in ys]
    mx, my = st.mean(lx), st.mean(ly)
    num = sum((a - mx) * (b - my) for a, b in zip(lx, ly))
    den = sum((a - mx) ** 2 for a in lx)
    b = num / den if den else 0.0
    return math.exp(my - b * mx), b


def err(rat):
    ape = [abs(x - 1) * 100 for x in rat]
    return {"n": len(rat), "med": st.median(rat), "mid": st.median(ape),
            "hit20": sum(1 for e in ape if e <= 20) / len(ape) * 100,
            "hit30": sum(1 for e in ape if e <= 30) / len(ape) * 100}


def show(name, r):
    if not r:
        print(f"  {name:30s} —")
        return
    print(f"  {name:30s} n={r['n']:6d}  절반이 {r['mid']:5.1f}% 안"
          f"  ±20% {r['hit20']:4.1f}%  ±30% {r['hit30']:4.1f}%")


def main():
    rows = asyncio.run(load())
    rows = asyncio.run(enrich(rows))
    rows = [s for s in rows if s.get("g")]
    for s in rows:
        s["b"] = bucket(s["n"])       # backtest_rent.load 는 층 정수만 준다
    print(f"표본 {len(rows):,}(건물×층, 공시지가 있는 것) · {len({r['pk'] for r in rows}):,}동\n")

    # ── ① 상권 요율만(눈금을 맞춘 뒤) ───────────────────────────────
    p1 = {}
    for s in rows:
        p = predict(s, eff=1.0)
        if p:
            p1[id(s)] = p
    k = st.median([s["crawl_unit"] / p1[id(s)] for s in rows if id(s) in p1])
    r1 = err([p1[id(s)] * k / s["crawl_unit"] for s in rows if id(s) in p1])

    # ── ② 공시지가만 ────────────────────────────────────────────
    # 층마다 따로 맞춘다 — 1층과 8층은 같은 땅 위에서도 단가가 다르다
    by_b = defaultdict(list)
    for s in rows:
        by_b[s["b"]].append(s)
    r2rat = []
    coef = {}
    for b, v in by_b.items():
        if len(v) < 200:
            continue
        a, e = fit_pow([x["g"] for x in v], [x["crawl_unit"] for x in v])
        coef[b] = (a, e)
        for x in v:
            r2rat.append((a * x["g"] ** e) / x["crawl_unit"])
    r2 = err(r2rat)

    # ── ③ 상권 요율 × 공시지가 상대값 ───────────────────────────────
    G = defaultdict(list)
    for s in rows:
        G[s.get("sang") or "_"].append(s["g"])
    gmed = {kk: st.median(v) for kk, v in G.items() if len(v) >= 20}
    gall = st.median([s["g"] for s in rows])
    best3 = None
    for e in (0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0):
        vals = []
        for s in rows:
            p = p1.get(id(s))
            if not p:
                continue
            rel = s["g"] / gmed.get(s.get("sang") or "_", gall)
            vals.append(p * max(0.35, min(3.0, rel)) ** e)
        kk = st.median([s["crawl_unit"] / v for s, v in
                        zip([x for x in rows if id(x) in p1], vals)])
        rr = err([v * kk / s["crawl_unit"] for s, v in
                  zip([x for x in rows if id(x) in p1], vals)])
        if best3 is None or rr["mid"] < best3[1]["mid"]:
            best3 = (e, rr)

    # ── ④ 주변 호가 ────────────────────────────────────────────
    # 좌표를 붙인다 — backtest_rent.load 는 좌표를 안 준다
    import asyncpg, os
    async def _xy(pks):
        c = await asyncpg.connect(os.environ.get(
            "RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung"),
            timeout=60, command_timeout=600)
        r = await c.fetch("SELECT building_pk pk, ST_X(geom) lng, ST_Y(geom) lat"
                          "  FROM master.buildings WHERE building_pk = ANY($1)", list(pks))
        await c.close()
        return {x["pk"]: (float(x["lng"]), float(x["lat"])) for x in r if x["lng"]}
    XY = asyncio.run(_xy({s["pk"] for s in rows}))
    rows = [s for s in rows if s["pk"] in XY]
    for s in rows:
        s["lng"], s["lat"] = XY[s["pk"]]
    g = grid_index(rows, 250)
    r4rat = []
    for t in rows:
        num = den = n = 0
        for c in neighbors(g, t, 3):
            if c["pk"] == t["pk"] or c["b"] != t["b"]:
                continue
            d = dist(t, c)
            if d > 500:
                continue
            w = 1.0 / ((d + 50) ** 2)
            num += w * math.log(c["crawl_unit"]); den += w; n += 1
        if n >= 3:
            r4rat.append(math.exp(num / den) / t["crawl_unit"])
    r4 = err(r4rat)

    print("[네 갈래를 같은 잣대로]")
    show("① 상권 요율만(지금)", r1)
    show("② 공시지가만", r2)
    show(f"③ 상권 요율 + 공시^{best3[0]}", best3[1])
    show("④ 주변 호가 ※산식엔 못 씀", r4)
    print("     ※ ④는 네이버 크롤을 입력으로 쓰는 것이라 제품엔 넣을 수 없다.")
    print("        갱신 때마다 남의 사이트를 긁어야 하고, 막히면 임대시세가 멈춘다.")
    print("        여기선 「자리를 완벽히 알면 어디까지 가나」를 보는 참고선으로만 둔다.")

    print("\n[공시지가 ↔ 임대 단가, 층별로 따로 잰 관계]")
    print("  지수 1.0 이면 「땅값 2배 = 임대료 2배」. 낮을수록 관계가 약하다.")
    for b in ("B", "1", "2", "3", "4-5", "6-10", "11+"):
        if b not in coef:
            continue
        v = by_b[b]
        sp = spearman([x["g"] for x in v], [x["crawl_unit"] for x in v])
        print(f"  {b:5s} n={len(v):6d}  지수 {coef[b][1]:5.2f}  순위상관 {sp:+.3f}")

    print("\n[같은 상권·같은 층에서 공시지가가 비슷한 건물끼리도 다른가]")
    # 공시지가 5% 이내로 비슷한 짝을 찾아 임대료가 얼마나 벌어지는지
    pair = defaultdict(list)
    for s in rows:
        if s.get("sang"):
            pair[(s["sang"], s["b"], round(math.log(s["g"]) * 20))].append(s["crawl_unit"])
    sds = [st.pstdev([math.log(x) for x in v]) for v in pair.values() if len(v) >= 3]
    if sds:
        m = st.median(sds)
        print(f"  묶음 {len(sds):,}개 · 그 안에서 임대료 차이 중앙 ±{(math.exp(m)-1)*100:.0f}%")
        print("  ← 상권·층·땅값이 다 같아도 이만큼 벌어진다. 공시지가로는 여기까지가 끝이다.")


if __name__ == "__main__":
    main()
