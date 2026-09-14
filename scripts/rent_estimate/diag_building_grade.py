"""건물값은 땅값과 다른가 — 엘리베이터·주차를 따로 뜯어본다(2026-08-29).

내가 「공시지가가 엘리베이터를 이미 먹고 있다」고 했는데, 그건 게으른 설명이다.
**공시지가는 땅값이고 엘리베이터는 건물값이다.** 같은 땅 위에 좋은 건물과 나쁜 건물이
설 수 있으니 원래 다른 축이다. 그런데 실험에서는 엘리베이터를 넣어도 0.3%p 밖에 안 줄었다.

왜 그런지 세 갈래로 확인한다:
  ① **결측** — 엘리베이터·주차 값이 얼마나 비어 있나. 비어 있으면 효과가 안 나온다.
  ② **날것 차이** — 공시지가를 안 보고, 엘리베이터 유무만으로 호가가 갈리나.
  ③ **땅값을 묶고 나서** — 같은 공시지가 구간 안에서도 엘리베이터가 갈리나.
     여기서 갈리면 「겹친다」는 내 말이 틀린 것이다.

    backend/.venv/bin/python scripts/rent_estimate/diag_building_grade.py
"""
import asyncio
import math
import os
import statistics as st
from collections import defaultdict

import asyncpg
import rent_common as RC
from remeasure import bucket, load

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")


def med(v):
    return st.median(v) if v else None


def main():
    rows = asyncio.run(load())
    print(f"표본 {len(rows):,}(건물×층) · {len({s['pk'] for s in rows}):,}동\n")

    print("[① 결측] 값이 없으면 아무 효과도 못 낸다")
    for key, ko in (("ev", "엘리베이터"), ("pk_n", "주차"), ("ta", "연면적"), ("sd", "역거리")):
        n = sum(1 for s in rows if s.get(key) is not None)
        z = sum(1 for s in rows if s.get(key) == 0)
        print(f"  {ko:8s} 값 있음 {n*100/len(rows):5.1f}%  ·  0인 것 {z*100/len(rows):5.1f}%")

    print("\n[② 날것] 공시지가를 안 보고, 엘리베이터 유무만으로 호가가 갈리나")
    print("   지상 3층 이상만 본다 — 저층은 엘리베이터가 없어도 되니 섞으면 안 된다")
    hi = [s for s in rows if s["floor"] >= 3]
    g = defaultdict(list)
    for s in hi:
        if s.get("ev") is None:
            continue
        g["있음" if s["ev"] > 0 else "없음"].append(s["u"])
    for k in ("있음", "없음"):
        if g[k]:
            print(f"   엘리베이터 {k}  n={len(g[k]):6,}  ㎡당 중앙 {med(g[k]):8,.0f}원")
    if g["있음"] and g["없음"]:
        print(f"   → 있는 쪽이 {med(g['있음'])/med(g['없음']):.2f}배")

    print("\n[③ 땅값을 묶고 나서] 같은 공시지가 구간 안에서 비교")
    print("   공시지가를 5칸으로 자르고, 칸마다 엘리베이터 유무를 견준다.")
    print("   여기서도 갈리면 두 축은 겹치지 않는 것이다.")
    v = sorted([s for s in hi if s.get("g") and s.get("ev") is not None], key=lambda s: s["g"])
    step = max(1, len(v) // 5)
    print(f"   {'공시지가 구간':>18s} {'있음':>10s} {'없음':>10s} {'배율':>7s} {'표본':>12s}")
    for i in range(5):
        seg = v[i*step:(i+1)*step] if i < 4 else v[i*step:]
        if not seg:
            continue
        a = [s["u"] for s in seg if s["ev"] > 0]
        b = [s["u"] for s in seg if s["ev"] == 0]
        if len(a) >= 30 and len(b) >= 30:
            print(f"   {seg[0]['g']/1e4:8,.0f}~{seg[-1]['g']/1e4:8,.0f}만"
                  f" {med(a):10,.0f} {med(b):10,.0f} {med(a)/med(b):7.2f}"
                  f" {len(a):5,}/{len(b):5,}")

    print("\n[③-2] 층별로 — 높은 층일수록 엘리베이터가 중요할 것이다")
    print(f"   {'층':>6s} {'있음':>10s} {'없음':>10s} {'배율':>7s} {'표본':>12s}")
    for lo, hi2, ko in ((3, 3, "3층"), (4, 5, "4-5층"), (6, 10, "6-10층"), (11, 99, "11층+")):
        seg = [s for s in rows if lo <= s["floor"] <= hi2 and s.get("ev") is not None]
        a = [s["u"] for s in seg if s["ev"] > 0]
        b = [s["u"] for s in seg if s["ev"] == 0]
        if len(a) >= 30 and len(b) >= 30:
            print(f"   {ko:>6s} {med(a):10,.0f} {med(b):10,.0f} {med(a)/med(b):7.2f}"
                  f" {len(a):5,}/{len(b):5,}")

    print("\n[④ 공시지가와 엘리베이터가 실제로 얼마나 겹치나]")
    v2 = [s for s in rows if s.get("g") and s.get("ev") is not None]
    v2.sort(key=lambda s: s["g"])
    step = max(1, len(v2) // 5)
    print(f"   {'공시지가 구간':>20s} {'엘리베이터 있는 비율':>20s}")
    for i in range(5):
        seg = v2[i*step:(i+1)*step] if i < 4 else v2[i*step:]
        if seg:
            p = sum(1 for s in seg if s["ev"] > 0) * 100 / len(seg)
            print(f"   {seg[0]['g']/1e4:8,.0f}~{seg[-1]['g']/1e4:8,.0f}만 {p:19.1f}%")
    print("   ← 땅값이 오를수록 엘리베이터 있는 비율이 오르면 두 축이 겹치는 것이고,")
    print("     비슷하면 안 겹치는 것이다.")


if __name__ == "__main__":
    main()
