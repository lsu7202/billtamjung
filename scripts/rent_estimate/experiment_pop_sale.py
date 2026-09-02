"""유동인구가 **적정가(F-17)** 오차를 줄이는지 재는 실험(2026-08-28).

임대 쪽에서는 기각됐다(rent_common.pop_adj 주석). 그때 남긴 말이 「매매가 쪽에서 재볼 값」이다.
주야비(낮÷밤)는 「이 자리가 얼마나 상업지인가」를 재고, 그건 임대료보다 **매매가**에 실린다.

세 갈래를 각각 재고 조합한다.
  ① pop_pct      주야비 대칭 보정 — comp 가격을 타깃 자리 기준으로 환산(연식 보정과 같은 어법)
  ② pop_dens_pct 낮 생활인구 자체(사람 수)로 같은 보정
  ③ pop_scale    주야비가 비슷한 comp 에 가중(유사성 가중 — 연식·규모와 같은 어법)

기준선 = **프로덕션 현행 파라미터**(report_calc.appraise 기본값). 그래야 「지금보다 나은가」를 잰다.
튜닝 = 강남(11680)·마포(11440), 검증 = 송파(11710, 봉인 — 마지막에 한 번만).
잣대 = MdAPE(실거래 대비 오차 중앙값). 순위상관은 눈금 깨짐을 못 잡아 안 쓴다.

    backend/.venv/bin/python scripts/rent_estimate/experiment_pop_sale.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from backtest_sale_est import load, run_variant  # noqa: E402

# 프로덕션 현행(report_calc.appraise 기본값)
PROD = dict(age_cfg=(0.035, 0.0, 0.0), remodel_offset=5.0,
            sim_weight=True, sim_age_scale=25.0, sim_size_scale=0.5,
            recency_scale=12.0, wg=0.6, alpha_floor=0.1, alpha_max=0.8,
            cost_c=3.0e6, cost_lambda=0.15)

TUNE = ("11680", "11440")
HOLD = "11710"


def score(data, **extra):
    """튜닝 구들 MdAPE 평균 + 구별 결과."""
    rs = []
    for gu, (sales, targets, tj) in data.items():
        r = run_variant("x", sales, targets, tj, **{**PROD, **extra})
        rs.append((gu, r))
    return sum(r["MdAPE"] for _, r in rs) / len(rs), rs


def line(label, avg, rs, base=None):
    d = f"{avg - base:+5.2f}" if base is not None else "  기준"
    per = "  ".join(f"{gu} {r['MdAPE']:5.2f}%/n{r['n']}" for gu, r in rs)
    print(f"{label:34s} {avg:6.2f}% {d:>7s}   {per}")


async def main():
    data = {gu: await load(gu, "202301") for gu in TUNE}
    for gu, (sales, targets, _) in data.items():
        with_pop = sum(1 for t in targets if t.get("day_pop") and t.get("night_pop"))
        print(f"{gu}: 타깃 {len(targets)}건 · 풀 {len(sales)}건 · 유동인구 있는 타깃 {with_pop}건")
    print()

    b_avg, b_rs = score(data)
    print(f"{'변형':34s} {'평균':>6s} {'차이':>7s}   구별")
    line("V현행(프로덕션 파라미터)", b_avg, b_rs)

    best = (b_avg, {}, "현행")
    print("\n① 주야비 대칭 보정")
    for k in (0.1, 0.2, 0.3, 0.5, 0.8, 1.0):
        a, rs = score(data, pop_pct=k)
        line(f"  pop_pct={k}", a, rs, b_avg)
        if a < best[0]:
            best = (a, {"pop_pct": k}, f"pop_pct={k}")

    print("\n② 낮 생활인구 보정")
    for k in (0.05, 0.1, 0.2, 0.3, 0.5):
        a, rs = score(data, pop_dens_pct=k)
        line(f"  pop_dens_pct={k}", a, rs, b_avg)
        if a < best[0]:
            best = (a, {"pop_dens_pct": k}, f"pop_dens_pct={k}")

    print("\n③ 주야비 유사성 가중")
    for k in (2.0, 1.0, 0.5, 0.25):
        a, rs = score(data, pop_scale=k)
        line(f"  pop_scale={k}", a, rs, b_avg)
        if a < best[0]:
            best = (a, {"pop_scale": k}, f"pop_scale={k}")

    print(f"\n최적 단축: {best[2]}  ({best[0]:.2f}%, 현행 대비 {best[0]-b_avg:+.2f})")

    if best[1]:
        print("\n④ 최적 축 + 나머지 축 조합")
        for k2 in (0.1, 0.2):
            for kk, vv in (("pop_pct", k2), ("pop_dens_pct", k2), ("pop_scale", 1.0)):
                if kk in best[1]:
                    continue
                cfg = {**best[1], kk: vv}
                a, rs = score(data, **cfg)
                line("  " + " ".join(f"{x}={y}" for x, y in cfg.items()), a, rs, b_avg)
                if a < best[0]:
                    best = (a, cfg, " ".join(f"{x}={y}" for x, y in cfg.items()))

    print(f"\n=== 튜닝 최적: {best[2]} · {best[0]:.2f}% (현행 {b_avg:.2f}%, {best[0]-b_avg:+.2f}) ===")

    if best[1] and best[0] < b_avg - 0.2:
        print(f"\n검증셋 {HOLD}(봉인 해제)")
        hs, ht, htj = await load(HOLD, "202301")
        r0 = run_variant("현행", hs, ht, htj, **PROD)
        r1 = run_variant("적용", hs, ht, htj, **{**PROD, **best[1]})
        print(f"  현행 {r0['MdAPE']:.2f}% · 적용 {r1['MdAPE']:.2f}% "
              f"({r1['MdAPE']-r0['MdAPE']:+.2f}) · n={r0['n']} · ±15%적중 {r0['hit15']}→{r1['hit15']}")
    else:
        print("\n검증셋은 열지 않는다 — 튜닝에서 의미 있는 개선이 없다.")


if __name__ == "__main__":
    asyncio.run(main())
