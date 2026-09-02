"""F-17 적정가 백테스트 — 연식보정(B)·유사성가중(C)·α하한(D) 변형 비교. MdAPE 기준.

방법: 타깃=강남구(기본) 2023~ 상업성격 실거래(leave-one-out). comp=반경 500m·타깃 시점 이전 5년
(자기 건물 제외 — 미래정보 누출 방지). comp 가격을 타깃 연도로 시점보정 후 appraise 변형 적용.
오차 = |예측−실거래|/실거래. 보고 = MdAPE(중앙값)·MAPE(평균)·적중률(±15%)·표본수.

사용: python backtest_sale_est.py [--gu 11680] [--since 202301]
"""
import argparse
import asyncio
import json
import math
import os
import statistics
import sys

import asyncpg

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend", "app", "jobs"))
import report_calc  # noqa: E402

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")
SECT = ('상업용', '업무용', '상업기타', '주상용', '주상기타')
COMM_MU = ('03', '04', '05', '07', '09', '13', '14', '15', '16')
_MU_IN = ",".join(f"'{c}'" for c in COMM_MU)
RADIUS = 500.0
_R = 6371008.8


def dist_m(lat1, lng1, lat2, lng2):
    x = math.radians(lng2 - lng1) * math.cos(math.radians((lat1 + lat2) * 0.5))
    y = math.radians(lat2 - lat1)
    return _R * math.hypot(x, y)


def age_of(approval_ymd, at_year: int) -> float | None:
    if not approval_ymd:
        return None
    try:
        return max(0.0, at_year - int(str(approval_ymd)[:4]))
    except (TypeError, ValueError):
        return None


def eff_age_of(approval_ymd, remodel_ymd, at_year: int, remodel_offset: float | None) -> float | None:
    """유효연식 — 리모델링 시 연식을 '리모델 경과+offset'으로 단축(offset=None이면 미적용)."""
    a = age_of(approval_ymd, at_year)
    if a is None or remodel_offset is None or not remodel_ymd:
        return a
    r = age_of(remodel_ymd, at_year)
    return min(a, (r if r is not None else a) + remodel_offset)


LEGAL_FAR = {"제1종전용주거지역":100,"제2종전용주거지역":120,"제1종일반주거지역":150,"제2종일반주거지역":200,
             "제3종일반주거지역":250,"준주거지역":400,"중심상업지역":1000,"일반상업지역":800,"근린상업지역":600,
             "유통상업지역":600,"전용공업지역":200,"일반공업지역":200,"준공업지역":400}


def far_slack(use_zone, ta, la):
    """잔여 용적률(%) = 법정 − 현재. 미상이면 None."""
    lf = LEGAL_FAR.get(use_zone)
    if not lf or not ta or not la:
        return None
    return max(0.0, lf - ta / la * 100)


def road_grade(rf):
    """도로접면 등급(감정평가 개별요인 사다리): 광대6·중로5·소로4·세로가3·세로불2·맹지1, 각지 +0.5"""
    if not rf:
        return None
    g = None
    for pre, v in (("광대", 6), ("중로", 5), ("소로", 4), ("맹지", 1)):
        if rf.startswith(pre):
            g = v
            break
    if g is None and rf.startswith("세로"):
        g = 2 if "불" in rf else 3
    if g is None:
        return None
    return g + (0.5 if "각" in rf else 0.0)


STRUCT_GRADE = {"철골철근콘크리트구조": 1.05, "철근콘크리트구조": 1.0, "철골콘크리트구조": 1.0,
                "일반철골구조": 0.95, "경량철골구조": 0.85, "벽돌구조": 0.8, "블록구조": 0.7,
                "일반목구조": 0.7, "통나무구조": 0.7}


def value_factor(age: float | None, d1: float, d2: float, d3: float) -> float:
    """연령 구간형 가치계수(전체가치 기준) — 문헌(초기 가속·중년 정체) 반영.
    f = 1 − d1·min(age,10) − d2·(10~30 구간) − d3·(30+ 구간), 하한 0.55."""
    if age is None:
        return 1.0
    f = 1.0 - d1 * min(age, 10) - d2 * max(0.0, min(age, 30) - 10) - d3 * max(0.0, age - 30)
    return max(0.55, f)


def _dn(d):
    """주야비(낮÷밤 생활인구). 한쪽이라도 없으면 None — 없는 값을 1.0 으로 지어내지 않는다."""
    dv, nv = d.get("day_pop"), d.get("night_pop")
    return (dv / nv) if (dv and nv and nv > 0) else None


def _q_of(ym):
    ym=str(ym); m=ym[4:6]
    return ym[:4]+("Q1" if m<="03" else "Q2" if m<="06" else "Q3" if m<="09" else "Q4")


def smooth_index(idx):
    """3분기 롤링 중앙값 스무딩."""
    import statistics as _st
    ks=sorted(idx)
    return {k:_st.median([idx[ks[max(0,i-1)]],idx[k],idx[ks[min(len(ks)-1,i+1)]]]) for i,k in enumerate(ks)}


def appraise_variant(subject, comps, time_adjust, target_year,
                     age_cfg=None, sim_weight=False, alpha_floor=0.0,
                     wg=0.6, recency_scale=None, sim_age_scale=10.0, sim_size_scale=1.0,
                     cost_c=None, cost_lambda=0.0, alpha_max=0.6, qidx=None, target_ym=None, trim_lo=None, trim_hi=None, option_k=0.0,
                     road_pct=0.0, struct_w=0.0, mu_pen=1.0, sta_scale=None,
                     pop_pct=0.0, pop_dens_pct=0.0, pop_scale=None, pop_lo=0.5, pop_hi=2.5):
    """report_calc.appraise 변형 — comp 가격을 타깃 연도 기준으로 정규화 + B/C/D 옵션.
    (원본은 '현재' 기준이라 백테스트용으로 시점 재기준화가 필요해 별도 구현. 산식 골격 동일)"""
    subj_ta, subj_la = subject.get("total_area"), subject.get("land_area")
    subj_g = subject.get("gongsi_latest")
    subj_gt = subj_g * subj_la if (subj_g and subj_la) else None
    subj_age = subject.get("_age")

    adj_t = float(time_adjust.get(str(target_year), 0.0))
    if trim_lo or trim_hi:                                 # 저가/고가 꼬리 트림(특수관계·급매 방어 실험)
        import statistics as _st
        pas = [c["price"]/c["total_area"] for c in comps if c.get("price") and c.get("total_area")]
        if len(pas) >= 5:
            med = _st.median(pas)
            comps = [c for c in comps if not (c.get("price") and c.get("total_area")) or
                     ((not trim_lo or c["price"]/c["total_area"] >= trim_lo*med) and
                      (not trim_hi or c["price"]/c["total_area"] <= trim_hi*med))]
    R, P, T = [], [], []
    for c in comps:
        price = c.get("price")
        if not price:
            continue
        ta, la, gt = c.get("total_area"), c.get("land_area"), c.get("gongsi_total")
        if qidx and target_ym:
            qt, qc = _q_of(target_ym), _q_of(c.get("contract_ym"))
            it, ic = qidx.get(qt), qidx.get(qc)
            padj = price * (it / ic) if (it and ic) else price
        else:
            adj_c = float(time_adjust.get(str(c.get("_year")), 0.0))
            padj = price * (1 + adj_c) / (1 + adj_t)      # comp 시점 → 타깃 시점
        if age_cfg and subj_age is not None and c.get("_age") is not None:   # 양측 연식 있을 때만(편측 왜곡 방지)
            padj *= value_factor(subj_age, *age_cfg) / value_factor(c["_age"], *age_cfg)
        if option_k and subj_age is not None and c.get("_age") is not None:  # 재건축 옵션: 노후×잔여용적 프리미엄
            def _opt(age, fs):
                if age is None or fs is None or age < 20:
                    return 1.0
                return 1.0 + option_k * min(fs, 400) / 400 * min(1.0, (age - 20) / 15)
            padj *= _opt(subj_age, subject.get("_fs")) / _opt(c["_age"], c.get("_fs"))
        if road_pct:                                       # 도로접면 등급 보정(대칭)
            gs, gc = road_grade(subject.get("road_frontage")), road_grade(c.get("road_frontage"))
            if gs is not None and gc is not None:
                padj *= (1.0 + road_pct) ** (gs - gc)
        if pop_pct:                                        # 주야비 보정(대칭) — 낮÷밤이 큰 자리가 비싸다
            rs, rc = _dn(subject), _dn(c)
            if rs and rc:
                padj *= max(pop_lo, min(pop_hi, rs / rc)) ** pop_pct
        if pop_dens_pct:                                   # 낮 인구 밀도 자체(자리의 사람 수)
            ds, dc = subject.get("day_pop"), c.get("day_pop")
            if ds and dc and dc > 0:
                padj *= max(pop_lo, min(pop_hi, ds / dc)) ** pop_dens_pct
        if struct_w:                                       # 구조 등급 보정(대칭, 건물분 비중만큼)
            ss, sc = STRUCT_GRADE.get(subject.get("structure") or ""), STRUCT_GRADE.get(c.get("structure") or "")
            if ss and sc:
                padj *= (ss / sc) ** struct_w
        w = 1.0 / ((c.get("dist_m") or 0) + 50)
        if recency_scale:                                  # 최신성 가중(개월 차)
            mdiff = abs((target_year - c["_year"]) * 12)
            w *= 1.0 / (1.0 + mdiff / recency_scale)
        if sim_weight:                                     # C: 경제적 거리(연식·규모 유사성) — IAAO
            if c.get("_age") is not None and subj_age is not None:
                w *= 1.0 / (1.0 + abs(c["_age"] - subj_age) / sim_age_scale)
            if ta and subj_ta:
                w *= 1.0 / (1.0 + abs(math.log(ta / subj_ta)) / sim_size_scale)
        if mu_pen != 1.0 and subject.get("main_use") and c.get("main_use"):
            if str(subject["main_use"])[:2] != str(c["main_use"])[:2]:
                w *= mu_pen                                # 용도 불일치 감점
        if sta_scale and subject.get("station_dist") is not None and c.get("station_dist") is not None:
            w *= 1.0 / (1.0 + abs(c["station_dist"] - subject["station_dist"]) / sta_scale)
        if pop_scale:                                      # 주야비가 비슷한 comp 를 더 본다(가중형)
            rs, rc = _dn(subject), _dn(c)
            if rs and rc:
                w *= 1.0 / (1.0 + abs(math.log(rs / rc)) / pop_scale)
        if gt:
            R.append((padj / gt, w))
        if la:
            P.append((padj / la, w))
        if ta:
            T.append((padj / ta, w))

    gr, gp, gta = report_calc._geomean_iqr(R), report_calc._geomean_iqr(P), report_calc._geomean_iqr(T)
    m_gong = gr * subj_gt if (gr and subj_gt) else None
    m_land = gp * subj_la if (gp and subj_la) else None
    ta_val = gta * subj_ta if (gta and subj_ta) else None
    if m_gong and m_land:
        base = wg * m_gong + (1 - wg) * m_land
    else:
        base = m_gong or m_land or ta_val
    if not base:
        return None
    eff_far = (subj_ta / subj_la * 100) if (subj_ta and subj_la) else 0
    alpha = min(alpha_max, max(alpha_floor, (eff_far - 400) / 600)) if (eff_far and ta_val) else (alpha_floor if ta_val else 0.0)
    fair = (1 - alpha) * base + alpha * (ta_val if ta_val else base)
    cost_gate = max(0.0, min(1.0, (400.0 - eff_far) / 200.0)) if eff_far else 1.0   # 대형 게이트(프로덕션 미러)
    if cost_c and cost_lambda and subj_ta and m_land and subj_age is not None:
        struct = cost_c * subj_ta * value_factor(subj_age, *(age_cfg or (0.02, 0.005, 0.0)))
        fair = (1 - cost_lambda * cost_gate) * fair + cost_lambda * cost_gate * (m_land + struct)
    return fair


async def load(gu: str, since: str):
    conn = await asyncpg.connect(DSN)
    tj_row = await conn.fetchval(
        "SELECT value_json FROM ref.formula_params WHERE param_key='time_adjust' LIMIT 1")
    time_adjust = json.loads(tj_row) if isinstance(tj_row, str) else (tj_row or {})
    # 대상 구의 모든 상업성격 매각(타깃+comp 풀 겸용) — 컬럼 float 캐스팅
    rows = await conn.fetch(f"""
        SELECT sh.building_pk, sh.contract_ym, sh.price::float AS price,
               sh.total_area::float AS total_area, sh.land_area::float AS land_area,
               b.gongsi_latest::float AS gongsi_latest, b.approval_ymd, b.remodel_ymd, b.use_zone,
               b.structure, b.road_frontage, b.main_use, b.station_dist::float AS station_dist,
               pp.day_avg::float AS day_pop, pp.night_avg::float AS night_pop,
               ST_X(b.geom) AS lng, ST_Y(b.geom) AS lat
        FROM master.sales_history sh
        JOIN master.buildings b USING (building_pk)
        LEFT JOIN master.building_pop pp ON pp.building_pk = b.building_pk
        WHERE b.bjd_code LIKE $1 || '%' AND sh.price > 0 AND sh.total_area > 0
          AND (b.land_use = ANY($2) OR substr(b.main_use,1,2) IN ({_MU_IN}))
        ORDER BY sh.contract_ym""", gu, list(SECT))
    await conn.close()
    sales = [dict(r) for r in rows]
    for s in sales:
        s["_year"] = int(str(s["contract_ym"])[:4])
    targets = [s for s in sales if s["contract_ym"] >= since and s["land_area"] and s["gongsi_latest"]]
    return sales, targets, time_adjust


def run_variant(name, sales, targets, time_adjust, remodel_offset=None, radius=None, **opt):
    R = radius or RADIUS
    errs = []
    for t in targets:
        ty = t["_year"]
        subj = {"total_area": t["total_area"], "land_area": t["land_area"],
                "gongsi_latest": t["gongsi_latest"],
                "_age": eff_age_of(t["approval_ymd"], t.get("remodel_ymd"), ty, remodel_offset),
                "_fs": far_slack(t.get("use_zone"), t["total_area"], t["land_area"]),
                "road_frontage": t.get("road_frontage"), "structure": t.get("structure"),
                "main_use": t.get("main_use"), "station_dist": t.get("station_dist"),
                "day_pop": t.get("day_pop"), "night_pop": t.get("night_pop")}
        comps = []
        for c in sales:
            if c["building_pk"] == t["building_pk"]:
                continue
            if not (ty - 5 <= c["_year"] <= ty):           # 타깃 시점 이전 5년(누출 방지: 미래 제외)
                continue
            if c["contract_ym"] > t["contract_ym"]:
                continue
            d = dist_m(t["lat"], t["lng"], c["lat"], c["lng"])
            if d > R:
                continue
            comps.append({**c, "dist_m": d,
                          "gongsi_total": (c["gongsi_latest"] * c["land_area"]) if (c["gongsi_latest"] and c["land_area"]) else None,
                          "_age": eff_age_of(c["approval_ymd"], c.get("remodel_ymd"), ty, remodel_offset),
                          "_fs": far_slack(c.get("use_zone"), c["total_area"], c["land_area"]),
                          "road_frontage": c.get("road_frontage"), "structure": c.get("structure"),
                          "main_use": c.get("main_use"), "station_dist": c.get("station_dist"),
                          "day_pop": c.get("day_pop"), "night_pop": c.get("night_pop")})
        if len(comps) < 3:
            continue
        pred = appraise_variant(subj, comps, time_adjust, ty, target_ym=t["contract_ym"], **opt)
        if not pred:
            continue
        errs.append(abs(pred - t["price"]) / t["price"])
    if not errs:
        return None
    ape = [e * 100 for e in errs]
    return {"name": name, "n": len(ape), "MdAPE": round(statistics.median(ape), 2),
            "MAPE": round(statistics.mean(ape), 2),
            "hit15": round(sum(1 for e in ape if e <= 15) / len(ape) * 100, 1)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gu", default="11680")
    ap.add_argument("--since", default="202301")
    a = ap.parse_args()
    sales, targets, tj = asyncio.run(load(a.gu, a.since))
    print(f"타깃 {len(targets)}건 · 풀 {len(sales)}건 · 구 {a.gu} · since {a.since}\n")

    results = []
    results.append(run_variant("V0 현행(comp만·수익환원 제외)", sales, targets, tj))
    # B: 연식 구간계수 그리드서치(소그리드 — 초기/중기/후기 연 감가율)
    best_b = None
    for d1 in (0.0, 0.01, 0.015, 0.02, 0.025, 0.03):
        for d2 in (0.0, 0.003, 0.006, 0.01):
            for d3 in (0.0, 0.002):
                r = run_variant(f"B d=({d1},{d2},{d3})", sales, targets, tj, age_cfg=(d1, d2, d3))
                if r and (best_b is None or r["MdAPE"] < best_b["MdAPE"]):
                    best_b = r
    results.append(best_b)
    results.append(run_variant("C 유사성 가중(연식·규모)", sales, targets, tj, sim_weight=True))
    results.append(run_variant("D α하한 0.15", sales, targets, tj, alpha_floor=0.15))
    if best_b:
        import re
        m = re.findall(r"[\d.]+", best_b["name"])
        cfg = tuple(float(x) for x in m[:3])
        results.append(run_variant(f"B+C (B={cfg})", sales, targets, tj, age_cfg=cfg, sim_weight=True))
        results.append(run_variant(f"B+C+D", sales, targets, tj, age_cfg=cfg, sim_weight=True, alpha_floor=0.15))

    print(f"{'변형':38s} {'n':>5s} {'MdAPE':>7s} {'MAPE':>7s} {'±15%적중':>8s}")
    for r in results:
        if r:
            print(f"{r['name']:38s} {r['n']:5d} {r['MdAPE']:6.2f}% {r['MAPE']:6.2f}% {r['hit15']:7.1f}%")


if __name__ == "__main__":
    main()
