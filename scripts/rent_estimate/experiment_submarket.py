"""F-17 comp 수집 범위 실험 — 「500m 원」을 무엇으로 대체하면 오차가 주는가.

지금은 반경 500m 원 안의 상업성격 실거래를 전부 comp 로 쓴다. 원은 대로 건너편·다른
용도지역·다른 지가대를 그냥 끌어온다. 상권(가격권)을 고정으로 그리려면 **무엇으로 자르는 것이
실제로 오차를 줄이는지**부터 알아야 한다. 이 스크립트는 자르는 방식만 갈아 끼우며 MdAPE 를 잰다.

방법은 backtest_sale_est 와 같다(leave-one-out · 미래정보 차단 · 시점보정). 산식은 손대지 않는다 —
바뀌는 것은 comp 집합뿐이라, 차이가 곧 「자르는 방식」의 값이다.

    python scripts/rent_estimate/experiment_submarket.py --gu 11680 --since 202301
"""
import argparse
import asyncio
import json
import os
import sys

import asyncpg

_HERE = os.path.dirname(__file__)
sys.path.insert(0, _HERE)
sys.path.insert(0, os.path.join(_HERE, "..", "..", "backend", "app", "jobs"))
import backtest_sale_est as BT  # noqa: E402  (dist_m·appraise_variant·eff_age_of 재사용)

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")
_MU_IN = BT._MU_IN


async def load(gu: str, since: str):
    """backtest 의 load 에 **상권 id·용도지역 대분류**를 더 얹는다."""
    conn = await asyncpg.connect(DSN)
    tj_row = await conn.fetchval(
        "SELECT value_json FROM ref.formula_params WHERE param_key='time_adjust' LIMIT 1")
    time_adjust = json.loads(tj_row) if isinstance(tj_row, str) else (tj_row or {})
    rows = await conn.fetch(f"""
        SELECT sh.building_pk, sh.contract_ym, sh.price::float AS price,
               sh.total_area::float AS total_area, sh.land_area::float AS land_area,
               b.gongsi_latest::float AS gongsi_latest, b.approval_ymd, b.remodel_ymd, b.use_zone,
               b.structure, b.road_frontage, b.main_use, b.station_dist::float AS station_dist,
               b.bjd_code,
               ST_X(b.geom) AS lng, ST_Y(b.geom) AS lat,
               (SELECT sg.id FROM master.sanggwon sg
                 WHERE ST_Contains(sg.geom, b.geom) LIMIT 1) AS sg_id
        FROM master.sales_history sh
        JOIN master.buildings b USING (building_pk)
        WHERE b.bjd_code LIKE $1 || '%' AND sh.price > 0 AND sh.total_area > 0
          AND (b.land_use = ANY($2) OR substr(b.main_use,1,2) IN ({_MU_IN}))
        ORDER BY sh.contract_ym""", gu, list(BT.SECT))
    await conn.close()
    sales = [dict(r) for r in rows]
    for s in sales:
        s["_year"] = int(str(s["contract_ym"])[:4])
        s["_zone"] = zone_head(s.get("use_zone"))
    targets = [s for s in sales if s["contract_ym"] >= since and s["land_area"] and s["gongsi_latest"]]
    return sales, targets, time_adjust


def zone_head(v: str | None) -> str | None:
    """걸침(「A 60% + B 40%」)은 앞 지역명으로. value_score.use_zone_score 와 같은 어법."""
    if not v:
        return None
    return v.split("%")[0].strip().rstrip("0123456789 ").strip() or None


def zone_class(v: str | None) -> str | None:
    """대분류 — 상업 / 준주거 / 주거 / 공업. 「일반상업」과 「중심상업」을 가르면 표본이 말라 죽는다."""
    z = zone_head(v)
    if not z:
        return None
    if "상업" in z:
        return "상업"
    if "준주거" in z:
        return "준주거"
    if "주거" in z:
        return "주거"
    if "공업" in z:
        return "공업"
    return "기타"


def keep(t, c, mode: str, band: float) -> bool:
    """자르는 규칙 — 이 함수 하나만 갈아 끼운다."""
    if mode == "none":
        return True
    if mode == "zone":                      # 같은 용도지역 대분류만
        return zone_class(t.get("use_zone")) == zone_class(c.get("use_zone"))
    if mode == "gongsi":                    # 공시지가(원/㎡)가 ±band 이내
        a, b = t.get("gongsi_latest"), c.get("gongsi_latest")
        if not (a and b):
            return True                     # 값이 없으면 안 자른다(조용한 실패)
        return abs(b - a) / a <= band
    if mode == "sanggwon":                  # 타깃이 상권 안이면 comp 도 같은 상권
        if t.get("sg_id") is None:
            return True                     # 상권 밖이면 이 규칙이 할 말이 없다
        return c.get("sg_id") == t["sg_id"]
    if mode == "bjd":                       # 같은 법정동
        return (t.get("bjd_code") or "")[:10] == (c.get("bjd_code") or "")[:10]
    if mode == "zone+gongsi":
        return keep(t, c, "zone", band) and keep(t, c, "gongsi", band)
    raise SystemExit(f"모르는 mode: {mode}")


def run(name, sales, targets, tj, *, mode="none", band=0.5, radius=None, min_comps=3, **opt):
    R = radius or BT.RADIUS
    errs, used, dropped = [], [], 0
    for t in targets:
        ty = t["_year"]
        subj = {"total_area": t["total_area"], "land_area": t["land_area"],
                "gongsi_latest": t["gongsi_latest"],
                "_age": BT.eff_age_of(t["approval_ymd"], t.get("remodel_ymd"), ty, None),
                "_fs": BT.far_slack(t.get("use_zone"), t["total_area"], t["land_area"]),
                "road_frontage": t.get("road_frontage"), "structure": t.get("structure"),
                "main_use": t.get("main_use"), "station_dist": t.get("station_dist")}
        comps = []
        for c in sales:
            if c["building_pk"] == t["building_pk"]:
                continue
            if not (ty - 5 <= c["_year"] <= ty):
                continue
            if c["contract_ym"] > t["contract_ym"]:
                continue
            d = BT.dist_m(t["lat"], t["lng"], c["lat"], c["lng"])
            if d > R:
                continue
            if not keep(t, c, mode, band):
                continue
            comps.append({**c, "dist_m": d,
                          "gongsi_total": (c["gongsi_latest"] * c["land_area"]) if (c["gongsi_latest"] and c["land_area"]) else None,
                          "_age": BT.eff_age_of(c["approval_ymd"], c.get("remodel_ymd"), ty, None),
                          "_fs": BT.far_slack(c.get("use_zone"), c["total_area"], c["land_area"]),
                          "road_frontage": c.get("road_frontage"), "structure": c.get("structure"),
                          "main_use": c.get("main_use"), "station_dist": c.get("station_dist")})
        if len(comps) < min_comps:
            dropped += 1                    # 잘라내다 표본이 마른 건 — 이 수가 곧 대가다
            continue
        pred = BT.appraise_variant(subj, comps, tj, ty, target_ym=t["contract_ym"], **opt)
        if not pred:
            continue
        errs.append(abs(pred - t["price"]) / t["price"])
        used.append(len(comps))
    if not errs:
        return None
    import statistics
    return {"name": name, "n": len(errs), "dropped": dropped,
            "comps": statistics.median(used),
            "MdAPE": statistics.median(errs) * 100,
            "MAPE": statistics.fmean(errs) * 100,
            "hit15": sum(1 for e in errs if e <= 0.15) / len(errs) * 100}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gu", default="11680")
    ap.add_argument("--since", default="202301")
    a = ap.parse_args()
    sales, targets, tj = asyncio.run(load(a.gu, a.since))
    ins = sum(1 for t in targets if t.get("sg_id") is not None)
    print(f"타깃 {len(targets)}건 · 풀 {len(sales)}건 · 구 {a.gu} · since {a.since}"
          f" · 상권 안 타깃 {ins}건({ins / max(1, len(targets)) * 100:.0f}%)\n")

    rs = [
        run("V0 현행 — 500m 원", sales, targets, tj),
        run("R300 — 반경만 좁힘", sales, targets, tj, radius=300),
        run("Z 같은 용도지역(대분류)", sales, targets, tj, mode="zone"),
        run("G 공시지가 ±30%", sales, targets, tj, mode="gongsi", band=0.30),
        run("G 공시지가 ±50%", sales, targets, tj, mode="gongsi", band=0.50),
        run("G 공시지가 ±80%", sales, targets, tj, mode="gongsi", band=0.80),
        run("S 같은 상권(부동산원 72)", sales, targets, tj, mode="sanggwon"),
        run("B 같은 법정동", sales, targets, tj, mode="bjd"),
        run("Z+G 용도지역 + 공시 ±50%", sales, targets, tj, mode="zone+gongsi", band=0.50),
    ]
    print(f"{'자르는 방식':30s} {'n':>4s} {'버림':>4s} {'comp':>5s} {'MdAPE':>7s} {'MAPE':>7s} {'±15%':>6s}")
    for r in rs:
        if r:
            print(f"{r['name']:30s} {r['n']:4d} {r['dropped']:4d} {r['comps']:5.0f} "
                  f"{r['MdAPE']:6.2f}% {r['MAPE']:6.2f}% {r['hit15']:5.1f}%")


if __name__ == "__main__":
    main()
