"""남은 오차 25%의 정체(2026-08-29).

「상권·층·공시지가·연식·용도가 다 같은 건물끼리도 임대료가 벌어진다」까지는 쟀는데,
그 벌어짐이 **무엇 때문인지는 안 봤다.** 추측으로 「임차인 구성」이라 했는데 증명이 없다.

크롤은 호실 단위 매물이라 우리가 못 보던 걸 직접 잴 수 있다:

  ① **면적** — 임대는 작은 호실일수록 단가가 비싸다(소형 프리미엄).
     그런데 우리가 추정하는 건 **층 전체**고 크롤은 **그 층의 한 호실**이다.
     둘을 그냥 대면 면적 차이가 통째로 오차로 잡힌다 — **잣대 자체의 편향**이다.
  ② **전용률**(전용÷계약) — 같은 계약면적이라도 실제 쓰는 면적이 다르면 값이 다르다.
  ③ **호실 수** — 층을 잘게 쪼갠 건물과 통으로 쓰는 건물.

    backend/.venv/bin/python scripts/rent_estimate/diag_residual_rent.py
"""
import asyncio
import math
import os
import statistics as st
from collections import defaultdict

import asyncpg

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")


def qcut(rows, key, n=6):
    v = [r for r in rows if r.get(key) is not None]
    v.sort(key=lambda r: r[key])
    step = max(1, len(v) // n)
    out = []
    for i in range(n):
        seg = v[i * step:(i + 1) * step] if i < n - 1 else v[i * step:]
        if seg:
            out.append(seg)
    return out


async def main():
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=1800)

    print("[1] 계약면적과 단가 — 작은 호실이 비싼가")
    rows = await c.fetch("""
        SELECT area_c, area_e, rent, floor, building_pk
          FROM master._crawl_rent
         WHERE building_pk IS NOT NULL AND floor IS NOT NULL
           AND rent/area_c BETWEEN 3000 AND 400000 AND area_c > 0""")
    R = [{"a": float(r["area_c"]), "e": float(r["area_e"] or 0) or None,
          "u": float(r["rent"]) / float(r["area_c"]), "f": r["floor"],
          "pk": r["building_pk"]} for r in rows]
    print(f"  매물 {len(R):,}건")
    for seg in qcut(R, "a"):
        a = [x["a"] for x in seg]
        u = [x["u"] for x in seg]
        print(f"    계약면적 {st.median(a):7.0f}㎡  단가 중앙 {st.median(u):8,.0f}원/㎡")
    # 층을 고정하고 다시 — 층 효과와 섞이지 않게
    print("  1층만:")
    one = [x for x in R if x["f"] == 1]
    for seg in qcut(one, "a", 5):
        print(f"    계약면적 {st.median([x['a'] for x in seg]):7.0f}㎡"
              f"  단가 중앙 {st.median([x['u'] for x in seg]):8,.0f}원/㎡")

    print("\n[2] 같은 건물·같은 층 안에서 — 면적이 다르면 단가도 다른가")
    g = defaultdict(list)
    for x in R:
        g[(x["pk"], x["f"])].append(x)
    pairs = []
    for v in g.values():
        if len(v) < 2:
            continue
        v2 = sorted(v, key=lambda x: x["a"])
        lo, hi = v2[0], v2[-1]
        if lo["a"] > 0 and hi["a"] / lo["a"] >= 1.5:
            pairs.append((hi["a"] / lo["a"], lo["u"] / hi["u"]))
    if pairs:
        print(f"  같은 층에 면적 1.5배 이상 차이 나는 짝 {len(pairs):,}개")
        print(f"  작은 호실 단가 ÷ 큰 호실 단가 중앙 {st.median([p[1] for p in pairs]):.2f}")
        print("    ← 1.00 보다 크면 작은 호실이 비싸다(소형 프리미엄)")

    print("\n[3] 전용률(전용÷계약)과 단가")
    E = [x for x in R if x["e"] and x["a"] and 0.2 < x["e"] / x["a"] < 1.0]
    for x in E:
        x["r"] = x["e"] / x["a"]
    print(f"  전용면적 있는 매물 {len(E):,}건 · 전용률 중앙 {st.median([x['r'] for x in E]):.3f}")
    for seg in qcut(E, "r"):
        print(f"    전용률 {st.median([x['r'] for x in seg]):.3f}"
              f"  단가 중앙 {st.median([x['u'] for x in seg]):8,.0f}원/㎡")

    print("\n[4] 한 층에 매물이 몇 개인가 — 잘게 쪼갠 층이 비싼가")
    cnt = defaultdict(list)
    for k, v in g.items():
        b = "1개" if len(v) == 1 else ("2-4" if len(v) <= 4 else ("5-9" if len(v) <= 9 else "10+"))
        cnt[b].append(st.median([x["u"] for x in v]))
    for k in ("1개", "2-4", "5-9", "10+"):
        if k in cnt:
            print(f"    호실 {k:4s}  층 {len(cnt[k]):6,}개  단가 중앙 {st.median(cnt[k]):8,.0f}원/㎡")

    print("\n[5] 우리가 추정하는 면적 vs 크롤 매물 면적")
    print("  우리 산식은 **층 전체 면적**에 단가를 곱한다. 크롤은 **그 층의 한 호실**이다.")
    pks = list({x["pk"] for x in R})
    fo = await c.fetch("SELECT building_pk pk, floor, floor_area::float a"
                       "  FROM master.floor_outline WHERE building_pk = ANY($1)", pks)
    import sys, os as _os
    sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
    from rent_common import signed_floor
    FL = defaultdict(float)
    for r in fo:
        n = signed_floor(r["floor"])
        if n is not None and r["a"]:
            FL[(r["pk"], n)] += r["a"]
    rat = []
    for k, v in g.items():
        fa = FL.get(k)
        if fa and fa > 0:
            rat.append(st.median([x["a"] for x in v]) / fa)
    if rat:
        print(f"  (건물,층) {len(rat):,}개 · 크롤 매물면적 ÷ 대장 층면적 중앙 {st.median(rat):.2f}")
        print("    ← 1.0 보다 작으면 크롤 매물이 층의 일부만 차지한다는 뜻")
        for lo, hi, ko in ((0, 0.3, "층의 30% 미만"), (0.3, 0.7, "30~70%"), (0.7, 9, "70% 이상")):
            v = [(k, r) for (k, r) in zip(g.keys(), rat) if lo <= r < hi]
            if len(v) >= 100:
                us = [st.median([x["u"] for x in g[k]]) for k, _ in v]
                print(f"    {ko:14s} {len(v):6,}개  단가 중앙 {st.median(us):8,.0f}원/㎡")
    await c.close()


if __name__ == "__main__":
    asyncio.run(main())
