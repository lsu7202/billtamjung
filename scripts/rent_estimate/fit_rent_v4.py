"""임대 v4 계수 굽기 — 공시지가 주축 산식의 상수를 rent_common 에 박을 형태로 뽑는다(2026-08-30).

## 왜 바꾸나
지금 산식은 부동산원 상권 요율만 쓴다. 그 표는 서울을 68칸으로만 나눈다 —
같은 상권 안에서 어느 자리인지를 못 본다. 공시지가는 **필지마다** 다르다.
구를 갈라 학습·검증한 실측(experiment_rent_v3): 절반이 32.9% 안 → 28.2% 안.

## 산식
    층 단가(원/㎡ 임대면적/월)
      = K × a[층대] × 공시지가^b[층대]
        × clamp(상권요율상대 ÷ rmed, 0.5, 2.0) ^ KR
        × (1 − KA) ^ min(연식/10, 4)
        × clamp(역거리 ÷ 400, 0.5, 2.0) ^ (−KS)

a·b·rmed·K 는 여기서 한 번 굽는다. **예측에는 공시지가·상권요율·연식·역거리만 들어간다** —
네이버 크롤은 계수를 굽는 자리에만 있고 산식의 입력이 아니다(층별 호가보정 상수와 같은 성격).

## 눈금(K)
크롤은 **호가**고 부동산원 표는 **실계약**이다. 크롤 중앙에 맞추면 전 서울 임대추정이
한꺼번에 19% 올라간다 — 호가를 계약가로 내미는 셈이다. 그래서 K 는
**지금 산식의 중앙값을 그대로 잇게** 잡는다. 흩어짐만 줄이고 레벨은 건드리지 않는다.

    backend/.venv/bin/python scripts/rent_estimate/fit_rent_v4.py
"""
import asyncio
import json
import math
import os
import statistics as st
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import rent_common as RC                                  # noqa: E402
from backtest_rent import load, predict                   # noqa: E402
from experiment_rent_comp import bucket                   # noqa: E402
from residual_rent import enrich                          # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_rent_v4_coef.json")
KR, KA, KS = 0.4, 0.06, 0.05      # experiment_rent_v3 가 검증셋에서 고른 값
MIN_N = 150                        # 층대별 적합 최소 표본 — 모자라면 전체 적합으로 폴백


def fit_pow(xs, ys):
    """y = a·x^b 를 로그 최소제곱으로."""
    lx = [math.log(x) for x in xs]
    ly = [math.log(y) for y in ys]
    mx, my = st.mean(lx), st.mean(ly)
    den = sum((a - mx) ** 2 for a in lx)
    b = (sum((a - mx) * (c - my) for a, c in zip(lx, ly)) / den) if den else 0.0
    return math.exp(my - b * mx), b


def rate_rel(s):
    """이 건물의 상권 요율 ÷ 서울평균 요율(같은 층). 「이 동네 임대료 수준」만 빌린다."""
    t = RC.TBL.get(s["series"]) or {}
    a, b = t.get(s.get("sang") or ""), t.get(RC.SEOUL_AVG)
    if not a or not b:
        return None
    ra, rb = RC.pick_rate(s["series"], s["label"], a), RC.pick_rate(s["series"], s["label"], b)
    return (ra / rb) if (ra and rb and rb > 0) else None


def main():
    rows = asyncio.run(load())
    rows = asyncio.run(enrich(rows))
    rows = [s for s in rows if s.get("g") and s["g"] > 0 and s.get("crawl_unit")]
    for s in rows:
        s["b"] = bucket(s["n"])
    print(f"표본 {len(rows):,}층 · 건물 {len({s['pk'] for s in rows}):,}동")

    # ── 층대별 멱함수 적합 ──
    by = defaultdict(list)
    for s in rows:
        by[s["b"]].append(s)
    co = {"_": list(fit_pow([x["g"] for x in rows], [x["crawl_unit"] for x in rows]))}
    for b, v in sorted(by.items()):
        if len(v) >= MIN_N:
            co[b] = list(fit_pow([x["g"] for x in v], [x["crawl_unit"] for x in v]))
    rr = [r for r in (rate_rel(s) for s in rows) if r]
    rmed = st.median(rr) if rr else 1.0

    print("\n[층대별 계수]  단가 = a × 공시지가^b")
    for b in ("B", "1", "2", "3", "4-5", "6-10", "11+", "_"):
        if b in co:
            print(f"  {b:<5} n={len(by.get(b, [])):6,}  a={co[b][0]:.6g}  b={co[b][1]:.4f}")
    print(f"  상권요율 상대값 중앙(rmed) = {rmed:.4f}")

    # ── 눈금 K — 지금 산식의 중앙을 그대로 잇는다 ──
    def raw(s):
        a, b = co.get(s["b"], co["_"])
        p = a * s["g"] ** b
        if s["n"] <= -3:
            p *= RC.DEEP_B          # 지하3 이하 감쇠 — rent_common 과 같은 규칙
        r = rate_rel(s)
        if r:
            p *= max(0.5, min(2.0, r / rmed)) ** KR
        if s.get("approval"):
            y = str(s["approval"])[:4]
            if y.isdigit():
                p *= (1.0 - KA) ** min((2026 - int(y)) / 10, 4)
        if s.get("sd") is not None:
            p *= max(0.5, min(2.0, s["sd"] / 400.0)) ** (-KS)
        return p

    pairs = []
    for s in rows:
        # ★ v3=True 필수 — backtest_rent.predict 는 이제 v4 를 먼저 본다.
        #   그냥 부르면 v4 로 v4 를 재게 되어 K 가 무조건 1 이 나온다.
        old = predict(s, eff=RC.EFF_RATIO, v3=True)   # v3(상권 요율)이 내던 단가
        new = raw(s)
        if old and new:
            pairs.append((old, new, s["crawl_unit"]))
    K = st.median([o / n for o, n, _ in pairs])
    print(f"\n[눈금] 겹치는 표본 {len(pairs):,}층 · K = {K:.6g}  (지금 산식 중앙에 맞춤)")

    r_old = st.median([o / c for o, _, c in pairs])
    r_new = st.median([n * K / c for _, n, c in pairs])
    e_old = st.median([abs(o / c - 1) * 100 for o, _, c in pairs])
    e_new = st.median([abs(n * K / c - 1) * 100 for _, n, c in pairs])
    print(f"  호가 대비 중앙   지금 {r_old:.3f} → v4 {r_new:.3f}   (레벨 유지가 목표)")
    print(f"  절반이 이 안에   지금 {e_old:.1f}% → v4 {e_new:.1f}%")

    json.dump({"co": co, "rmed": rmed, "K": K, "KR": KR, "KA": KA, "KS": KS,
               "n": len(rows), "fitted": "2026-08-30"},
              open(OUT, "w"), ensure_ascii=False, indent=1)
    print(f"\n→ {OUT}")


if __name__ == "__main__":
    main()
