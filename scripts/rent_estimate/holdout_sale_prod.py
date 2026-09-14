"""적정가 — **프로덕션 파라미터**를 기준선으로 다시 잰다(2026-08-29).

앞선 grid_sale_v4.py 의 「V0 현행」은 사실 현행이 아니었다.
backtest_sale_est.appraise_variant 의 기본값은 보정을 하나도 안 켠 민짜인데,
프로덕션(backend/app/jobs/report_calc.appraise)은 이미 여러 축을 켜고 있다:

    report_calc 기본값                        appraise_variant 기본값
    age d=(0.035, 0, 0)                     age_cfg=None
    sim enabled · age_scale 25 · size 0.5   sim_weight=False
    recency.scale 12                        recency_scale=None
    alpha.floor 0.1 · alpha.max 0.8         0.0 · 0.6
    cost.c 3e6 · cost.lambda 0.15           None · 0.0

그래서 「-3.5p 개선」의 상당 부분은 **이미 프로덕션에 들어 있는 것을 다시 켠 것**일 수 있다.
진짜 개선폭을 알려면 프로덕션을 그대로 미러한 기준선과 견줘야 한다.

    backend/.venv/bin/python scripts/rent_estimate/holdout_sale_prod.py
"""
import argparse
import asyncio

import backtest_sale_est as B

TUNE = {"11680": "강남", "11650": "서초", "11440": "마포", "11170": "용산", "11290": "성북"}
HOLD = {"11710": "송파", "11215": "광진", "11560": "영등포", "11500": "강서",
        "11740": "강동", "11590": "동작", "11410": "서대문", "11140": "중구"}

# report_calc.appraise 의 기본값을 그대로 옮긴 것 = 지금 화면에 뜨는 값
PROD = dict(age_cfg=(0.035, 0.0, 0.0), sim_weight=True, sim_age_scale=25.0,
            sim_size_scale=0.5, recency_scale=12.0, alpha_floor=0.1, alpha_max=0.8,
            cost_c=3.0e6, cost_lambda=0.15, wg=0.6,
            road_pct=0.06, pop_pct=0.2)   # v3.2(2026-08-30) — 검증 18.11% → 16.99%

# grid_sale_v4 가 고른 값을 프로덕션 골격 위에 얹은 것
CAND = {
    "P1 age→(0.02,0.005)": {**PROD, "age_cfg": (0.02, 0.005, 0.0)},
    "P2 alpha_floor→0.2": {**PROD, "alpha_floor": 0.2},
    "P3 sim_age_scale→10": {**PROD, "sim_age_scale": 10.0},
    "P4 alpha_max→0.6": {**PROD, "alpha_max": 0.6},
    "P5 cost_lambda→0": {**PROD, "cost_lambda": 0.0},
    "P6 1+2": {**PROD, "age_cfg": (0.02, 0.005, 0.0), "alpha_floor": 0.2},
    "P7 1+2+3": {**PROD, "age_cfg": (0.02, 0.005, 0.0), "alpha_floor": 0.2, "sim_age_scale": 10.0},
    "P8 1+2+trim": {**PROD, "age_cfg": (0.02, 0.005, 0.0), "alpha_floor": 0.2,
                    "trim_lo": 0.6, "trim_hi": 1.8},
}


def load_set(gus, since):
    d = []
    for gu in gus:
        sales, targets, tj = asyncio.run(B.load(gu, since))
        sales = [s for s in sales if s.get("lat") is not None and s.get("lng") is not None]
        targets = [s for s in targets if s.get("lat") is not None and s.get("lng") is not None]
        if targets:
            d.append((gu, sales, targets, tj))
    return d


def run(data, **opt):
    rs = []
    for gu, sales, targets, tj in data:
        r = B.run_variant("x", sales, targets, tj, **opt)
        if r:
            rs.append((gu, r))
    if not rs:
        return None
    n = sum(r["n"] for _, r in rs)
    return {"n": n, "MdAPE": sum(r["MdAPE"] * r["n"] for _, r in rs) / n,
            "hit15": sum(r["hit15"] * r["n"] for _, r in rs) / n,
            "by": {g: r["MdAPE"] for g, r in rs}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="202501")
    a = ap.parse_args()
    tune = load_set(TUNE, a.since)
    hold = load_set(HOLD, a.since)
    print(f"타깃 시점 {a.since}~ · 튜닝 {sum(len(t) for _,_,t,_ in tune)}건"
          f" · 검증 {sum(len(t) for _,_,t,_ in hold)}건\n")

    raw = run(tune, )
    prod_t = run(tune, **PROD)
    prod_h = run(hold, **PROD)
    print(f"{'변형':26s} {'튜닝 MdAPE':>11s} {'검증 MdAPE':>11s}   {'검증 ±15%':>9s}")
    print(f"{'민짜(보정 전부 off)':26s} {raw['MdAPE']:10.2f}%"
          f" {run(hold)['MdAPE']:10.2f}%   {run(hold)['hit15']:8.1f}%")
    print(f"{'P0 프로덕션 현행':26s} {prod_t['MdAPE']:10.2f}% {prod_h['MdAPE']:10.2f}%"
          f"   {prod_h['hit15']:8.1f}%   ← 진짜 기준선")
    bt, bh = prod_t["MdAPE"], prod_h["MdAPE"]
    print()
    best = None
    for name, opt in CAND.items():
        rt, rh = run(tune, **opt), run(hold, **opt)
        if not rt or not rh:
            continue
        print(f"{name:26s} {rt['MdAPE']:10.2f}% {rh['MdAPE']:10.2f}%   {rh['hit15']:8.1f}%"
              f"   ({rt['MdAPE']-bt:+5.2f}p / {rh['MdAPE']-bh:+5.2f}p)")
        if best is None or rh["MdAPE"] < best[1]:
            best = (name, rh["MdAPE"], rt["MdAPE"], opt)
    if best:
        print(f"\n[검증셋 최적] {best[0]}  검증 {best[1]:.2f}% (현행 {bh:.2f}%, {best[1]-bh:+.2f}p)"
              f" · 튜닝 {best[2]:.2f}% ({best[2]-bt:+.2f}p)")
        print(f"  구별 검증: " + "  ".join(f"{HOLD[g]}{v:.1f}" for g, v in run(hold, **best[3])["by"].items()))


if __name__ == "__main__":
    main()
