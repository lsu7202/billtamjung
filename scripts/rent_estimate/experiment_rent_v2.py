"""임대 추정 개선안 실험 — 상권 안 「자리」를 넣는다(2026-08-29).

residual_rent.py 가 찾은 것(표본 54,396층 · 36,302동):

    공시지가   ρ=+0.355  분위별 배율 0.84 → 1.47   ← 제일 크다
    역거리     ρ=-0.207  1.41 → 1.01
    주야비     ρ=+0.189  1.01 → 1.31
    연식       ρ=-0.142  1.54 → 1.20 (단조 아님, U자)

지금 산식은 (상권 요율 × 층 보정)뿐이라 **같은 상권·같은 층이면 서울의 모든 건물이
같은 단가**다. 대로변과 이면도로가 두 배 차이 나는데 그걸 하나도 안 본다.
그래서 층으로 잘라도 계열로 잘라도 MdAPE 가 34% 로 똑같았다.

넣는 방식은 **상권 안에서의 상대값**이다. 절대 공시지가를 곱하면 상권 요율이
이미 담은 지역 레벨을 두 번 세게 된다(주야비를 날것으로 곱했을 때 겪은 실패).

    보정 = (이 건물 공시지가 ÷ 그 상권 공시지가 중앙) ** k

    backend/.venv/bin/python scripts/rent_estimate/experiment_rent_v2.py
"""
import asyncio
import math
import statistics as st
from collections import defaultdict

import rent_common as RC
from backtest_rent import load, predict
from residual_rent import enrich

CLIP = (0.35, 3.0)      # 상대값이 극단이면 가둔다 — 한 건물이 배율 5배가 되면 안 된다


def add_relatives(rows):
    """상권 안 상대값 — 공시지가·역거리·주야비. 상권을 못 찾으면 서울 전체 기준."""
    g_all, s_all, p_all = [], [], []
    G, S, P = defaultdict(list), defaultdict(list), defaultdict(list)
    for s in rows:
        k = s.get("sang") or "_"
        if s.get("g"):
            G[k].append(s["g"]); g_all.append(s["g"])
        if s.get("sd") is not None:
            S[k].append(s["sd"]); s_all.append(s["sd"])
        dn = (s["dpop"] / s["npop"]) if (s.get("dpop") and s.get("npop")) else None
        if dn:
            P[k].append(dn); p_all.append(dn)
        s["_dn"] = dn
    med = lambda d, k, fb: st.median(d[k]) if len(d.get(k, [])) >= 20 else fb
    gfb, sfb, pfb = st.median(g_all), st.median(s_all), st.median(p_all)
    for s in rows:
        k = s.get("sang") or "_"
        s["_rg"] = (s["g"] / med(G, k, gfb)) if s.get("g") else None
        s["_rs"] = (s["sd"] / med(S, k, sfb)) if s.get("sd") is not None and med(S, k, sfb) else None
        s["_rp"] = (s["_dn"] / med(P, k, pfb)) if s["_dn"] else None
    return rows


def clip(x):
    return max(CLIP[0], min(CLIP[1], x))


def predict2(s, eff, kg=0.0, ks=0.0, kp=0.0, ka=0.0):
    """현행 예측 × 자리 보정."""
    p = predict(s, eff=eff)
    if not p:
        return None
    if kg and s.get("_rg"):
        p *= clip(s["_rg"]) ** kg
    if ks and s.get("_rs"):
        p *= clip(s["_rs"]) ** (-ks)          # 멀수록 싸다
    if kp and s.get("_rp"):
        p *= clip(s["_rp"]) ** kp
    if ka and s.get("approval_ymd"):
        y = str(s["approval_ymd"])[:4]
        if y.isdigit():
            age = max(0, 2026 - int(y))
            p *= (1.0 - ka) ** min(age / 10, 4)   # 10년마다 ka, 40년에서 멈춤
    return p


def score2(rows, **kw):
    rat = []
    for s in rows:
        p = predict2(s, **kw)
        if p:
            rat.append(p / s["crawl_unit"])
    if not rat:
        return None
    ape = [abs(r - 1) * 100 for r in rat]
    return {"n": len(rat), "med": st.median(rat), "MdAPE": st.median(ape),
            "hit20": sum(1 for e in ape if e <= 20) / len(ape) * 100,
            "sd": st.pstdev([math.log(r) for r in rat if r > 0])}


def show(name, r, base=None):
    if not r:
        print(f"{name:40s}  —")
        return
    d = f"  ({r['MdAPE']-base:+5.1f}p)" if base is not None else ""
    print(f"{name:40s} 비율 {r['med']:5.2f}  MdAPE {r['MdAPE']:5.1f}%{d}"
          f"  ±20% {r['hit20']:4.1f}%  로그SD {r['sd']:.3f}")


def fit_eff(rows, **kw):
    """비율 중앙이 1.00 이 되게 eff 를 맞춘다 — 눈금과 흩어짐을 따로 본다."""
    lo, hi = 0.2, 3.0
    for _ in range(40):
        mid = (lo + hi) / 2
        r = score2(rows, eff=mid, **kw)
        if not r:
            return None, None
        if r["med"] < 1.0:
            lo = mid
        else:
            hi = mid
    e = (lo + hi) / 2
    return e, score2(rows, eff=e, **kw)


def main():
    rows = asyncio.run(load())
    rows = asyncio.run(enrich(rows))
    rows = add_relatives(rows)
    print(f"표본 {len(rows):,}층 · {len({r['pk'] for r in rows}):,}동\n")

    e0, b0 = fit_eff(rows)
    print("[기준] 눈금을 맞춘 현행 — 여기서부터 흩어짐만 본다")
    show(f"V0 현행(eff={e0:.3f})", b0)
    base = b0["MdAPE"]
    print()

    print("[1] 공시지가 — 상권 안 상대값")
    best_g = (0.0, base)
    for kg in (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8):
        e, r = fit_eff(rows, kg=kg)
        show(f"  공시^{kg:.1f} (eff={e:.3f})", r, base)
        if r and r["MdAPE"] < best_g[1]:
            best_g = (kg, r["MdAPE"])
    kg = best_g[0]
    print(f"  → 최적 공시^{kg:.1f}  MdAPE {best_g[1]:.1f}%\n")

    print("[2] 역거리 — 공시지가 위에 더한다")
    best_s = (0.0, best_g[1])
    for ks in (0.05, 0.1, 0.15, 0.2, 0.3):
        e, r = fit_eff(rows, kg=kg, ks=ks)
        show(f"  공시^{kg:.1f} 역^-{ks:.2f}", r, base)
        if r and r["MdAPE"] < best_s[1]:
            best_s = (ks, r["MdAPE"])
    ks = best_s[0]
    print(f"  → 최적 역^-{ks:.2f}  MdAPE {best_s[1]:.1f}%\n")

    print("[3] 주야비 — 위 둘 위에")
    best_p = (0.0, best_s[1])
    for kp in (0.05, 0.1, 0.2, 0.3):
        e, r = fit_eff(rows, kg=kg, ks=ks, kp=kp)
        show(f"  +주야^{kp:.2f}", r, base)
        if r and r["MdAPE"] < best_p[1]:
            best_p = (kp, r["MdAPE"])
    kp = best_p[0]
    print(f"  → 최적 주야^{kp:.2f}  MdAPE {best_p[1]:.1f}%\n")

    print("[4] 연식")
    best_a = (0.0, best_p[1])
    for ka in (0.02, 0.04, 0.06, 0.08):
        e, r = fit_eff(rows, kg=kg, ks=ks, kp=kp, ka=ka)
        show(f"  +연식 10년 -{ka*100:.0f}%", r, base)
        if r and r["MdAPE"] < best_a[1]:
            best_a = (ka, r["MdAPE"])
    ka = best_a[0]
    print()

    e, fin = fit_eff(rows, kg=kg, ks=ks, kp=kp, ka=ka)
    print("[최종]")
    show(f"V0 현행", b0)
    show(f"V2 공시^{kg:.1f} 역^-{ks:.2f} 주야^{kp:.2f} 연식{ka:.2f}", fin, base)
    print(f"\n  eff(면적비) = {e:.3f}  ← 눈금을 맞추는 값")

    if fin:
        print("\n[층별] V2")
        by = defaultdict(list)
        for s in rows:
            p = predict2(s, eff=e, kg=kg, ks=ks, kp=kp, ka=ka)
            if p:
                by[_b(s["n"])].append(p / s["crawl_unit"])
        for k in ("지하", "1", "2", "3", "4-5", "6-10", "11+"):
            v = by.get(k)
            if v:
                print(f"  {k:5s} n={len(v):6d} 비율 {st.median(v):5.2f}"
                      f" MdAPE {st.median([abs(x-1)*100 for x in v]):5.1f}%")


def _b(n):
    if n < 0:
        return "지하"
    if n <= 3:
        return str(n)
    if n <= 5:
        return "4-5"
    if n <= 10:
        return "6-10"
    return "11+"


if __name__ == "__main__":
    main()
