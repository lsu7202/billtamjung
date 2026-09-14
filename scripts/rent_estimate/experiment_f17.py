"""F-17 개선축 전수 탐색 — 튜닝셋=강남(11680)+마포(11440), 검증셋=송파(11710, 봉인).
좌표하강 2패스: 각 축을 순서대로 최적화(목적함수 = 두 구 MdAPE 평균). 결과는 stdout 표.
사용: python experiment_f17.py
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
from backtest_sale_est import load, run_variant  # noqa: E402


def score(cfg, data):
    """두 튜닝 구 MdAPE 평균(낮을수록 좋음). cfg 그대로 run_variant kwargs."""
    vals = []
    out = []
    for gu, (sales, targets, tj) in data.items():
        r = run_variant("x", sales, targets, tj, **cfg)
        vals.append(r["MdAPE"])
        out.append((gu, r))
    return sum(vals) / len(vals), out


def fmt(cfg):
    keys = ["age_cfg", "remodel_offset", "sim_weight", "sim_age_scale", "sim_size_scale",
            "alpha_floor", "wg", "radius", "recency_scale", "cost_c", "cost_lambda"]
    return " ".join(f"{k}={cfg[k]}" for k in keys if cfg.get(k) not in (None, False, 0.0) and not (k=="wg" and cfg[k]==0.6) and not (k=="sim_age_scale" and cfg[k]==10.0) and not (k=="sim_size_scale" and cfg[k]==1.0))


async def main():
    data = {}
    for gu in ("11680", "11440"):
        data[gu] = await load(gu, "202301")
    base = {"age_cfg": None, "remodel_offset": None, "sim_weight": False,
            "sim_age_scale": 10.0, "sim_size_scale": 1.0, "alpha_floor": 0.0,
            "wg": 0.6, "radius": None, "recency_scale": None, "cost_c": None, "cost_lambda": 0.0}
    cur = dict(base)
    s0, _ = score(cur, data)
    print(f"V0 기준: {s0:.2f}%  (강남/마포 평균 MdAPE)\n")

    axes = [
        ("age_cfg", [None] + [(d1, d2, 0.0) for d1 in (0.015, 0.02, 0.025, 0.03, 0.035) for d2 in (0.0, 0.003, 0.006, 0.01)]),
        ("remodel_offset", [None, 3, 5, 8, 12]),
        ("sim_weight", [False, True]),
        ("sim_age_scale", [5.0, 10.0, 15.0, 25.0]),
        ("sim_size_scale", [0.5, 1.0, 2.0]),
        ("alpha_floor", [0.0, 0.1, 0.15, 0.2, 0.25]),
        ("wg", [0.4, 0.5, 0.6, 0.7, 0.8]),
        ("radius", [None, 700.0, 1000.0]),
        ("recency_scale", [None, 12.0, 24.0, 48.0]),
        ("cost_c", [None, 1.5e6, 2.0e6, 2.5e6, 3.0e6]),
        ("cost_lambda", [0.0, 0.1, 0.2, 0.3]),
    ]

    best = s0
    for pass_no in (1, 2):
        print(f"── 좌표하강 pass {pass_no} ──")
        for key, values in axes:
            if key in ("sim_age_scale", "sim_size_scale") and not cur["sim_weight"]:
                continue
            if key == "cost_lambda" and not cur["cost_c"]:
                # cost_c와 cost_lambda는 짝 — cost_c 탐색 때 lambda 0.15 임시 부여
                pass
            picked = cur[key]
            for v in values:
                trial = {**cur, key: v}
                if key == "cost_c" and v and not trial["cost_lambda"]:
                    trial["cost_lambda"] = 0.15
                s, _ = score(trial, data)
                if s < best - 1e-9:
                    best, picked = s, v
                    if key == "cost_c" and v:
                        cur["cost_lambda"] = 0.15
            cur[key] = picked
            print(f"  {key:16s} → {picked}   (best {best:.2f}%)")
    print(f"\n최종 조합: {fmt(cur)}")
    s, per = score(cur, data)
    for gu, r in per:
        print(f"  {gu}: MdAPE {r['MdAPE']:.2f}% · ±15% {r['hit15']:.1f}% · n={r['n']}")
    print(f"  평균 {s:.2f}%  (V0 {s0:.2f}% → 개선 {s0 - s:.2f}pt)")
    print("\nCONFIG=", {k: v for k, v in cur.items()})


if __name__ == "__main__":
    asyncio.run(main())
