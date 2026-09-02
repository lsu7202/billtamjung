"""상권 매칭 진단 — 상권 요율을 쓰면 왜 더 틀리나(2026-08-29).

backtest_rent.py 가 낸 이상한 결과:

    상권 매칭    n=41,732  비율 중앙 0.79   MdAPE 33.8%
    서울평균 폴백  n=12,664  비율 중앙 1.03   MdAPE 35.0%

상권 요율을 **찾아 쓴 쪽이 더 과소평가**한다. 상권을 못 찾아 서울평균으로 때운 쪽이
오히려 눈금이 맞는다. 그럴 리가 없다 — 상권 요율은 그 동네를 직접 잰 값이다.

의심 셋:
  ① 매칭이 틀렸다 — 1.5km 최근접 폴백이 엉뚱한 상권을 물어온다
  ② 상권 요율 자체가 호가보다 낮다 — 부동산원은 실계약, 네이버는 부르는 값
  ③ 폴백이 우연히 맞다 — 서울평균이 높아서 호가와 비슷해진 것

    backend/.venv/bin/python scripts/rent_estimate/diag_sanggwon.py
"""
import asyncio
import math
import os
import statistics as st
from collections import defaultdict

import asyncpg
import rent_common as RC
from backtest_rent import load, predict

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")


async def dist_to_sang(pks):
    """건물 → 상권 거리(0 = 상권 안). 폴백이 얼마나 멀리서 물어오는지 본다."""
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=900)
    rows = await c.fetch("""
        SELECT b.building_pk pk,
               (SELECT nm FROM master.sanggwon sg WHERE ST_Contains(sg.geom, b.geom) LIMIT 1) inside,
               (SELECT ST_Distance(sg.geom::geography, b.geom::geography)
                  FROM master.sanggwon sg
                 WHERE ST_DWithin(sg.geom::geography, b.geom::geography, 1500)
                 ORDER BY sg.geom::geography <-> b.geom::geography LIMIT 1) d
          FROM master.buildings b WHERE b.building_pk = ANY($1)""", list(pks))
    await c.close()
    return {r["pk"]: dict(r) for r in rows}


def main():
    rows = asyncio.run(load())
    D = asyncio.run(dist_to_sang({r["pk"] for r in rows}))
    for s in rows:
        d = D.get(s["pk"], {})
        s["_inside"] = d.get("inside")
        s["_sdist"] = d.get("d")
        p = predict(s, eff=RC.EFF_RATIO)
        s["_ratio"] = (p / s["crawl_unit"]) if p else None
    ok = [s for s in rows if s["_ratio"]]
    print(f"표본 {len(ok):,}층\n")

    print("[1] 상권 안 vs 밖(최근접 폴백) — 매칭 품질")
    g = defaultdict(list)
    for s in ok:
        if s["_inside"]:
            g["상권 안"].append(s["_ratio"])
        elif s["_sdist"] is not None:
            b = "밖 0~300m" if s["_sdist"] < 300 else ("밖 300~800m" if s["_sdist"] < 800 else "밖 800m+")
            g[b].append(s["_ratio"])
        else:
            g["상권 없음(1.5km 밖)"].append(s["_ratio"])
    for k in ("상권 안", "밖 0~300m", "밖 300~800m", "밖 800m+", "상권 없음(1.5km 밖)"):
        v = g.get(k)
        if v:
            print(f"  {k:20s} n={len(v):6d}  비율 {st.median(v):5.2f}"
                  f"  MdAPE {st.median([abs(x-1)*100 for x in v]):5.1f}%")

    print("\n[2] 요율의 출신 — 상권 요율 vs 서울평균 폴백")
    g2 = defaultdict(list)
    for s in ok:
        _, mapped = RC.rate_for(s["series"], s["sang"])
        g2["상권 요율" if mapped else "서울평균"].append(s["_ratio"])
    for k, v in g2.items():
        print(f"  {k:20s} n={len(v):6d}  비율 {st.median(v):5.2f}"
              f"  MdAPE {st.median([abs(x-1)*100 for x in v]):5.1f}%")

    print("\n[3] 서울평균 요율 vs 상권 요율의 크기 — 폴백이 더 큰가")
    for series in ("오피스", "중대형상가", "소규모상가"):
        t = RC.TBL[series]
        avg = t.get(RC.SEOUL_AVG) or {}
        sangs = [k for k in t if k != RC.SEOUL_AVG]
        for lab in ("1층", "2층"):
            a = avg.get(lab)
            vs = [t[k][lab] for k in sangs if lab in t[k]]
            if a and vs:
                print(f"  {series:8s} {lab}  서울평균 {a:7.1f}  상권중앙 {st.median(vs):7.1f}"
                      f"  (평균/중앙 {a/st.median(vs):4.2f})  상권 {len(vs)}개")

    print("\n[4] 상권별 — 잘 맞는 곳과 안 맞는 곳(n≥200)")
    g3 = defaultdict(list)
    for s in ok:
        if s["sang"]:
            g3[s["sang"]].append(s["_ratio"])
    g3 = {k: v for k, v in g3.items() if len(v) >= 200}
    srt = sorted(g3.items(), key=lambda t: st.median(t[1]))
    print("  --- 가장 과소(우리가 낮게 본다) ---")
    for k, v in srt[:8]:
        print(f"    {k[:16]:18s} n={len(v):5d}  비율 {st.median(v):5.2f}")
    print("  --- 가장 과대 ---")
    for k, v in srt[-8:]:
        print(f"    {k[:16]:18s} n={len(v):5d}  비율 {st.median(v):5.2f}")
    med = [st.median(v) for v in g3.values()]
    print(f"\n  상권 {len(g3)}개의 비율 중앙: 최소 {min(med):.2f} · 중앙 {st.median(med):.2f}"
          f" · 최대 {max(med):.2f}  ← 벌어진 폭이 곧 상권 요율이 못 잡는 차이")


if __name__ == "__main__":
    main()
