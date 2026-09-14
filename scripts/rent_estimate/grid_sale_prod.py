"""적정가 — 프로덕션 골격 위에서 남은 축을 턴다(2026-08-29).

holdout_sale_prod.py 로 기준선을 바로잡은 뒤의 자리:
    프로덕션 현행  튜닝 15.77% · 검증 18.11%
    grid_sale_v4 가 고른 값들은 검증셋에서 **전부 개선 없음**(+0.00 ~ +1.21p).
    → F-17 은 이미 잘 튜닝돼 있다. 남은 건 지금 골격이 못 보는 것이다.

프로덕션 기준 잔차(5구 1,848건 · MdAPE 18.1% · 로그SD 0.281 · 배율 중앙 1.10):
    실거래 평단가 ρ=+0.359  0.95 → 1.30 (오차 16% → 33%)  ← 비싼 건물을 못 따라간다
    거래시점    ρ=-0.316  1.26 → 0.96
    공시지가    ρ=+0.245  0.98 → 1.20
    주야비     ρ=+0.147 · 용적률 ρ=+0.151

「비싼 건물 과소평가」는 comp 평균으로 끌어내리는 평균회귀다. 그 건물이 비싸다는 걸
말해 주는 값은 **공시지가**뿐이니, 공시축 비중(wg)과 공시 직접보정을 턴다.

    backend/.venv/bin/python scripts/rent_estimate/grid_sale_prod.py
"""
import argparse
import asyncio

import backtest_sale_est as B
from holdout_sale_prod import HOLD, PROD, TUNE, load_set, run


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="202501")
    a = ap.parse_args()
    tune, hold = load_set(TUNE, a.since), load_set(HOLD, a.since)
    bt = run(tune, **PROD)["MdAPE"]
    bh = run(hold, **PROD)["MdAPE"]
    print(f"기준선(프로덕션) 튜닝 {bt:.2f}% · 검증 {bh:.2f}%\n")
    print(f"{'변형':30s} {'튜닝':>9s} {'검증':>9s}  {'튜닝Δ':>7s} {'검증Δ':>7s}")

    def t(name, **opt):
        o = {**PROD, **opt}
        rt, rh = run(tune, **o), run(hold, **o)
        if not rt or not rh:
            return
        print(f"{name:30s} {rt['MdAPE']:8.2f}% {rh['MdAPE']:8.2f}%"
              f"  {rt['MdAPE']-bt:+6.2f}p {rh['MdAPE']-bh:+6.2f}p")

    print("[공시축 비중 wg — 비싼 건물의 「비쌈」은 공시지가만 안다]")
    for wg in (0.5, 0.6, 0.7, 0.8, 0.9, 1.0):
        t(f"  wg={wg}", wg=wg)

    print("\n[연면적축 상한·하한]")
    for af in (0.0, 0.05, 0.15, 0.2):
        t(f"  alpha_floor={af}", alpha_floor=af)
    for am in (0.5, 0.6, 0.7, 0.9):
        t(f"  alpha_max={am}", alpha_max=am)

    print("\n[원가법 혼합 λ]")
    for cl in (0.0, 0.05, 0.10, 0.20, 0.25):
        t(f"  cost_lambda={cl}", cost_lambda=cl)
    for cc in (2.0e6, 2.5e6, 3.5e6, 4.0e6):
        t(f"  cost_c={cc:.1e}", cost_c=cc)

    print("\n[유사성 가중 세기]")
    for sa in (10.0, 15.0, 25.0, 40.0):
        t(f"  sim_age_scale={sa}", sim_age_scale=sa)
    for sz in (0.3, 0.5, 0.8, 1.2):
        t(f"  sim_size_scale={sz}", sim_size_scale=sz)

    print("\n[최신성]")
    for rs in (6.0, 12.0, 18.0, 30.0):
        t(f"  recency={rs}", recency_scale=rs)

    print("\n[연식 감가]")
    for d1 in (0.025, 0.035, 0.05):
        for d2 in (0.0, 0.005):
            t(f"  age=({d1},{d2})", age_cfg=(d1, d2, 0.0))

    print("\n[반경 · 트림]")
    for R in (300.0, 400.0, 600.0):
        t(f"  radius={R:.0f}m", radius=R)
    for lo, hi in ((0.6, 1.8), (0.7, 1.6)):
        t(f"  trim {lo}~{hi}", trim_lo=lo, trim_hi=hi)

    print("\n[주야비 · 도로접면 — 잔차에 남아 있던 축]")
    for pp in (0.05, 0.1, 0.2):
        t(f"  pop_pct={pp}", pop_pct=pp)
    for rp in (0.03, 0.06):
        t(f"  road_pct={rp}", road_pct=rp)


if __name__ == "__main__":
    main()
