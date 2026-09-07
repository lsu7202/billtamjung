"""F-16 가치점수: 8항목 가중합(가중치=ref.formula_params, 배포 없이 튜닝).
specs formulas.md F-16. 결측=0점(게이팅 없음). 등급 S/A/B/C = grade_cut.
"""
from typing import Any

# 항목별 점수표(formulas.md 정본)
ROAD_SCORES = {
    "광대소각": 90, "광대세각": 83, "광대로한면": 76, "중로각지": 69, "중로한면": 54,
    "소로각지": 51, "소로한면": 32, "세로각지(가)": 28, "세로한면(가)": 17,
    "세로각지(불)": 10, "세로한면(불)": 3, "맹지": 0,
}
USE_ZONE_SCORES = {  # 마스터 저장값(한글 라벨) 기준. 걸침("A 60% + B 40%")은 앞 지역명으로 매칭
    "중심상업지역": 100, "일반상업지역": 96, "근린상업지역": 90, "준주거지역": 80,
    "유통상업지역": 74, "준공업지역": 70, "제3종일반주거지역": 65, "제2종일반주거지역": 55,
    "일반공업지역": 50, "제1종일반주거지역": 42, "전용공업지역": 36, "제2종전용주거지역": 28,
    "제1종전용주거지역": 24, "자연녹지지역": 18, "생산녹지지역": 12, "보전녹지지역": 6,
    "도시지역미지정": 0,
}


def use_zone_score(v: str | None) -> int:
    if not v:
        return 0
    head = v.split("%")[0].strip().rstrip("0123456789 ").strip()  # 걸침 앞 지역명
    for name, sc in USE_ZONE_SCORES.items():
        if v.startswith(name) or head.startswith(name) or name in v:
            return sc
    return 0
SHAPE_SCORES = {"정방형": 100, "가로장방": 95, "세로장방": 60, "사다리형": 50, "부정형": 30, "자루형": 10}
SLOPE_SCORES = {"평지": 100, "완경사": 80, "고지": 72, "저지": 68, "급경사": 20}


# 데이터=역 '중심' 좌표까지 거리 → 실제 도보는 가장 가까운 출구 기준(더 짧음).
# 측정거리에서 이 값을 빼고 도보시간 기반 표(80m/분)를 적용해 보정. 역중심↔출구 ≈ 100m(튜닝 노브).
STATION_CENTER_OFFSET_M = 100


def station_score(dist_m: float | None) -> int:
    if dist_m is None:
        return 0
    d = max(0.0, dist_m - STATION_CENTER_OFFSET_M)   # 역중심→출구 보정
    for limit, score in [(10, 100), (80, 90), (160, 85), (240, 78), (320, 68),
                         (400, 58), (480, 40), (560, 28), (640, 18), (720, 10), (800, 4)]:
        if d <= limit:
            return score
    return 0


def age_score(age_years: float | None) -> int:
    if age_years is None:
        return 0
    for limit, score in [(3, 100), (5, 95), (10, 85), (15, 75), (20, 65),
                         (25, 55), (30, 45), (35, 35), (40, 25)]:
        if age_years <= limit:
            return score
    return 15


def remodel_score(years_since: float | None) -> int:
    if years_since is None:
        return 0   # 이력없음
    for limit, score in [(3, 100), (5, 80), (10, 40), (15, 20), (20, 10)]:
        if years_since <= limit:
            return score
    return 0


# 유동인구(float_pop): NICE 전건물 미확보 → 도로접면·역거리 proxy로 마스터값 초기화(route B).
# 유저 오버레이(enum) 있으면 우선. comp도 전 건물 값이 존재 → F-17 유사도 가중 정상화.
FLOAT_POP_SCORES = {"매우높음": 100, "높음": 78, "보통": 50, "낮음": 22, "매우낮음": 6}


# 유동인구 5분위 칸 — 서울 전체 건물 559,458동의 주간 생활인구 실측 분포(2026-08-27).
# 접근성 proxy 를 「유동인구」라 부르던 것을 걷어냈다. 이름이 값과 달랐다.
POP_CUTS = [(2383, "매우높음", 100), (1615, "높음", 78), (1025, "보통", 50), (381, "낮음", 22)]


def _pop_bucket(b: dict[str, Any]):
    """실측 주간 생활인구(master.building_pop.day_avg) → (등급, 점수). 없으면 None."""
    day = _num(b.get("pop_day"))
    if day is None:
        return None
    for cut, lbl, sc in POP_CUTS:
        if day >= cut:
            return lbl, sc
    return "매우낮음", 6


def float_pop_score(b: dict[str, Any]) -> int:
    ov = b.get("float_pop")
    if ov in FLOAT_POP_SCORES:                # 유저 오버레이 우선
        return FLOAT_POP_SCORES[ov]
    hit = _pop_bucket(b)                      # 실측
    if hit:
        return hit[1]
    # 실측이 없는 4.3%(좌표 없는 건물)만 접근성 proxy 로 메운다
    proxy = (ROAD_SCORES.get(b.get("road_frontage") or "", 0)
             + station_score(_num(b.get("station_dist")))) / 2
    for cut, sc in [(80, 100), (60, 78), (40, 50), (20, 22)]:
        if proxy >= cut:
            return sc
    return 6


def float_pop_label(b: dict[str, Any]) -> str:
    """유동인구 등급 — 오버레이 > 실측(생활인구) > 접근성 proxy."""
    ov = b.get("float_pop")
    if ov in FLOAT_POP_SCORES:
        return ov
    hit = _pop_bucket(b)
    if hit:
        return hit[0]
    proxy = (ROAD_SCORES.get(b.get("road_frontage") or "", 0)
             + station_score(_num(b.get("station_dist")))) / 2
    for cut, lbl in [(80, "매우높음"), (60, "높음"), (40, "보통"), (20, "낮음")]:
        if proxy >= cut:
            return lbl
    return "매우낮음"


# param_key(weight.*) → 항목 점수 산출 매핑. 키 = 마스터 실제 컬럼명(0006/0009/0011)
def item_scores(b: dict[str, Any]) -> dict[str, int]:
    return {
        "road_access": ROAD_SCORES.get(b.get("road_frontage") or "", 0),
        "station_dist": station_score(_num(b.get("station_dist"))),
        "use_zone": use_zone_score(b.get("use_zone")),
        "shape": SHAPE_SCORES.get(b.get("shape") or "", 0),
        "approval_date": age_score(b.get("age_years")),
        "elevator": 100 if _num(b.get("elevator")) else 0,
        "remodel": remodel_score(b.get("remodel_years")),
        "slope": SLOPE_SCORES.get(b.get("slope") or "", 0),
        "float_pop": float_pop_score(b),
    }


def _num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# compute()(F-16 매력도 총점·등급)는 2026-09-06 에 없앴다 — 대표 결정 「매력도 기능은 아예 없앤다」.
# 남은 것은 활용유형(use_type)·임대 실험이 쓰는 항목 점수뿐이다.
