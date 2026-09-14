"""적정가 F-17 개선 탐색 — 실전 조건(2026-08-29).

**백테스트 조건을 실전에 맞췄다.** 예전엔 2023~ 전 구간을 타깃으로 재서 23.5% 가 나왔는데,
그 숫자는 실전보다 나쁘게 나온다 — 우리가 실제로 하는 일은 「지금 이 건물이 얼마인가」라
타깃 시점이 늘 **오늘**이고 comp 는 최근 5년이다. 과거를 타깃으로 잡으면 comp 가 타깃보다
더 과거라 시점보정 폭이 커지고, 그 보정의 오차가 그대로 실린다.

    타깃 2023~ : 23.5%   2024~ : 20.9%   2025~ : 18.2%   ← 실전에 가까운 건 이것

residual_sale.py 가 찾은 잔차 축(5구 1,848건):
    거래시점   ρ=-0.384  배율 1.45 → 0.98   ← 위 문제. 최근 타깃일수록 잘 맞는다
    실거래평단가 ρ=+0.283  1.04 → 1.37       비싼 건물을 과소평가
    연식      ρ=-0.262  신축 1.55(오차 55%) 신축을 크게 과소평가
    용적률     ρ=+0.257  1.04 → 1.33        고용적률 과소평가

    backend/.venv/bin/python scripts/rent_estimate/grid_sale_v4.py
"""
import argparse
import asyncio
import statistics as st

import backtest_sale_est as B

GUS = ("11680", "11650", "11440", "11170", "11290")
NAME = {"11680": "강남", "11650": "서초", "11440": "마포", "11170": "용산", "11290": "성북"}


def load_all(since):
    data = []
    for gu in GUS:
        sales, targets, tj = asyncio.run(B.load(gu, since))
        sales = [s for s in sales if s.get("lat") is not None and s.get("lng") is not None]
        targets = [s for s in targets if s.get("lat") is not None and s.get("lng") is not None]
        data.append((gu, sales, targets, tj))
    return data


def run(data, name, **opt):
    rs = []
    for gu, sales, targets, tj in data:
        r = B.run_variant(name, sales, targets, tj, **opt)
        if r:
            rs.append((gu, r))
    if not rs:
        return None
    n = sum(r["n"] for _, r in rs)
    return {"name": name, "n": n,
            "MdAPE": sum(r["MdAPE"] * r["n"] for _, r in rs) / n,
            "hit15": sum(r["hit15"] * r["n"] for _, r in rs) / n,
            "by": {gu: r["MdAPE"] for gu, r in rs}}


def show(r, base=None):
    if not r:
        return
    d = f" ({r['MdAPE']-base:+5.2f}p)" if base is not None else " " * 9
    by = " ".join(f"{NAME[g]}{v:.1f}" for g, v in r["by"].items())
    print(f"{r['name']:40s} n={r['n']:5d} MdAPE {r['MdAPE']:5.2f}%{d} ±15% {r['hit15']:4.1f}%  {by}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="202501")
    a = ap.parse_args()
    data = load_all(a.since)
    print(f"타깃 {sum(len(t) for _,_,t,_ in data)}건 · since {a.since}\n")

    b0 = run(data, "V0 현행")
    show(b0)
    base = b0["MdAPE"]
    best = dict(name="V0", opt={}, md=base)
    print()

    def try_(label, **opt):
        nonlocal best
        r = run(data, label, **opt)
        show(r, base)
        if r and r["MdAPE"] < best["md"]:
            best = dict(name=label, opt=opt, md=r["MdAPE"])
        return r

    print("[A] 최신성 가중 — 시점보정 오차를 comp 선택으로 줄인다")
    for rs in (6, 12, 24, 48):
        try_(f"  recency={rs}개월", recency_scale=rs)

    print("\n[B] 연식 감가 — 신축을 55% 과소평가하고 있다")
    for d1 in (0.02, 0.03, 0.035, 0.045, 0.06, 0.08):
        for d2 in (0.0, 0.005, 0.01):
            try_(f"  age d=({d1},{d2},0)", age_cfg=(d1, d2, 0.0))

    print("\n[C] 유사성 가중")
    try_("  sim(연식·규모)", sim_weight=True)
    for sa in (5.0, 15.0):
        try_(f"  sim age_scale={sa}", sim_weight=True, sim_age_scale=sa)

    print("\n[D] 연면적축 비중(alpha) — 고용적률 과소평가 대응")
    for af in (0.1, 0.2, 0.3):
        try_(f"  alpha_floor={af}", alpha_floor=af)
    for am in (0.7, 0.8):
        try_(f"  alpha_max={am}", alpha_max=am)

    print("\n[E] 공시축 비중(wg)")
    for wg in (0.3, 0.45, 0.6, 0.75, 0.9):
        try_(f"  wg={wg}", wg=wg)

    print("\n[F] 꼬리 트림 — 특수관계·급매 방어")
    for lo, hi in ((0.5, 2.0), (0.6, 1.8), (0.7, 1.5)):
        try_(f"  trim {lo}~{hi}", trim_lo=lo, trim_hi=hi)

    print("\n[G] 반경")
    for R in (300, 400, 600, 800):
        try_(f"  radius={R}m", radius=float(R))

    print("\n[H] 용도 불일치 감점 · 역거리 유사성")
    for mp in (0.5, 0.7):
        try_(f"  mu_pen={mp}", mu_pen=mp)
    for ss in (300.0, 600.0):
        try_(f"  sta_scale={ss}", sta_scale=ss)

    print(f"\n[최적 단축] {best['name']}  {best['md']:.2f}% (현행 {base:.2f}%)")

    if best["opt"]:
        print("\n[조합] 최적 단축 위에 하나씩 더한다")
        cur = dict(best["opt"])
        curmd = best["md"]
        for label, extra in (("recency=12", {"recency_scale": 12}),
                             ("sim", {"sim_weight": True}),
                             ("age(0.06,0.005)", {"age_cfg": (0.06, 0.005, 0.0)}),
                             ("trim .6~1.8", {"trim_lo": 0.6, "trim_hi": 1.8}),
                             ("alpha_floor .2", {"alpha_floor": 0.2})):
            if any(k in cur for k in extra):
                continue
            r = run(data, f"  +{label}", **{**cur, **extra})
            show(r, base)
            if r and r["MdAPE"] < curmd:
                cur.update(extra); curmd = r["MdAPE"]
        print(f"\n[최종] {curmd:.2f}% (현행 {base:.2f}%, -{base-curmd:.2f}p)")
        print(f"  파라미터: {cur}")


if __name__ == "__main__":
    main()
