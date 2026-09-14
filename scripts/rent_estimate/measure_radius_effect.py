#!/usr/bin/env python3
"""반경을 바꾸면 적정가가 얼마나 흔들리나 — 실측(2026-09-02 신설).

## 왜 재나

지금은 같은 건물의 적정가가 두 곳에서 계산된다.

    배치    scripts/rent_estimate/build_sale_est.py  → master.building_sale_est
    라이브  리포트가 열릴 때 그 자리에서 다시 계산

둘이 어긋나 화면마다 값이 달라진다(2026-08-28 삼성동 78, 2026-09-02 재발).
라이브를 없애고 **배치 하나만** 두려는데, 그 전제가 「반경·오버레이를 바꿔도
값이 크게 안 흔들린다」이다. 전제가 맞는지 숫자로 확인한다.

크게 흔들리면 반경은 사용자가 정해야 할 값이고, 하나로 못 줄인다.
안 흔들리면 반경은 **주변 시세 비교용**으로만 두고 적정가는 하나로 둘 수 있다.

## 어떻게 재나

표본 건물마다 반경 300·500·1000m 로 같은 산식을 돌려 값을 비교한다.
기준은 500m(지금 배치·라이브 기본값)이고, 나머지를 그에 대한 비율로 본다.

    data/.venv/bin/python scripts/rent_estimate/measure_radius_effect.py [표본수]
"""
import asyncio
import os
import statistics
import sys

import asyncpg

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "..", "..", "backend", "app", "jobs"))
import report_calc  # noqa: E402

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")
RADII = [300, 500, 1000]
N = int(sys.argv[1]) if len(sys.argv) > 1 else 300


async def main():
    c = await asyncpg.connect(DSN, command_timeout=1800)
    # 배치(build_sale_est.py)와 **똑같이** 읽는다 — 활성 세트만, 시점 보정은 두 곳을 합침
    prm = await c.fetch(
        """SELECT p.param_key, p.value_num, p.value_json FROM ref.formula_params p
           JOIN ref.formula_sets s ON s.set_version=p.set_version AND s.active""")
    params = {r["param_key"]: float(r["value_num"]) for r in prm if r["value_num"] is not None}
    import json as _json
    tj = next((r["value_json"] for r in prm if r["param_key"] == "time_adjust"), None)
    time_adjust = _json.loads(tj) if isinstance(tj, str) else (tj or {})
    qrows = await c.fetch("SELECT quarter, ratio FROM master.sale_price_index")
    time_adjust = {**time_adjust, **{r["quarter"]: float(r["ratio"]) for r in qrows}}

    # 표본: 적정가가 이미 있는 건물 중 무작위. 있는 것 = comp 가 3건 이상 모인 건물이다.
    subs = await c.fetch(f"""
        SELECT b.building_pk pk, ST_X(b.geom) lng, ST_Y(b.geom) lat,
               b.total_area::float ta, b.land_area::float la, b.gongsi_latest::float g,
               b.approval_ymd ay, b.remodel_ymd ry, b.road_frontage rf,
               b.land_use lu, substr(b.main_use,1,2) mu,
               p.day_avg::float dp, p.night_avg::float np
          FROM master.buildings b
          JOIN master.building_sale_est se USING (building_pk)
          LEFT JOIN master.building_pop p USING (building_pk)
         WHERE b.geom IS NOT NULL
         ORDER BY random() LIMIT {N}""")
    print(f"표본 {len(subs):,}동\n")

    out = {r: [] for r in RADII}
    n_ok = 0
    for s in subs:
        vals = {}
        for rad in RADII:
            # 라이브와 같은 규칙: 5년 · 반경 · 성격 필터 · 본매물 제외
            allowed_lu, allowed_mu, _ = report_calc.comp_type_filter(s["lu"], s["mu"])
            rows = await c.fetch("""
                SELECT DISTINCT ON (sh.building_pk)
                       sh.price::float price, sh.total_area::float total_area,
                       sh.land_area::float land_area,
                       CASE WHEN b.gongsi_latest>0 AND sh.land_area>0
                            THEN b.gongsi_latest::float*sh.land_area END gongsi_total,
                       sh.contract_ym, b.approval_ymd, b.remodel_ymd,
                       b.road_frontage, p.day_avg::float day_pop, p.night_avg::float night_pop,
                       round(ST_Distance(b.geom::geography,
                             ST_SetSRID(ST_MakePoint($1,$2),4326)::geography)) dist_m
                  FROM master.sales_history sh
                  JOIN master.buildings b USING (building_pk)
                  LEFT JOIN master.building_pop p USING (building_pk)
                 WHERE sh.contract_ym >= to_char(now()-interval '5 years','YYYYMM')
                   AND sh.price>0 AND sh.total_area>0 AND sh.building_pk <> $4
                   AND ($5::text[] IS NULL OR b.land_use = ANY($5)
                        OR substr(b.main_use,1,2) = ANY($6))
                   AND ST_DWithin(b.geom::geography,
                        ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, $3)
                 ORDER BY sh.building_pk, sh.contract_ym DESC""",
                float(s["lng"]), float(s["lat"]), rad, s["pk"],
                list(allowed_lu) if allowed_lu else None,
                list(allowed_mu) if allowed_mu else None)
            comps = [dict(r) for r in rows]
            if len(comps) < 3:
                continue
            subj = {"total_area": s["ta"], "land_area": s["la"], "gongsi_latest": s["g"],
                    "approval_ymd": s["ay"], "remodel_ymd": s["ry"],
                    "road_frontage": s["rf"], "day_pop": s["dp"], "night_pop": s["np"]}
            ap = report_calc.appraise(subj, comps, params, time_adjust)
            if ap.get("fair_price"):
                vals[rad] = float(ap["fair_price"])
        if 500 not in vals or len(vals) < 2:
            continue
        n_ok += 1
        base = vals[500]
        for rad, v in vals.items():
            out[rad].append(abs(v / base - 1) * 100)

    print(f"셋 다 값이 나온 건물 {n_ok:,}동\n")
    print(f"{'반경':>8}{'표본':>8}{'중앙':>10}{'평균':>10}{'상위10%':>10}{'최대':>10}")
    print("─" * 56)
    for rad in RADII:
        d = out[rad]
        if not d:
            continue
        d_sorted = sorted(d)
        p90 = d_sorted[int(len(d_sorted) * 0.9)] if len(d_sorted) > 9 else d_sorted[-1]
        print(f"{rad:>6}m{len(d):>8}{statistics.median(d):>9.1f}%"
              f"{statistics.mean(d):>9.1f}%{p90:>9.1f}%{max(d):>9.1f}%")
    print("\n※ 500m 기준 대비 차이의 절대값. 500m 행이 0%인 것은 자기 자신이라 정상.")
    await c.close()


if __name__ == "__main__":
    asyncio.run(main())
