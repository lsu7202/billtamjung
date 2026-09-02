"""적정가(F-17) 잔차 분해 — 26.7% 오차가 어디서 오나(2026-08-29).

임대 쪽에서 통했던 방법을 그대로 쓴다: 예측하고, 잔차를 각 변수로 갈라 본다.
갈리는 축이 곧 산식에 빠진 항이다.

잣대 = 실거래(master.sales_history). leave-one-out — 자기 거래는 comp 에서 뺀다.
잔차 r = log(실거래 ÷ 예측). r 이 어떤 변수와 단조로 움직이면 그 변수가 빠진 것이다.

현행(2026-08-29 실측 MdAPE): 강남 26.7 · 서초 19.8 · 마포 19.1 · 용산 24.1

    backend/.venv/bin/python scripts/rent_estimate/residual_sale.py --gu 11680
    backend/.venv/bin/python scripts/rent_estimate/residual_sale.py --all
"""
import argparse
import asyncio
import math
import statistics as st
from collections import defaultdict

import backtest_sale_est as B
from residual_rent import spearman

# report_calc.appraise 의 기본값 = 지금 화면에 뜨는 값. 잔차는 **이것**을 기준으로 봐야 한다
# (민짜 기준으로 보면 이미 프로덕션이 잡고 있는 축까지 「빠진 항」으로 잡힌다).
PROD = dict(age_cfg=(0.035, 0.0, 0.0), sim_weight=True, sim_age_scale=25.0,
            sim_size_scale=0.5, recency_scale=12.0, alpha_floor=0.1, alpha_max=0.8,
            cost_c=3.0e6, cost_lambda=0.15, wg=0.6)

GU = {"11680": "강남", "11650": "서초", "11440": "마포", "11170": "용산", "11290": "성북",
      "11710": "송파", "11215": "광진", "11560": "영등포", "11500": "강서", "11740": "강동"}


def far_of(s):
    return (s["total_area"] / s["land_area"] * 100) if (s.get("total_area") and s.get("land_area")) else None


def age_of(s):
    y = str(s.get("approval_ymd") or "")[:4]
    return (s["_year"] - int(y)) if y.isdigit() else None


def collect(gu, since):
    sales, targets, tj = asyncio.run(B.load(gu, since))
    # 좌표 없는 거래는 뺀다 — 거리를 못 재면 comp 도 못 고른다(용산에 26건 있었다)
    sales = [s for s in sales if s.get("lat") is not None and s.get("lng") is not None]
    targets = [s for s in targets if s.get("lat") is not None and s.get("lng") is not None]
    out = []
    for t in targets:
        ty = t["_year"]
        subj = {"total_area": t["total_area"], "land_area": t["land_area"],
                "gongsi_latest": t["gongsi_latest"],
                "_age": B.eff_age_of(t["approval_ymd"], t.get("remodel_ymd"), ty, None),
                "_fs": B.far_slack(t.get("use_zone"), t["total_area"], t["land_area"]),
                "road_frontage": t.get("road_frontage"), "structure": t.get("structure"),
                "main_use": t.get("main_use"), "station_dist": t.get("station_dist"),
                "day_pop": t.get("day_pop"), "night_pop": t.get("night_pop")}
        comps = []
        for c in sales:
            if c["building_pk"] == t["building_pk"]:
                continue
            if not (ty - 5 <= c["_year"] <= ty) or c["contract_ym"] > t["contract_ym"]:
                continue
            d = B.dist_m(t["lat"], t["lng"], c["lat"], c["lng"])
            if d > B.RADIUS:
                continue
            comps.append({**c, "dist_m": d,
                          "gongsi_total": (c["gongsi_latest"] * c["land_area"])
                          if (c["gongsi_latest"] and c["land_area"]) else None,
                          "_age": B.eff_age_of(c["approval_ymd"], c.get("remodel_ymd"), ty, None),
                          "_fs": B.far_slack(c.get("use_zone"), c["total_area"], c["land_area"])})
        if len(comps) < 3:
            continue
        pred = B.appraise_variant(subj, comps, tj, ty, target_ym=t["contract_ym"], **PROD)
        if not pred or pred <= 0:
            continue
        out.append({**t, "_pred": pred, "_r": math.log(t["price"] / pred),
                    "_ncomp": len(comps),
                    "_dmed": st.median([c["dist_m"] for c in comps]),
                    "_far": far_of(t), "_age": age_of(t),
                    "_pa": t["price"] / t["total_area"],
                    "_dn": (t["day_pop"] / t["night_pop"])
                    if (t.get("day_pop") and t.get("night_pop")) else None})
    return out


def buckets(rows, label, fn, n=6):
    v = [(fn(s), s["_r"]) for s in rows]
    v = [(x, r) for x, r in v if x is not None]
    if len(v) < 60:
        print(f"  {label:16s} 표본 부족({len(v)})")
        return
    v.sort(key=lambda t: t[0])
    sp = spearman([x for x, _ in v], [r for _, r in v])
    step = max(1, len(v) // n)
    seg_out, mape_out = [], []
    for i in range(n):
        seg = v[i * step:(i + 1) * step] if i < n - 1 else v[i * step:]
        if not seg:
            continue
        rs = [r for _, r in seg]
        seg_out.append(f"{math.exp(st.median(rs)):.2f}")
        mape_out.append(f"{st.median([abs(math.exp(r)-1)*100 for r in rs]):.0f}")
    print(f"  {label:16s} ρ={sp:+.3f}  배율 {' '.join(seg_out)}   오차% {' '.join(mape_out)}")


def cats(rows, key, label, top=7):
    g = defaultdict(list)
    for s in rows:
        k = s.get(key)
        if k:
            g[str(k)].append(s["_r"])
    g = {k: v for k, v in g.items() if len(v) >= 25}
    if not g:
        return
    print(f"  {label}")
    for k, v in sorted(g.items(), key=lambda t: -st.median(t[1]))[:top]:
        print(f"    {k[:20]:22s} n={len(v):5d}  배율 {math.exp(st.median(v)):5.2f}"
              f"  오차 {st.median([abs(math.exp(r)-1)*100 for r in v]):4.0f}%")


def report(rows, name):
    r = [s["_r"] for s in rows]
    ape = [abs(math.exp(x) - 1) * 100 for x in r]
    print(f"\n===== {name} · 타깃 {len(rows)}건 · MdAPE {st.median(ape):.1f}%"
          f" · 잔차배율 중앙 {math.exp(st.median(r)):.2f} · 로그SD {st.pstdev(r):.3f} =====")
    print("[연속]")
    buckets(rows, "comp 수", lambda s: s["_ncomp"])
    buckets(rows, "comp 중앙거리", lambda s: s["_dmed"])
    buckets(rows, "연면적", lambda s: s["total_area"])
    buckets(rows, "대지면적", lambda s: s["land_area"])
    buckets(rows, "용적률", lambda s: s["_far"])
    buckets(rows, "연식", lambda s: s["_age"])
    buckets(rows, "공시지가", lambda s: s["gongsi_latest"])
    buckets(rows, "역거리", lambda s: s["station_dist"])
    buckets(rows, "주야비", lambda s: s["_dn"])
    buckets(rows, "실거래 평단가", lambda s: s["_pa"])
    buckets(rows, "거래시점", lambda s: int(s["contract_ym"]))
    print("[범주]")
    cats(rows, "use_zone", "용도지역")
    cats(rows, "road_frontage", "도로접면")
    cats(rows, "main_use", "주용도")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gu", default="11680")
    ap.add_argument("--since", default="202301")
    ap.add_argument("--all", action="store_true", help="주요 5구 합쳐서")
    a = ap.parse_args()
    if a.all:
        allrows = []
        for g in ("11680", "11650", "11440", "11170", "11290"):
            rows = collect(g, a.since)
            print(f"  {GU.get(g,g)} {len(rows)}건")
            allrows += rows
        report(allrows, "5구 합계")
    else:
        report(collect(a.gu, a.since), GU.get(a.gu, a.gu))


if __name__ == "__main__":
    main()
