"""적정가 수익환원 재료 (나)안 — 주변 임대 호가로 섞으면 오차가 줄어드는가(2026-10-08 · 스펙 12 §2-1).

기준 = 지번 단위 프로덕션(holdout_parcel S3: 연면적 = 지번 동 합 · 대지 = 딸린 필지 합) · 검증 8구 · 타깃 2025~.
재료 = 반경 500m 네이버 임대 호가(master.market_rent, 월세 > 0)의 ㎡당 월세 중앙값(5건 미만이면 없음).
    연 임대료 = ㎡당 월세 × 연면적 × 12
    환원율   = 구별 median(연 임대료 ÷ 실거래가) — 같은 구의 다른 거래로(본매물 제외). 분자 · 분모가 같은 재료라
               호가가 실계약보다 높은 치우침이 지워진다
    추정가   = (1−β) · 비교사례 추정 + β · 연 임대료 ÷ 환원율

호가는 2026-10-03 하루치다. 타깃(2025~)보다 늦지만 환원율도 같은 호가로 내므로 수준 차이는 지워진다.

    backend/.venv/bin/python scripts/rent_estimate/backtest_income.py
"""
import asyncio
import math
import statistics

import asyncpg

import backtest_sale_est as B
import holdout_sale_prod as H

CELL = 0.005   # 격자(도) — 후보 수집용


async def fetch():
    c = await asyncpg.connect(B.DSN)
    rent = await c.fetch("""
        SELECT ST_X(b.geom) lng, ST_Y(b.geom) lat, (r.rent / r.contract_area)::float ppm, r.use_type
          FROM master.market_rent r JOIN master.buildings b ON b.building_pk = r.building_pk
         WHERE r.rent > 0 AND r.contract_area > 0 AND b.geom IS NOT NULL""")
    await c.close()
    return rent


async def s3(pks):
    c = await asyncpg.connect(B.DSN)
    rows = await c.fetch("""
        SELECT pr.rep_pk, pr.total_area::float ta, lnd.la, lnd.gt
          FROM master.parcel_rep pr
          JOIN LATERAL (SELECT sum(p.area)::float la,
                               sum(p.area * p.gongsi_latest) FILTER (WHERE p.gongsi_latest > 0)::float gt
                          FROM master.parcels p
                         WHERE p.pnu IN (SELECT bp.pnu FROM master.building_parcels bp WHERE bp.building_pk = pr.rep_pk
                                         UNION SELECT pr.pnu)) lnd ON true
         WHERE pr.rep_pk = ANY($1::text[])""", pks)
    await c.close()
    return {r["rep_pk"]: r for r in rows}


def main():
    hold = H.load_set(H.HOLD, "202501")
    rent = asyncio.run(fetch())
    grid = {}
    for r in rent:
        grid.setdefault((int(r["lng"] / CELL), int(r["lat"] / CELL)), []).append(r)
    ex = asyncio.run(s3(sorted({s["building_pk"] for _, sales, _, _ in hold for s in sales})))

    def ask(lat, lng, use=None):
        cx, cy = int(lng / CELL), int(lat / CELL)
        v = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for r in grid.get((cx + dx, cy + dy), []):
                    if use and r["use_type"] != use:
                        continue
                    if B.dist_m(lat, lng, r["lat"], r["lng"]) <= 500:
                        v.append(r["ppm"])
        return statistics.median(v) if len(v) >= 5 else None

    def use_of(s):
        return "사무실" if str(s.get("main_use") or "")[:2] == "14" else "상가"

    for use_mode in ("전부", "같은 용도"):
        # 거래마다: 지번 면적으로 고친 본매물, 재료(연 임대료), 비교사례 추정
        rows = []   # (gu, price, fair, annual, annual/price for cap)
        for gu, sales, targets, tj in hold:
            for t in targets:
                e = ex.get(t["building_pk"])
                if not e or not (e["ta"] and e["la"] and e["gt"]):
                    continue
                subj_t = {**t, "total_area": e["ta"], "land_area": e["la"], "gongsi_latest": e["gt"] / e["la"]}
                fair = predict(subj_t, sales, tj)
                if not fair:
                    continue
                a = ask(t["lat"], t["lng"], use_of(t) if use_mode == "같은 용도" else None)
                annual = a * e["ta"] * 12 if a else None
                rows.append((gu, t["price"], fair, annual))
        # 환원율 — 같은 구 다른 거래의 연 임대료 ÷ 실거래가 중앙값(본매물 제외)
        by_gu = {}
        for i, (gu, pr, _, an) in enumerate(rows):
            if an:
                by_gu.setdefault(gu, []).append((i, an / pr))
        def cap_of(gu, i):
            v = [x for j, x in by_gu.get(gu, []) if j != i]
            return statistics.median(v) if len(v) >= 5 else None
        n_mat = sum(1 for r in rows if r[3])
        print(f"\n[{use_mode}] 거래 {len(rows)} · 재료 있음 {n_mat} · 구별 환원율 "
              + " ".join(f"{H.HOLD[g]}{statistics.median([x for _, x in v])*100:.2f}%" for g, v in by_gu.items()))
        print(f"{'β':>5s} {'MdAPE':>7s} {'±15%':>6s}   재료 있는 거래만 MdAPE")
        for beta in (0.0, 0.1, 0.2, 0.3):
            ape, ape_m = [], []
            for i, (gu, pr, fair, an) in enumerate(rows):
                cap = cap_of(gu, i) if an else None
                est = (1 - beta) * fair + beta * an / cap if (an and cap and beta) else fair
                e = abs(est - pr) / pr * 100
                ape.append(e)
                if an and cap:
                    ape_m.append(e)
            print(f"{beta:5.1f} {statistics.median(ape):6.2f}% {sum(1 for x in ape if x <= 15)/len(ape)*100:5.1f}%"
                  f"   {statistics.median(ape_m):6.2f}% ({len(ape_m)}건)")


def predict(subj_t, sales, tj):
    """holdout_sale_prod PROD 그대로 한 건 — run_variant 의 안쪽을 한 건만 돈다"""
    ty = subj_t["_year"]
    subj = {"total_area": subj_t["total_area"], "land_area": subj_t["land_area"],
            "gongsi_latest": subj_t["gongsi_latest"],
            "_age": B.eff_age_of(subj_t["approval_ymd"], subj_t.get("remodel_ymd"), ty, None),
            "road_frontage": subj_t.get("road_frontage"), "structure": subj_t.get("structure"),
            "main_use": subj_t.get("main_use"), "station_dist": subj_t.get("station_dist"),
            "day_pop": subj_t.get("day_pop"), "night_pop": subj_t.get("night_pop")}
    comps = []
    for c in sales:
        if c["building_pk"] == subj_t["building_pk"] or not (ty - 5 <= c["_year"] <= ty) \
                or c["contract_ym"] > subj_t["contract_ym"]:
            continue
        d = B.dist_m(subj_t["lat"], subj_t["lng"], c["lat"], c["lng"])
        if d > B.RADIUS:
            continue
        comps.append({**c, "dist_m": d,
                      "gongsi_total": (c["gongsi_latest"] * c["land_area"]) if (c["gongsi_latest"] and c["land_area"]) else None,
                      "_age": B.eff_age_of(c["approval_ymd"], c.get("remodel_ymd"), ty, None)})
    if len(comps) < 3:
        return None
    return B.appraise_variant(subj, comps, tj, ty, target_ym=subj_t["contract_ym"], **H.PROD)


if __name__ == "__main__":
    main()
