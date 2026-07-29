"""F-17 적정매매가 v2 · F-18 예상수익률 (R STEP2/4). specs formulas.md.

v2 = 공시배율법·대지평단가법 블렌드 + 대형(고용적) 연면적법 α가중. 거리가중 기하평균·IQR.
  적정가 = (1−α)·[0.5·공시배율×본매물공시총액 + 0.5·대지단가×본매물대지] + α·연면적단가×본매물연면적
  α = min(0.6, max(0,(유효용적률−400)/600)),  유효용적률 = 연면적/대지×100
  comp별 거리가중 w=1/(dist_m+50), 기하평균, 방법별 IQR 이상치 제외, 시점보정.
강남 백테스트 MdAPE ~14%(연면적+F16 구산 22.7% 대비). 규모 미스매치 편향 해소.
입력 comp = {price, total_area(㎡), land_area(㎡), gongsi_total(원), contract_ym, dist_m}.
"""
import math
import statistics

M2_PER_PYEONG = 3.305785


def _year(contract_ym) -> int | None:
    try:
        return int(str(contract_ym)[:4])
    except (TypeError, ValueError):
        return None


def _num(x):
    if x is None or x == "":
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _geomean_iqr(pairs: list[tuple[float, float]]) -> float | None:
    """[(값, 가중치)] → 값 IQR 1.5 제외 후 가중 기하평균. 3건 미만이면 IQR 생략."""
    vals = [v for v, _ in pairs if v and v > 0]
    if len(vals) >= 3:
        q1, q3 = statistics.quantiles(vals, n=4)[0], statistics.quantiles(vals, n=4)[2]
        lo, hi = q1 - 1.5 * (q3 - q1), q3 + 1.5 * (q3 - q1)
        kept = [(v, w) for v, w in pairs if v and lo <= v <= hi]
    else:
        kept = [(v, w) for v, w in pairs if v and v > 0]
    sw = sum(w for _, w in kept)
    return math.exp(sum(w * math.log(v) for v, w in kept) / sw) if sw else None


def appraise(subject_score: float, subject: dict, comps: list[dict],
             params_num: dict, time_adjust: dict) -> dict:
    """F-17 v2 적정매매가. subject={total_area,land_area,gongsi_latest(원/㎡)}. 유효 comp 부족 시 None."""
    subj_ta = _num(subject.get("total_area"))
    subj_la = _num(subject.get("land_area"))
    subj_g = _num(subject.get("gongsi_latest"))
    subj_gt = subj_g * subj_la if (subj_g and subj_la) else None

    R: list[tuple[float, float]] = []   # 공시배율 (price/공시총액)
    P: list[tuple[float, float]] = []   # 대지단가 (price/대지㎡)
    T: list[tuple[float, float]] = []   # 연면적단가 (price/연면적㎡)
    used: list[dict] = []
    for c in comps:
        price = c.get("price")
        if not price:
            continue
        ta, la, gt = _num(c.get("total_area")), _num(c.get("land_area")), _num(c.get("gongsi_total"))
        adj = float(time_adjust.get(str(_year(c.get("contract_ym"))), 0.0))
        padj = price * (1 + adj)
        w = 1.0 / ((c.get("dist_m") or 0) + 50)   # 거리가중
        if gt:
            R.append((padj / gt, w))
        if la:
            P.append((padj / la, w))
        if ta:
            T.append((padj / ta, w))
        used.append({"building_pk": c.get("building_pk"), "addr": c.get("addr"),
                     "contract_ym": c.get("contract_ym"), "price": price,
                     "area_py": round(ta / M2_PER_PYEONG, 2) if ta else None,
                     "score": c.get("score"), "per_now": round(padj / ta * M2_PER_PYEONG) if ta else None,
                     "time_adj": adj, "weight": round(w, 6)})

    gr, gp, gta = _geomean_iqr(R), _geomean_iqr(P), _geomean_iqr(T)
    m_gong = gr * subj_gt if (gr and subj_gt) else None      # 공시배율법
    m_land = gp * subj_la if (gp and subj_la) else None      # 대지평단가법
    ta_val = gta * subj_ta if (gta and subj_ta) else None    # 연면적법
    # 공시:대지 블렌드. 공시지가가 미시입지(그 블록 값)를 잡아 공시쪽 우위 → 그리드서치 최적 0.6:0.4.
    wg = params_num.get("blend.gongsi", 0.6)
    if m_gong and m_land:
        base = wg * m_gong + (1 - wg) * m_land
    else:
        base = m_gong or m_land or ta_val
    if not base:
        return {"fair_price": None, "avg_per_pyeong": None, "comps_used": used}

    eff_far = (subj_ta / subj_la * 100) if (subj_ta and subj_la) else 0   # 유효용적률
    alpha = min(0.6, max(0.0, (eff_far - 400) / 600)) if (eff_far and ta_val) else 0.0
    fair = round((1 - alpha) * base + alpha * (ta_val if ta_val else base))
    avg_per = round(fair / (subj_ta / M2_PER_PYEONG)) if subj_ta else None
    # 산출 분해(리포트 '적정가 근거 리빌'용) — 각 방법값 + 블렌드 비중
    breakdown = {
        "gong": round(m_gong) if m_gong else None,   # 공시배율법
        "land": round(m_land) if m_land else None,   # 대지평단가법
        "far": round(ta_val) if ta_val else None,    # 연면적법
        "wg": round(wg, 2),                          # 공시:대지 비중(공시측)
        "base": round(base),                         # 공시·대지 블렌드
        "alpha": round(alpha, 3),                    # 연면적법 반영 비중(유효용적률↑일수록)
        "comp_fair": fair,                           # 수익환원 블렌드 전 comp 적정가
    }
    return {"fair_price": fair, "avg_per_pyeong": avg_per, "comps_used": used, "breakdown": breakdown}


def blend_income(fair_price: int | None, ann_rent: float | None, cap: float | None, beta: float) -> int | None:
    """수익환원 블렌드: (1−β)·comp적정가 + β·(연NOI÷cap). 재료 부족하면 원값 그대로. synthesize·배치 공용."""
    if not (fair_price and ann_rent and cap and beta):
        return fair_price
    return round((1 - beta) * fair_price + beta * (ann_rent / cap))


def expected_roi(applied_total_rent: float | None, fair_price: int | None) -> float | None:
    """F-18 예상수익률(%) = 적용 총임대료 × 12 ÷ 적정매매가 × 100."""
    if not fair_price or not applied_total_rent:
        return None
    return round(applied_total_rent * 12 / fair_price * 100, 2)


if __name__ == "__main__":  # ponytail: self-check
    # 본매물 = comp와 동일 제원(연면적100평·대지100㎡·공시1천만/㎡). comp 실거래 20억 → 적정가 20억.
    subj = {"total_area": 330.5785, "land_area": 100.0, "gongsi_latest": 1e7}
    comp = {"price": 2e9, "total_area": 330.5785, "land_area": 100.0, "gongsi_total": 1e9,
            "contract_ym": "202506", "dist_m": 0, "building_pk": "x", "addr": "a"}
    r = appraise(80, subj, [comp], {}, {})
    assert r["fair_price"] == round(2e9), r          # 공시배율2×1e9=2e9, 대지2e7×100=2e9, base=2e9, α=0
    assert appraise(80, subj, [], {}, {})["fair_price"] is None
    # 대형(고용적) α가중: 유효용적 1400% → α=0.6, 연면적법 섞임
    big = {"total_area": 14000.0, "land_area": 1000.0, "gongsi_latest": 1e7}
    bc = {"price": 5e10, "total_area": 14000.0, "land_area": 1000.0, "gongsi_total": 1e10,
          "contract_ym": "202506", "dist_m": 0}
    rb = appraise(80, big, [bc], {}, {})
    assert rb["fair_price"] == round(5e10), rb       # 동일제원이라 모든 방법=5e10 → α무관 5e10
    print("report_calc v2 self-check ok")
