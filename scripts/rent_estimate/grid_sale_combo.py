"""적정가 — 검증셋에서 함께 줄어든 세 축을 조합한다(2026-08-29).

grid_sale_prod.py 에서 **튜닝·검증 양쪽 모두** 준 것만 골랐다(한쪽만 주는 건 과적합이다):

    wg=0.8        튜닝 -0.51p  검증 -0.63p     공시축 비중 ↑
    wg=1.0        튜닝 -1.12p  검증 -0.67p
    road_pct=0.06 튜닝 -0.20p  검증 -0.79p     도로접면 등급 보정
    pop_pct=0.2   튜닝 -0.13p  검증 -0.47p     주야비 보정

셋 다 「자리의 질」을 말하는 값이고, 잔차 분해가 가리킨 것과 맞는다
(공시지가 ρ=+0.245 · 주야비 ρ=+0.147). 비싼 건물을 comp 평균이 끌어내리는 걸
막아 주는 항들이다.

    backend/.venv/bin/python scripts/rent_estimate/grid_sale_combo.py
"""
import argparse
import asyncio

from holdout_sale_prod import HOLD, PROD, TUNE, load_set, run


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="202501")
    a = ap.parse_args()
    tune, hold = load_set(TUNE, a.since), load_set(HOLD, a.since)
    bt = run(tune, **PROD)["MdAPE"]
    bh0 = run(hold, **PROD)
    bh = bh0["MdAPE"]
    print(f"기준선(프로덕션) 튜닝 {bt:.2f}% · 검증 {bh:.2f}% · 검증 ±15% {bh0['hit15']:.1f}%\n")
    print(f"{'변형':34s} {'튜닝':>9s} {'검증':>9s}  {'튜닝Δ':>7s} {'검증Δ':>7s} {'±15%':>7s}")

    best = None
    def t(name, **opt):
        nonlocal best
        o = {**PROD, **opt}
        rt, rh = run(tune, **o), run(hold, **o)
        if not rt or not rh:
            return
        print(f"{name:34s} {rt['MdAPE']:8.2f}% {rh['MdAPE']:8.2f}%"
              f"  {rt['MdAPE']-bt:+6.2f}p {rh['MdAPE']-bh:+6.2f}p {rh['hit15']:6.1f}%")
        # 양쪽 다 줄어든 것만 후보로 — 한쪽만 주는 건 표본에 맞춘 값이다
        if rt["MdAPE"] < bt and rh["MdAPE"] < bh:
            if best is None or rh["MdAPE"] < best[1]:
                best = (name, rh["MdAPE"], rt["MdAPE"], opt, rh["by"])

    print("[단독 재확인]")
    t("  wg=0.8", wg=0.8)
    t("  wg=1.0", wg=1.0)
    t("  road=0.06", road_pct=0.06)
    t("  pop=0.2", pop_pct=0.2)

    print("\n[둘씩]")
    t("  wg=0.8 road=0.06", wg=0.8, road_pct=0.06)
    t("  wg=0.8 pop=0.2", wg=0.8, pop_pct=0.2)
    t("  wg=1.0 road=0.06", wg=1.0, road_pct=0.06)
    t("  road=0.06 pop=0.2", road_pct=0.06, pop_pct=0.2)

    print("\n[셋]")
    t("  wg=0.8 road=0.06 pop=0.2", wg=0.8, road_pct=0.06, pop_pct=0.2)
    t("  wg=1.0 road=0.06 pop=0.2", wg=1.0, road_pct=0.06, pop_pct=0.2)

    print("\n[최적 근처 미세]")
    for wg in (0.75, 0.85, 0.9):
        t(f"  wg={wg} road=0.06 pop=0.2", wg=wg, road_pct=0.06, pop_pct=0.2)
    for rp in (0.04, 0.08, 0.10):
        t(f"  wg=0.8 road={rp} pop=0.2", wg=0.8, road_pct=rp, pop_pct=0.2)
    for pp in (0.15, 0.25, 0.3):
        t(f"  wg=0.8 road=0.06 pop={pp}", wg=0.8, road_pct=0.06, pop_pct=pp)

    if best:
        print(f"\n[채택 후보] {best[0].strip()}")
        print(f"  튜닝 {best[2]:.2f}% ({best[2]-bt:+.2f}p) · 검증 {best[1]:.2f}% ({best[1]-bh:+.2f}p)")
        print(f"  검증 구별: " + "  ".join(f"{HOLD[g]}{v:.1f}" for g, v in best[4].items()))
        print(f"  파라미터: {best[3]}")
    else:
        print("\n[채택 후보 없음] 양쪽 다 줄어든 조합이 없다")


if __name__ == "__main__":
    main()
