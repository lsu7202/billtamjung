"""F-20 활용 유형(최유효이용) 분류 — 신축/리모델/수익 유형별 점수 + 사옥 적합도.

별도 축(활용 전략). 현재가치·매력도와 독립. 유형별 적합도 0~100 → 대표유형=최고점.
순수 함수(테스트 가능). 데이터 조립(legal_far·상권 프로필)은 호출부(generate_report)에서.
경계값은 서울 분포로 캘리브레이션 예정(강남 상업: 활용률 중앙 98·연식 28). specs formulas.md F-20.
    python backend/app/jobs/use_type.py   # 자체 검증
"""
from __future__ import annotations


def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def util_ratio(far: float | None, legal_far: float | None) -> float | None:
    """활용률(%) = 현재 용적률 ÷ 법정 용적률 × 100. ≥100=이미 초과(개발여지 0)."""
    if not far or not legal_far:
        return None
    return far / legal_far * 100.0


def _feasibility(land_area_py: float | None, shape: str | None, road_frontage: str | None) -> float:
    """신축 물리 실현가능성(0~1) — 소규모·부정형·맹지 감점."""
    f = 1.0
    if land_area_py is not None and land_area_py < 60:      # 소규모(<60평) 감점
        f *= _clamp(land_area_py / 60, 0.3, 1.0)
    if shape in ("부정형", "자루형"):
        f *= 0.6
    if road_frontage == "맹지":                              # 맹지=건축 불가에 가까움
        f *= 0.25
    return f


def new_build_score(land_use: str | None, util: float | None, age: float | None,
                    floors_above: int | None, land_area_py: float | None,
                    shape: str | None, road_frontage: str | None) -> int:
    """신축용 점수 0~100 — 개발여지 큼 + 노후 + 물리 실현가능."""
    if land_use and "나지" in land_use:                      # 나지=건물 없음 → 신축 확정
        return 100
    if util is None:
        return 0
    dev = _clamp((100 - util) / 40)                          # 활용률 60→1, 100→0(여지 없음)
    if floors_above is not None and floors_above <= 2:       # 저층=저활용 강신호
        dev = max(dev, 0.9)
    old = _clamp(((age or 0) - 20) / 15)                     # 20년→0, 35년+→1
    return round(100 * dev * (0.5 + 0.5 * old) * _feasibility(land_area_py, shape, road_frontage))


def remodel_score(util: float | None, age: float | None, road_score: float,
                  station_score: float, remodel_years: float | None) -> int:
    """리모델링용 점수 0~100 — 신축 이득 작음(활용률↑) + 노후~중간 + 좋은 입지 + 대수선 여지."""
    if util is None:
        return 0
    nodev = _clamp(util / 100)                               # 활용률 높을수록 신축 이득↓ → 리모델↑
    old = _clamp(((age or 0) - 15) / 20)                     # 15년→0, 35년+→1(중간~노후)
    loc = _clamp((road_score + station_score) / 200)        # 입지(가시성·역세권) — F-16 점수 재사용
    fresh = 1.0 if remodel_years is None else _clamp(remodel_years / 15, 0.3, 1.0)  # 최근 대수선=여지↓
    return round(100 * nodev * old * loc * fresh)


def income_score(new_s: int, remodel_s: int) -> int:
    """수익형(기본값) 0~100 — 특수유형(신축·리모델)이 강할수록 약화."""
    return round(_clamp(100 - max(new_s, remodel_s) * 0.8, 0, 100))


def office_fit_score(market: dict, station_score: float, use_zone: str | None) -> int:
    """사옥 적합도 0~100 (유형 아닌 별도 지표) — 업무상권+역세권+업무/상업지역. 매수 의도는 유저 지정."""
    biz = _clamp(market.get("office", 0.0))                  # 업무 상권 비중
    quiet = _clamp(1 - (market.get("ent", 0.0) + market.get("food", 0.0) * 0.5))  # 유흥·먹자 회피
    transit = station_score / 100.0
    zone = 1.0 if (use_zone and any(z in use_zone for z in ("상업", "업무", "준주거"))) else 0.5
    return round(100 * (0.35 * biz + 0.25 * quiet + 0.25 * transit + 0.15 * zone))


def dev_headroom_score(far: float | None, legal_far: float | None, land_use: str | None) -> int | None:
    """개발여지 0~100 — 미사용 용적률(법정−현재)÷법정. 나지=100(전량 신축). None=판정불가."""
    if land_use and "나지" in land_use:
        return 100
    if not far or not legal_far:
        return None
    return round(_clamp((legal_far - far) / legal_far) * 100)


def rent_upside_score(cur_rent: float | None, mkt_rent: float | None) -> int | None:
    """임대 상향 여력 0~100 — (주변시세−현재)÷현재. +30% 이상=만점. None=현재임대 없음."""
    if not cur_rent or mkt_rent is None:
        return None
    return round(_clamp((mkt_rent - cur_rent) / cur_rent / 0.30) * 100)


def future_value(far: float | None, legal_far: float | None, land_use: str | None,
                 cur_rent: float | None, mkt_rent: float | None) -> dict:
    """미래가치(상승 여력) = 개발여지 + 임대 상향 여력 2축 블렌드 0~100.
    지가상승추세(3축)는 표준지공시지가 시계열 확보 후 추가 예정(specs formulas.md F-21)."""
    dev = dev_headroom_score(far, legal_far, land_use)
    up = rent_upside_score(cur_rent, mkt_rent)
    parts = [(dev, 0.55), (up, 0.45)]                        # 개발여지 우세(가격 영향 큼)
    avail = [(s, w) for s, w in parts if s is not None]
    score = round(sum(s * w for s, w in avail) / sum(w for _, w in avail)) if avail else None
    grade = None if score is None else ("높음" if score >= 60 else "보통" if score >= 30 else "제한적")
    return {"score": score, "grade": grade, "dev": dev, "upside": up,
            "reason": _future_reason(dev, up, grade)}


def _future_reason(dev: int | None, up: int | None, grade: str | None) -> str:
    if grade is None:
        return "미래가치 산정에 필요한 데이터가 부족합니다"
    if grade == "제한적":
        return "개발여지·임대 상향 여력이 모두 제한적 — 이미 성숙한 우량자산으로 안정적 보유형"
    hi = "개발여지" if (dev or 0) >= (up or 0) else "임대 상향 여력"
    return f"{hi}를 중심으로 향후 가치 상승 여력이 있습니다"


def classify(inp: dict) -> dict:
    """유형별 점수 + 대표유형 + 사옥 적합도 + 근거.
    inp: far, legal_far, land_use, floors_above, age_years, remodel_years, land_area_py,
         shape, road_frontage, road_score, station_score, use_zone, market{office,food,ent,retail}."""
    util = util_ratio(inp.get("far"), inp.get("legal_far"))
    ns = new_build_score(inp.get("land_use"), util, inp.get("age_years"), inp.get("floors_above"),
                         inp.get("land_area_py"), inp.get("shape"), inp.get("road_frontage"))
    rs = remodel_score(util, inp.get("age_years"), inp.get("road_score", 0), inp.get("station_score", 0),
                       inp.get("remodel_years"))
    is_ = income_score(ns, rs)
    of = office_fit_score(inp.get("market") or {}, inp.get("station_score", 0), inp.get("use_zone"))
    scores = {"신축용": ns, "리모델링용": rs, "수익형": is_}
    primary = max(scores, key=lambda k: scores[k])
    reason = _reason(primary, util, inp)
    return {"primary": primary, "scores": scores, "office_fit": of, "util": round(util) if util else None,
            "reason": reason, "market": inp.get("market") or {}}


def _reason(primary: str, util: float | None, inp: dict) -> str:
    age = inp.get("age_years")
    lu = inp.get("land_use") or ""
    if primary == "신축용":
        if "나지" in lu:
            return "나대지(건물 없음) — 신축 외 활용 불가"
        return f"활용률 {round(util)}%로 개발여지가 크고 {round(age) if age else '—'}년 노후"
    if primary == "리모델링용":
        return f"활용률 {round(util) if util else '—'}%로 신축 이득이 작고 입지·가시성이 좋아 개보수 유리"
    return f"활용률 {round(util) if util else '—'}%로 개발여지가 적어 현 상태 임대 운영이 적합"


def demo() -> None:
    """자체 검증 — 대표 케이스."""
    # 157-36: 활용률 120%(초과)·30년·18층 프라임 오피스 → 신축 아님(리모델/수익)
    a = classify({"far": 956, "legal_far": 800, "age_years": 30, "floors_above": 18, "land_area_py": 325,
                  "land_use": "업무용", "road_score": 83, "station_score": 40, "use_zone": "일반상업지역",
                  "market": {"office": 0.75, "food": 0.13, "ent": 0.01}})
    assert a["scores"]["신축용"] < 30, a
    assert a["office_fit"] >= 60, a          # 업무상권+역세권 → 사옥 적합
    # 나지 → 신축용 확정
    b = classify({"land_use": "상업나지", "far": 0, "legal_far": 800})
    assert b["primary"] == "신축용" and b["scores"]["신축용"] == 100, b
    # 저활용 노후(활용률 40%·40년·2층) → 신축용
    c = classify({"far": 320, "legal_far": 800, "age_years": 40, "floors_above": 2, "land_area_py": 200,
                  "land_use": "상업용", "road_score": 76, "station_score": 60, "use_zone": "일반상업지역",
                  "market": {"office": 0.3, "food": 0.4, "ent": 0.1}})
    assert c["primary"] == "신축용", c
    # 고활용 노후 + 좋은 입지(활용률 95%·35년·8층) → 리모델링용
    d = classify({"far": 760, "legal_far": 800, "age_years": 35, "floors_above": 8, "land_area_py": 150,
                  "land_use": "상업용", "road_score": 90, "station_score": 90, "remodel_years": None,
                  "use_zone": "일반상업지역", "market": {"office": 0.5, "food": 0.3, "ent": 0.05}})
    assert d["primary"] == "리모델링용", d
    # 미래가치: 157-36(활용률 120%·현재임대≈주변) → 제한적
    fv = future_value(far=956, legal_far=800, land_use="업무용", cur_rent=43682, mkt_rent=43597)
    assert fv["dev"] == 0 and fv["grade"] == "제한적", fv
    # 저활용 + 임대 상향 여력 큼 → 높음
    fv2 = future_value(far=200, legal_far=800, land_use="상업용", cur_rent=100, mkt_rent=150)
    assert fv2["score"] and fv2["score"] >= 60, fv2
    # 나지 → 개발여지 100
    assert dev_headroom_score(0, 800, "상업나지") == 100
    print("미래가치(157-36):", fv, "| 저활용:", fv2)
    print("신축(157-36):", a)
    print("나지:", b)
    print("저활용노후:", c)
    print("고활용노후:", d)
    print("✅ demo OK")


if __name__ == "__main__":
    demo()
