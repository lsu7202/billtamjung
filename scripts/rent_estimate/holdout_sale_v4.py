"""적정가 v4 검증 — 튜닝에 안 쓴 구에서도 통하나(2026-08-29).

grid_sale_v4.py 가 튜닝셋(강남·서초·마포·용산·성북 901건)에서 찾은 값:

    age_cfg=(0.02,0.005,0) · recency_scale=12 · sim_weight · alpha_floor=0.2
    18.15% → 14.65% (-3.50p) · ±15% 적중 41.5% → 50.4%

901건에서 60여 개 변형을 훑어 고른 값이라 **그 표본에만 맞는 값일 수 있다.**
튜닝에 한 번도 안 쓴 구에 그대로 걸어 본다. 여기서도 줄면 진짜다.

검증셋: 송파·광진·영등포·강서·강동·동작·서대문·중구

    backend/.venv/bin/python scripts/rent_estimate/holdout_sale_v4.py
"""
import argparse
import asyncio

import backtest_sale_est as B

TUNE = {"11680": "강남", "11650": "서초", "11440": "마포", "11170": "용산", "11290": "성북"}
HOLD = {"11710": "송파", "11215": "광진", "11560": "영등포", "11500": "강서",
        "11740": "강동", "11590": "동작", "11410": "서대문", "11140": "중구"}

V4 = dict(age_cfg=(0.02, 0.005, 0.0), recency_scale=12, sim_weight=True, alpha_floor=0.2)


def one(gu, since):
    sales, targets, tj = asyncio.run(B.load(gu, since))
    sales = [s for s in sales if s.get("lat") is not None and s.get("lng") is not None]
    targets = [s for s in targets if s.get("lat") is not None and s.get("lng") is not None]
    if not targets:
        return None
    v0 = B.run_variant("V0", sales, targets, tj)
    v4 = B.run_variant("V4", sales, targets, tj, **V4)
    return v0, v4


def block(name, gus, since):
    print(f"\n===== {name} =====")
    print(f"{'구':8s} {'n':>5s} {'현행':>8s} {'v4':>8s} {'차이':>8s}  {'±15% 현행→v4':>14s}")
    tn = t0 = t4 = h0 = h4 = 0
    for gu, ko in gus.items():
        r = one(gu, since)
        if not r or not r[0] or not r[1]:
            print(f"{ko:8s}     — 표본 부족")
            continue
        v0, v4 = r
        n = v0["n"]
        print(f"{ko:8s} {n:5d} {v0['MdAPE']:7.2f}% {v4['MdAPE']:7.2f}% "
              f"{v4['MdAPE']-v0['MdAPE']:+7.2f}p  {v0['hit15']:5.1f}% → {v4['hit15']:5.1f}%")
        tn += n; t0 += v0["MdAPE"] * n; t4 += v4["MdAPE"] * n
        h0 += v0["hit15"] * n; h4 += v4["hit15"] * n
    if tn:
        print(f"{'가중합':8s} {tn:5d} {t0/tn:7.2f}% {t4/tn:7.2f}% {(t4-t0)/tn:+7.2f}p"
              f"  {h0/tn:5.1f}% → {h4/tn:5.1f}%")
    return tn, (t0 / tn if tn else 0), (t4 / tn if tn else 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="202501")
    a = ap.parse_args()
    print(f"타깃 시점 {a.since}~ (실전 조건: 최근 거래를 맞히기)")
    print(f"v4 = {V4}")
    block("튜닝셋(값을 여기서 골랐다)", TUNE, a.since)
    n, b0, b4 = block("검증셋(한 번도 안 쓴 구)", HOLD, a.since)
    print()
    if n:
        if b4 < b0 - 0.5:
            print(f"→ 검증셋에서도 {b0-b4:.2f}p 줄었다. 과적합이 아니다.")
        elif b4 < b0:
            print(f"→ 검증셋 개선폭 {b0-b4:.2f}p 로 작다. 일부는 튜닝셋에만 맞는 값이다.")
        else:
            print(f"→ 검증셋에서 {b4-b0:.2f}p 늘었다. 과적합이다 — 적용하면 안 된다.")


if __name__ == "__main__":
    main()
