"""F-17 적정매매가 v3 · F-18 예상수익률 (R STEP2/4). specs formulas.md.

v3(2026-08-05) = v2 + 연식 개별요인 보정(B) + 연식·규모 유사성 가중(C) + α하한(D).
v3.2(2026-08-30) = v3 + 도로접면 등급(E1) + 주야비(E2). 둘 다 대칭 보정.
  8구 홀드아웃(타깃 2025~ · 798건) 검증 MdAPE 18.11% → 16.99%.
백테스트(LOO·과거comp만): 강남 MdAPE 26.7→22.7% · 마포 19.1→16.4%. 계수는 params로 오버라이드 가능.

v2 = 공시배율법·대지평단가법 블렌드 + 대형(고용적) 연면적법 α가중. 거리가중 기하평균·IQR.
  추정가 = (1−α)·[0.5·공시배율×본매물공시총액 + 0.5·대지단가×본매물대지] + α·연면적단가×본매물연면적
  α = min(0.6, max(0,(유효용적률−400)/600)),  유효용적률 = 연면적/대지×100
  comp별 거리가중 w=1/(dist_m+50), 기하평균, 방법별 IQR 이상치 제외, 시점보정.
강남 백테스트 MdAPE ~14%(연면적+F16 구산 22.7% 대비). 규모 미스매치 편향 해소.
입력 comp = {price, total_area(㎡), land_area(㎡), gongsi_total(원), contract_ym, dist_m}.
"""
import math
import statistics

M2_PER_PYEONG = 3.305785

# ── comp 성격(섹터) 매칭 — 배치(build_sale_est)·라이브(_fetch_comps) 공용 정본 ──
# 여기가 단일 소스: generate_report가 import해서 쓰고, 배치도 동일 함수로 필터 → 두 경로 comp 풀 일치.
SECTORS = {
    "commercial": {"상업용", "업무용", "상업기타"},      # 상업용 빌딩
    "mixed": {"주상용", "주상기타"},                     # 상가주택
    "resi": {"단독", "연립", "다세대", "아파트", "주거기타"},
    "industrial": {"공업용", "공업기타"},
}
MU_SECTOR = {
    "03": "commercial", "04": "commercial", "05": "commercial", "07": "commercial",
    "09": "commercial", "13": "commercial", "14": "commercial", "15": "commercial", "16": "commercial",
    "01": "resi", "02": "resi", "17": "industrial", "18": "industrial",
}
SECTOR_MU: dict[str, set[str]] = {}
for _c, _s in MU_SECTOR.items():
    SECTOR_MU.setdefault(_s, set()).add(_c)
ADJACENT = {"commercial": {"mixed"}, "mixed": {"commercial"}}   # 소득형 인접(상호 comp 허용, 감점)
ADJ_FACTOR = 0.7


def sector_of(lu: str | None, mu: str | None = None) -> str | None:
    """건물 성격. main_use(법정 주용도) 우선, land_use는 상가주택 판정 보조(오분류 방어)."""
    msec = MU_SECTOR.get(str(mu)[:2]) if mu else None
    if msec == "commercial":
        return "mixed" if lu in SECTORS["mixed"] else "commercial"
    if msec == "resi":
        return "mixed" if (lu in SECTORS["mixed"] or lu in SECTORS["commercial"]) else "resi"
    if msec == "industrial":
        return "industrial"
    return next((s for s, items in SECTORS.items() if lu in items), None)


def comp_type_filter(subject_lu: str | None, subject_mu: str | None = None):
    """반환 (allowed_land_uses|None, allowed_mu_codes|None, adjacent_set). None=분류 불가 → 필터 미적용.
    comp 인정 = land_use ∈ allowed_lu OR main_use[:2] ∈ allowed_mu."""
    sec = sector_of(subject_lu, subject_mu)
    if sec is None:
        return None, None, set()
    secs = {sec} | ADJACENT.get(sec, set())
    adj = set().union(*[SECTORS[a] for a in ADJACENT.get(sec, set())]) if ADJACENT.get(sec) else set()
    allowed_lu = sorted(set().union(*[SECTORS[s] for s in secs]))
    allowed_mu = sorted(set().union(*[SECTOR_MU.get(s, set()) for s in secs]))
    return allowed_lu, allowed_mu, adj
_THIS_YEAR = __import__("datetime").date.today().year


def _age_from(ymd, remodel_ymd=None, remodel_offset=None) -> float | None:
    """준공연도 → 연식(년). 리모델링 있으면 유효연식 = min(연식, 리모델 경과+offset)."""
    def _yr(v):
        try:
            return int(str(v)[:4])
        except (TypeError, ValueError):
            return None
    a = _yr(ymd)
    if a is None:
        return None
    age = max(0.0, _THIS_YEAR - a)
    r = _yr(remodel_ymd)
    if r is not None and remodel_offset is not None:
        age = min(age, max(0.0, _THIS_YEAR - r) + remodel_offset)
    return age


def _value_factor(age: float | None, d1: float, d2: float, d3: float, floor: float) -> float:
    """연령 구간형 가치계수(전체가치) — 초기 가속·중년 완만·후기 정체(문헌 정합). 백테스트 최적."""
    if age is None:
        return 1.0
    f = 1.0 - d1 * min(age, 10) - d2 * max(0.0, min(age, 30) - 10) - d3 * max(0.0, age - 30)
    return max(floor, f)


def _road_grade(rf) -> float | None:
    """도로접면 등급(감정평가 개별요인 사다리): 광대6·중로5·소로4·세로가3·세로불2·맹지1, 각지 +0.5.
    모르면 None — 없는 값을 평균으로 지어내면 그 comp만 조용히 유리해진다."""
    if not rf:
        return None
    g = None
    for pre, v in (("광대", 6), ("중로", 5), ("소로", 4), ("맹지", 1)):
        if str(rf).startswith(pre):
            g = v
            break
    if g is None and str(rf).startswith("세로"):
        g = 2 if "불" in str(rf) else 3
    if g is None:
        return None
    return g + (0.5 if "각" in str(rf) else 0.0)


def _daynight(d: dict) -> float | None:
    """주야비(낮÷밤 생활인구). 한쪽이라도 없으면 None."""
    dv, nv = _num(d.get("day_pop")), _num(d.get("night_pop"))
    return (dv / nv) if (dv and nv and nv > 0) else None


def _quarter(contract_ym) -> str | None:
    ym = str(contract_ym or "")
    if len(ym) < 6:
        return None
    m = ym[4:6]
    return ym[:4] + ("Q1" if m <= "03" else "Q2" if m <= "06" else "Q3" if m <= "09" else "Q4")


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


def appraise(subject: dict, comps: list[dict],
             params_num: dict, time_adjust: dict) -> dict:
    """F-17 v2 적정매매가. subject={total_area,land_area,gongsi_latest(원/㎡)}. 유효 comp 부족 시 None."""
    subj_ta = _num(subject.get("total_area"))
    subj_la = _num(subject.get("land_area"))
    subj_g = _num(subject.get("gongsi_latest"))
    subj_gt = subj_g * subj_la if (subj_g and subj_la) else None
    # v3 보정 파라미터(백테스트 최적 기본값 — ref.formula_params로 오버라이드 가능)
    d1 = params_num.get("age.d1", 0.035); d2 = params_num.get("age.d2", 0.0)
    d3 = params_num.get("age.d3", 0.0); afloor = params_num.get("age.floor", 0.55)
    r_off = params_num.get("age.remodel_offset", 5.0)       # 리모델 시 유효연식=리모델경과+5
    sim_age = params_num.get("sim.age_scale", 25.0); sim_size = params_num.get("sim.size_scale", 0.5)
    use_sim = params_num.get("sim.enabled", 1.0) >= 0.5
    rec_scale = params_num.get("recency.scale", 12.0)       # 최신성 가중(개월) — 0이면 미적용
    # E(2026-08-30): 잔차에 남아 있던 두 축. 8구 홀드아웃 검증 18.11% → 16.99%(-1.12p).
    #   도로접면 단독 -0.79p · 주야비 단독 -0.47p · 둘 다 -1.12p. ±15% 적중 42.2% → 44.4%.
    # 둘 다 **대칭 보정**이다 — comp 가격을 본매물 조건으로 환산할 뿐, 절대 점수를 얹지 않는다.
    road_pct = params_num.get("road.pct", 0.06)             # 도로접면 등급 1칸당 %
    pop_pct = params_num.get("pop.pct", 0.2)                # 주야비 비율의 지수
    _now_ym = _THIS_YEAR * 12 + __import__("datetime").date.today().month
    subj_age = _age_from(subject.get("approval_ymd"), subject.get("remodel_ymd"), r_off)

    R: list[tuple[float, float]] = []   # 공시배율 (price/공시총액)
    P: list[tuple[float, float]] = []   # 대지단가 (price/대지㎡)
    T: list[tuple[float, float]] = []   # 연면적단가 (price/연면적㎡)
    used: list[dict] = []
    for c in comps:
        price = c.get("price")
        if not price:
            continue
        ta, la, gt = _num(c.get("total_area")), _num(c.get("land_area")), _num(c.get("gongsi_total"))
        # 시점보정 v3.1: time_adjust에 분기지수('2024Q1':ratio)가 있으면 지수비, 없으면 연표(1+adj)
        qk = _quarter(c.get("contract_ym"))
        q_latest = max((k for k in time_adjust if "Q" in str(k)), default=None)
        if q_latest and qk and time_adjust.get(qk):
            adj = float(time_adjust[q_latest]) / float(time_adjust[qk]) - 1.0
        else:
            adj = float(time_adjust.get(str(_year(c.get("contract_ym"))), 0.0))
        padj = price * (1 + adj)
        c_age = _age_from(c.get("approval_ymd"), c.get("remodel_ymd"), r_off)
        # B: 연식 개별요인 보정 — comp 가격을 본매물 연식 기준으로 환산(신축 프리미엄/노후 디스카운트).
        # ★ 양측 연식이 모두 있을 때만 — 편측 미상 시 걸면 최대 +54% 왜곡(감사에서 적발·수정 2026-08-05)
        if (d1 or d2 or d3) and subj_age is not None and c_age is not None:
            padj *= _value_factor(subj_age, d1, d2, d3, afloor) / _value_factor(c_age, d1, d2, d3, afloor)
        if road_pct:   # E1 도로접면 — 광대로변과 세로변은 같은 동네라도 값이 다르다
            gs, gc = _road_grade(subject.get("road_frontage")), _road_grade(c.get("road_frontage"))
            if gs is not None and gc is not None:
                padj *= (1.0 + road_pct) ** (gs - gc)
        if pop_pct:    # E2 주야비 — 낮에 사람이 몰리는 자리가 비싸다(상권의 힘)
            rs, rc = _daynight(subject), _daynight(c)
            if rs and rc:
                padj *= max(0.5, min(2.5, rs / rc)) ** pop_pct
        w = 1.0 / ((c.get("dist_m") or 0) + 50)   # 거리가중
        if rec_scale:                              # 최신성: 최근 거래일수록 가중(백테스트 −2.7pt)
            try:
                cym = str(c.get("contract_ym") or "")
                mdiff = _now_ym - (int(cym[:4]) * 12 + int(cym[4:6] or 6))
                w *= 1.0 / (1.0 + max(0, mdiff) / rec_scale)
            except (TypeError, ValueError):
                pass
        if use_sim:                                # C: 경제적 거리(연식·규모 유사성) — IAAO 표준 방식
            if c_age is not None and subj_age is not None:
                w *= 1.0 / (1.0 + abs(c_age - subj_age) / sim_age)
            if ta and subj_ta:
                w *= 1.0 / (1.0 + abs(math.log(ta / subj_ta)) / sim_size)
        if gt:
            R.append((padj / gt, w))
        if la:
            P.append((padj / la, w))
        if ta:
            T.append((padj / ta, w))
        used.append({"building_pk": c.get("building_pk"), "addr": c.get("addr"),
                     "contract_ym": c.get("contract_ym"), "price": price,
                     "area_py": round(ta / M2_PER_PYEONG, 2) if ta else None,
                     "per_now": round(padj / ta * M2_PER_PYEONG) if ta else None,
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
        return {"fair_price": None, "avg_per_pyeong": None, "avg_per_land": None, "comps_used": used}

    eff_far = (subj_ta / subj_la * 100) if (subj_ta and subj_la) else 0   # 유효용적률
    a_floor = params_num.get("alpha.floor", 0.1)   # D: 저용적에도 연면적법 최소 반영(v3)
    a_max = params_num.get("alpha.max", 0.8)       # 고용적 상한 0.6→0.8 — 대형 저평가 완화(감사 후 재튜닝)
    alpha = min(a_max, max(a_floor, (eff_far - 400) / 600)) if (eff_far and ta_val) else (a_floor if ta_val else 0.0)
    fair_f = (1 - alpha) * base + alpha * (ta_val if ta_val else base)
    # 원가법(복성식) 근사 축(v3): 토지(대지단가법) + 건물 잔존가(표준단가×연면적×연식계수)를 λ만큼 혼합
    cost_c = params_num.get("cost.c", 3.0e6)
    cost_l = params_num.get("cost.lambda", 0.15)
    # 대형(고용적) 게이트: 복성식 근사는 꼬마빌딩 전제(표준단가·대지단가법 토지가) —
    # 유효용적률 200%까지 전량, 400%에서 0 (프라임 오피스 저평가 방지: 삼성동 157-36 −126억 사례)
    cost_gate = max(0.0, min(1.0, (400.0 - eff_far) / 200.0)) if eff_far else 1.0
    cost_l = cost_l * cost_gate
    if cost_c and cost_l and subj_ta and m_land and subj_age is not None:   # 연식 미상=감가 판단 불가 → 스킵
        struct = cost_c * subj_ta * _value_factor(subj_age, d1, d2, d3, afloor)
        fair_f = (1 - cost_l) * fair_f + cost_l * (m_land + struct)
    fair = round(fair_f)
    avg_per = round(fair / (subj_ta / M2_PER_PYEONG)) if subj_ta else None
    # 핵심요약의 '평단가'는 대지 기준으로 말한다 — 상업용 토지는 현장 어법이 대지다(F-09c).
    # 사례 비교(04)는 연면적 기준 그대로다. 같은 물건끼리 견주려면 그쪽이 맞다.
    avg_per_land = round(fair / (subj_la / M2_PER_PYEONG)) if subj_la else None
    # 산출 분해(리포트 '추정가 근거 리빌'용) — 각 방법값 + 블렌드 비중
    breakdown = {
        "gong": round(m_gong) if m_gong else None,   # 공시배율법
        "land": round(m_land) if m_land else None,   # 대지평단가법
        "far": round(ta_val) if ta_val else None,    # 연면적법
        "wg": round(wg, 2),                          # 공시:대지 비중(공시측)
        "base": round(base),                         # 공시·대지 블렌드
        "alpha": round(alpha, 3),                    # 연면적법 반영 비중(유효용적률↑일수록)
        "comp_fair": fair,                           # 수익환원 블렌드 전 comp 추정가
    }
    return {"fair_price": fair, "avg_per_pyeong": avg_per, "avg_per_land": avg_per_land,
            "comps_used": used, "breakdown": breakdown}


def blend_income(fair_price: int | None, ann_rent: float | None, cap: float | None, beta: float) -> int | None:
    """수익환원 블렌드: (1−β)·comp추정가 + β·(연NOI÷cap). 재료 부족하면 원값 그대로. synthesize·배치 공용."""
    if not (fair_price and ann_rent and cap and beta):
        return fair_price
    return round((1 - beta) * fair_price + beta * (ann_rent / cap))


def expected_roi(applied_total_rent: float | None, fair_price: int | None) -> float | None:
    """F-18 예상수익률(%) = 적용 총임대료 × 12 ÷ 적정매매가 × 100."""
    if not fair_price or not applied_total_rent:
        return None
    return round(applied_total_rent * 12 / fair_price * 100, 2)


if __name__ == "__main__":  # ponytail: self-check
    NOCOST = {"cost.lambda": 0.0, "alpha.floor": 0.0}   # 핵심 산식 항등성 검증용(v3 축 off)
    # 본매물 = comp와 동일 제원·동일 연식 → 보정 무영향, comp 실거래 20억 → 추정가 20억.
    subj = {"total_area": 330.5785, "land_area": 100.0, "gongsi_latest": 1e7, "approval_ymd": "2010-01-01"}
    comp = {"price": 2e9, "total_area": 330.5785, "land_area": 100.0, "gongsi_total": 1e9,
            "contract_ym": "202506", "dist_m": 0, "building_pk": "x", "addr": "a", "approval_ymd": "2010-01-01"}
    r = appraise(subj, [comp], NOCOST, {})
    assert r["fair_price"] == round(2e9), r
    # v3 방향성: 본매물 신축 vs comp 노후 → 상향 / 반대 → 하향 (기본 파라미터)
    up = appraise({**subj, "approval_ymd": str(_THIS_YEAR)},
                  [{**comp, "approval_ymd": str(_THIS_YEAR - 20)}], {}, {})["fair_price"]
    dn = appraise({**subj, "approval_ymd": str(_THIS_YEAR - 40)},
                  [{**comp, "approval_ymd": str(_THIS_YEAR)}], {}, {})["fair_price"]
    assert up > 2e9 > dn, (up, dn)
    # 리모델링: 40년 건물이라도 리모델 최근이면 유효연식 단축 → 순수 노후보다 상향
    rem = appraise({**subj, "approval_ymd": str(_THIS_YEAR - 40), "remodel_ymd": str(_THIS_YEAR - 2)},
                   [{**comp, "approval_ymd": str(_THIS_YEAR)}], {}, {})["fair_price"]
    assert rem > dn, (rem, dn)
    assert appraise(subj, [], {}, {})["fair_price"] is None
    # 대형(고용적): 동일 제원이면 α 무관 항등
    big = {"total_area": 14000.0, "land_area": 1000.0, "gongsi_latest": 1e7, "approval_ymd": "2010-01-01"}
    bc = {"price": 5e10, "total_area": 14000.0, "land_area": 1000.0, "gongsi_total": 1e10,
          "contract_ym": "202506", "dist_m": 0, "approval_ymd": "2010-01-01"}
    rb = appraise(big, [bc], NOCOST, {})
    assert rb["fair_price"] == round(5e10), rb
    print("report_calc v3 self-check ok")
