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
USE_ZONE_SCORES = {  # UQA 코드 기준
    "UQA210": 100, "UQA220": 96, "UQA230": 90, "UQA130": 80, "UQA240": 74,
    "UQA330": 70, "UQA123": 65, "UQA122": 55, "UQA320": 50, "UQA121": 42,
    "UQA310": 36, "UQA112": 28, "UQA111": 24, "UQA430": 18, "UQA420": 12,
    "UQA410": 6, "UQA500": 0,
}
SHAPE_SCORES = {"정방형": 100, "가로장방": 95, "세로장방": 60, "사다리형": 50, "부정형": 30, "자루형": 10}
SLOPE_SCORES = {"평지": 100, "완경사": 80, "고지": 72, "저지": 68, "급경사": 20}


def station_score(dist_m: float | None) -> int:
    if dist_m is None:
        return 0
    for limit, score in [(10, 100), (80, 90), (160, 85), (240, 78), (320, 68),
                         (400, 58), (480, 40), (560, 28), (640, 18), (720, 10), (800, 4)]:
        if dist_m <= limit:
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


# param_key(weight.*) → 항목 점수 산출 매핑
def item_scores(b: dict[str, Any]) -> dict[str, int]:
    return {
        "road_access": ROAD_SCORES.get(b.get("road_access") or "", 0),
        "station_dist": station_score(b.get("station_dist_m")),
        "use_zone": USE_ZONE_SCORES.get(b.get("use_zone") or "", 0),
        "shape": SHAPE_SCORES.get(b.get("shape") or "", 0),
        "approval_date": age_score(b.get("age_years")),
        "elevator": 100 if b.get("has_elevator") else 0,
        "remodel": remodel_score(b.get("remodel_years")),
        "slope": SLOPE_SCORES.get(b.get("slope") or "", 0),
    }


def compute(building: dict[str, Any], params: dict[str, float]) -> dict[str, Any]:
    """params = {'weight.road_access':18, ..., 'grade_cut.S':90, ...} (ref.formula_params)."""
    scores = item_scores(building)
    total = sum(
        scores[k] * params.get(f"weight.{k}", 0) / 100.0
        for k in scores
    )
    total = round(total, 1)
    if total >= params.get("grade_cut.S", 90):
        grade = "S"
    elif total >= params.get("grade_cut.A", 75):
        grade = "A"
    elif total >= params.get("grade_cut.B", 60):
        grade = "B"
    else:
        grade = "C"
    return {"score": total, "grade": grade, "items": scores}
