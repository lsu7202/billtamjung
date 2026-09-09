"""모델용 꼴 — 화면 응답을 모델이 읽을 요약으로 굽는다. 정본 10-AI-어시스턴트 §9-9 · §12-1-1 · §23-1

## 왜

모델이 화면용 원문을 읽고 있었다. 건물 상세 40칸에 정류장 일곱, 유동인구는 시간대 24칸에
격자 폴리곤 좌표까지. 한 결과가 2,400토큰이고 그걸 바퀴마다 다시 실었다.
그리고 값에 단위가 없어서(`total_area: 748.79`) 하이쿠가 748.79평으로 읽었다(2026-09-08 겨루기 #55).

## 무엇

길마다 **모델이 읽을 요약**을 정한다. 세 가지가 값에 박힌다.

    단위    「226.5평 (748.79㎡)」   원값을 안 준다. 단위를 뒤바꿀 자리가 없다
    등급    사실 | 참조             유동인구는 KT 통신량 추정이다. 값이 스스로 말한다
    출처    「건축물대장 · 2026-06」  각주로 나간다

그리고 **참조 id** 를 붙인다(`facts#1`). 화면 부품은 이 id 로 원문을 받아 그린다.
모델은 요약을 읽고, 화면은 원문을 그린다. 같은 응답의 두 꼴이라 숫자가 어긋날 일이 없다.

## 격자

요약과 함께 **부품이 바로 먹는 꼴**(kv 줄 · stats 타일 · table 행 · list 줄 · chart 점)을 미리 만든다.
`ui("kv", {source: "facts#1"})` 이 이걸 집는다. 모델이 값을 옮겨 적지 않는다(§12-1-1 두 길).
"""
from __future__ import annotations

from typing import Any, Callable

PY = 3.305785


# ── 값 꼴 ───────────────────────────────────────────────────────────
def py(m2: float | None) -> float | None:
    return None if m2 is None else round(m2 / PY, 1)


def area(m2: float | None) -> str | None:
    return None if m2 is None else f"{py(m2)}평 ({m2:g}㎡)"


def pct(v: float | None) -> str | None:
    return None if v is None else f"{v:g}%"


def won_m2(v: float | None) -> str | None:
    return None if v is None else f"{round(v / 10000):,}만원/㎡"


def won(v: float | None) -> str | None:
    """보증금·거래금액처럼 만과 억을 오가는 돈. 1억 밑은 만, 위는 「2억 3,514만」.

    `eok` 로 찍으면 2,399만이 「0.2억」이 된다(2026-09-09). 월세·관리비는 늘 만이라 이걸 안 쓴다.
    """
    if not v:
        return None
    if v < 1e8:
        return f"{round(v / 1e4):,}만"
    e, m = divmod(round(v), 10 ** 8)
    man = round(m / 1e4)
    return f"{e}억" + (f" {man:,}만" if man else "")


def eok(v: float | None) -> str | None:
    if v is None:
        return None
    e = v / 1e8
    return f"{e:.1f}억" if e < 100 else f"{e:,.0f}억"


def ymd(d: str | None, prec: str | None = None) -> str | None:
    """아는 만큼만 쓴다(0165). 정밀도가 「연」이면 「1959년」이지 「1959.01.01」이 아니다."""
    if not d:
        return None
    y, m, dd = d[:4], d[5:7], d[8:10]
    if prec == "연" or not m:
        return f"{y}년"
    if prec == "월" or not dd:
        return f"{y}년 {int(m)}월"
    return f"{y}.{m}.{dd}"


def short_addr(a: str | None) -> str:
    return (a or "").replace("서울특별시 ", "").replace("번지", "").strip()


def _drop_none(d: dict) -> dict:
    return {k: v for k, v in d.items() if v not in (None, "", [], {})}


# ── 길별 굽기 ───────────────────────────────────────────────────────
# 반환: {"kind", "grade", "source", "note", "data", "grids", "show"}
#   data   모델이 읽는 요약
#   grids  부품이 먹는 꼴 {kv|stats|table|list|chart: …}
#   show   모델에게 「이렇게 보여라」 한 줄

def building(d: dict) -> dict:
    stn = None
    subs = d.get("subway_json") or []
    if isinstance(subs, list) and subs and isinstance(subs[0], dict):
        s0 = subs[0]
        stn = f"{s0.get('역명') or s0.get('name') or ''} {s0.get('거리') or d.get('station_dist') or ''}m".strip()
    elif d.get("station_dist") is not None:
        stn = f"{d['station_dist']}m"
    floors = None
    if d.get("floors_above") is not None:
        floors = f"지상 {d['floors_above']}층" + (f" 지하 {d['floors_below']}층" if d.get("floors_below") else "")
    elev = None
    if d.get("elevator") is not None:
        elev = f"{d['elevator']}대"
        if d.get("elevator_ext") not in (None, d.get("elevator")):
            elev += f" (승강기공단 {d['elevator_ext']}대)"
    facts = _drop_none({
        "주소": short_addr(d.get("addr")),
        "도로명": d.get("road_addr"),
        "용도": d.get("main_use_name") or d.get("etc_use"),
        "용도지역": d.get("use_zone"),
        "규모": floors,
        "구조": d.get("structure"),
        "연면적": area(d.get("total_area")),
        "대지": area(d.get("land_area") or d.get("parcel_area")),
        "건축면적": area(d.get("build_area")),
        "건폐율": pct(d.get("bcr")),
        "용적률": pct(d.get("far")),
        "준공": ymd(d.get("approval_ymd"), d.get("approval_ymd_prec")),
        "대수선": ymd(d.get("remodel_ymd"), d.get("remodel_ymd_prec")),
        "높이": f"{d['height']}m" if d.get("height") is not None else None,
        "승강기": elev,
        "주차": f"{d['parking']}대" if d.get("parking") is not None else None,
        "역": stn,
        "공시지가": won_m2(d.get("gongsi_latest")),
        "최근 실거래": (f"{eok(d.get('last_sale_price'))} ({d.get('last_sale_ym')})"
                    if d.get("last_sale_price") else None),
        "지목": d.get("jimok"), "도로접면": d.get("road_frontage"),
    })
    stats = [x for x in [
        {"label": "연면적", "value": py(d.get("total_area")), "unit": "평",
         "note": f"{d['total_area']:g}㎡" if d.get("total_area") else None},
        {"label": "지상", "value": d.get("floors_above"), "unit": "층"},
        {"label": "건폐율", "value": d.get("bcr"), "unit": "%"},
        {"label": "용적률", "value": d.get("far"), "unit": "%"},
        {"label": "역", "value": d.get("station_dist"), "unit": "m"},
        {"label": "공시지가", "value": round(d["gongsi_latest"] / 10000) if d.get("gongsi_latest") else None,
         "unit": "만원/㎡"},
    ] if x.get("value") is not None]
    return {"kind": "facts", "grade": "사실", "source": "건축물대장 · 토지이용계획",
            "note": None, "data": facts,
            "grids": {"kv": [[k, v] for k, v in facts.items()], "stats": stats},
            "show": 'ui("kv", {"source": ID}) 또는 ui("stats", {"source": ID})'}


def parcels(d: dict) -> dict:
    ps = d.get("parcels") or []
    rows, series = [], None
    for p in ps:
        lb, lf = p.get("legal_bcr"), p.get("legal_far")
        rows.append(_drop_none({
            "필지": p.get("label"), "역할": p.get("role"),
            "면적": area(p.get("area")), "지목": p.get("jimok"),
            "용도지역": p.get("use_zone"), "이용상황": p.get("land_use"),
            "법정 건폐": f"{lb[0]}%" if lb else None, "법정 용적": f"{lf[0]}%" if lf else None,
            "도로접면": p.get("road_frontage"), "형상": p.get("shape"), "지세": p.get("slope"),
            "공시지가": won_m2(p.get("gongsi_latest")),
        }))
        if series is None and p.get("gongsi_series"):
            series = [(int(y), round(v / 10000)) for y, v in p["gongsi_series"] if v]
    data: dict[str, Any] = {"필지": rows, "필지 수": d.get("count")}
    road = d.get("road") or {}
    if road:
        data["도로"] = _drop_none({"전면": f"{road.get('front_m')}m" if road.get("front_m") else None,
                                 "측면": f"{road.get('side_m')}m" if road.get("side_m") else None,
                                 "노선": road.get("front_rn")})
    grids: dict[str, Any] = {"table": {"head": list(rows[0].keys()) if rows else [],
                                       "rows": [list(r.values()) for r in rows]}}
    if series:
        first, last = series[0], series[-1]
        data["공시지가 추이"] = f"{first[0]} {first[1]:,} → {last[0]} {last[1]:,}만원/㎡ ({last[1] / first[1]:.1f}배)"
        grids["chart"] = {"kind": "line", "unit": "만원/㎡", "x": [y for y, _ in series],
                          "series": [{"name": "공시지가", "data": [v for _, v in series]}]}
    return {"kind": "parcels", "grade": "사실", "source": "지적도 · 토지이용계획 · 개별공시지가",
            "note": "법정 건폐·용적은 토지이음 산식", "data": data, "grids": grids,
            "show": 'ui("table", {"source": ID}) · 추이는 ui("chart", {"source": ID})'}


def _event_rows(items: list, limit: int) -> list[dict]:
    out = []
    for e in items[:limit]:
        when = e.get("on_date") or (f"{e['on_year']}년" if e.get("on_year") else None)
        out.append(_drop_none({"갈래": e.get("kind"), "제목": e.get("name"), "일자": when,
                               "거리": f"{e['distance_m']}m" if e.get("distance_m") is not None else None,
                               "출처": e.get("source")}))
    return out


def events(d: dict) -> dict:
    items = d.get("items") or []
    kinds = d.get("kinds") or {}
    rows = _event_rows(items, 8)
    data = {"반경": f"{d.get('radius')}m" if d.get("radius") else None,
            "건수": sum(kinds.values()) if kinds else len(items),
            "갈래": kinds, "최근": rows}
    return {"kind": "events", "grade": "사실", "source": "서울시 고시·공고 · 인허가 · 보도자료 · 나라장터",
            "note": None, "data": _drop_none(data),
            "grids": {"list": [{"tag": r.get("갈래"), "title": r.get("제목"),
                                "sub": " · ".join(x for x in (r.get("거리"), r.get("일자")) if x)}
                               for r in _event_rows(items, 20)]},
            "show": 'ui("list", {"source": ID})'}


def news(d: dict) -> dict:
    items = d.get("items") or []
    rows = _event_rows(items, 8)
    return {"kind": "news", "grade": "사실", "source": "서울시 고시·공고 · 인허가 · 보도자료",
            "note": None, "data": {"건수": d.get("total") or len(items), "최근": rows},
            "grids": {"list": [{"tag": r.get("갈래"), "title": r.get("제목"), "sub": r.get("일자")}
                               for r in _event_rows(items, 20)]},
            "show": 'ui("list", {"source": ID})'}


def sales(d: dict) -> dict:
    rows = []
    for s in (d.get("sales") or [])[:8]:
        if s.get("is_outlier"):
            continue
        rows.append(_drop_none({"주소": short_addr(s.get("addr")), "면적": area(s.get("total_area")),
                                "거래가": eok(s.get("price")), "㎡당": won_m2(s.get("per_area")),
                                "시점": s.get("contract_ym"),
                                "거리": f"{round(s['dist_m'])}m" if s.get("dist_m") is not None else None}))
    data = _drop_none({"반경": f"{d.get('radius_m')}m", "기간": f"최근 {d.get('years')}년",
                       "건수": d.get("total"), "제외(이상치)": d.get("excluded"),
                       "중앙 ㎡당": won_m2(d.get("median_per_area")), "중앙 거래가": eok(d.get("median_price")),
                       "최근": rows})
    head = ["주소", "면적", "거래가", "㎡당", "시점"]
    table_rows = [[r.get(h) for h in head] for r in rows]
    bar = {"kind": "bar", "unit": "만원/㎡",
           "x": [r.get("주소") for r in rows],
           "series": [{"name": "㎡당", "data": [round(s["per_area"] / 10000) for s in (d.get("sales") or [])[:8]
                                                if not s.get("is_outlier") and s.get("per_area")]}]}
    if d.get("median_per_area"):
        bar["mark"] = {"중앙": round(d["median_per_area"] / 10000)}
    return {"kind": "sales", "grade": "사실", "source": "국토교통부 실거래",
            "note": None, "data": data,
            "grids": {"table": {"head": head, "rows": table_rows}, "chart": bar},
            "show": 'ui("table", {"source": ID}) · 견주려면 ui("chart", {"source": ID})'}


def pop(d: dict) -> dict:
    data = _drop_none({"낮": f"{round(d['day']):,}명" if d.get("day") else None,
                       "밤": f"{round(d['night']):,}명" if d.get("night") else None,
                       "피크": f"{d.get('peak_hour')}시 {round(d['peak']):,}명" if d.get("peak") else None,
                       "격자": "250m", "기간": f"{d.get('days')}일 평균" if d.get("days") else None})
    stats = [x for x in [{"label": "낮", "value": round(d["day"]) if d.get("day") else None, "unit": "명"},
                         {"label": "밤", "value": round(d["night"]) if d.get("night") else None, "unit": "명"},
                         {"label": "피크", "value": d.get("peak_hour"), "unit": "시",
                          "note": f"{round(d['peak']):,}명" if d.get("peak") else None}] if x["value"] is not None]
    return {"kind": "pop", "grade": "참조", "source": "서울시 생활인구(KT 통신량 추정)",
            "note": "실제 유동은 현장에서 확인", "data": data,
            "grids": {"stats": stats}, "show": 'ui("stats", {"source": ID})'}


def tenants(d: dict) -> dict:
    items = d.get("items") or []
    rows = [_drop_none({"이름": t.get("name"), "층": t.get("floor"), "업종": t.get("biz")}) for t in items[:12]]
    known = sum(1 for t in items if t.get("floor"))
    return {"kind": "tenants", "grade": "참조", "source": "인허가 · 상가정보 원장",
            "note": "층은 원장에 있는 것만(68~80%). 폐업 반영이 늦을 수 있다",
            "data": {"업체": len(items), "층 아는 것": known, "목록": rows},
            "grids": {"list": [{"tag": r.get("층") or "층 모름", "title": r.get("이름"), "sub": r.get("업종")}
                               for r in rows]},
            "show": 'ui("list", {"source": ID})'}


def floor_rents(d: dict) -> dict:
    """층별임대정보 — 건물 상세 화면과 같은 목록. app/ai/floors.py 가 겹쳐 둔 것을 굽는다.

    **금액은 팀이 적은 것만이다.** 대장에는 금액이 없고, 우리 임대추정은 여기 안 섞인다 —
    추정은 사용자가 물을 때 `estimate` 가 이름과 오차를 붙여 따로 낸다(§16).
    """
    rows = d.get("rows") or []
    out = []
    for r in rows[:24]:
        out.append(_drop_none({
            "층": r.get("층"), "호": r.get("호"), "상호": r.get("상호"), "업종": r.get("업종"),
            "면적": area(r.get("면적")),
            "보증금": won(r.get("보증금")),
            "월세": f"{round(r['월세'] / 10000):,}만" if r.get("월세") else None,
            "관리비": f"{round(r['관리비'] / 10000):,}만" if r.get("관리비") else None,
            "공실": "공실" if r.get("공실") else None,
            "적은이": r.get("적은이")}))
    tot = d.get("total") or {}
    unknown = d.get("층 모르는 업체") or []
    data = _drop_none({
        "줄": len(rows), "팀이 적은 줄": d.get("팀 입력"),
        "목록": out,
        "층 총면적": {k: area(v) for k, v in (d.get("층면적") or {}).items()} or None,
        "층 모르는 업체": f"{len(unknown)}곳 · {', '.join(unknown[:5])}" if unknown else None,
        "월세 합": f"{round(tot['rent'] / 10000):,}만" if tot.get("rent") else None,
        # 팀이 아무 줄도 안 적었으면 공실 0 은 「공실 없음」이 아니라 「모른다」다.
        # 그대로 주니 모델이 「공실은 없는 것으로 나옵니다」라고 답했다(2026-09-09)
        "공실": tot.get("vacant_count") if d.get("팀 입력") else None})
    head = ["층", "호", "상호", "업종", "면적", "보증금", "월세", "공실"]
    used = [h for h in head if any(r.get(h) for r in out)]
    return {"kind": "floors", "grade": "사실",
            "source": "층별임대정보 · 팀 입력 + 업체 원장(인허가·상가정보)",
            "note": "금액은 팀이 적은 것만. 비어 있으면 아직 안 적은 층",
            "data": data,
            "grids": {"table": {"head": used, "rows": [[r.get(h) for h in used] for r in out]}},
            "show": 'ui("table", {"source": ID})'}

def listings(d: Any) -> dict:
    rows = [_drop_none({"주소": short_addr(x.get("addr"))}) for x in (d if isinstance(d, list) else [])[:30]]
    return {"kind": "listings", "grade": "사실", "source": "우리 팀 매물",
            "note": None, "data": {"건수": len(rows), "목록": rows},
            "grids": {"list": [{"title": r.get("주소")} for r in rows]},
            "show": 'ui("list", {"source": ID})'}


def search(d: dict, body: dict | None) -> dict:
    def col(name: str) -> dict:
        c = d.get(name) or {}
        return c if isinstance(c, dict) else {}
    mine, normal = col("mine"), col("normal")
    rows = []
    for r in (mine.get("items") or []) + (normal.get("items") or []):
        if len(rows) >= 8:
            break
        rows.append(_drop_none({"주소": short_addr(r.get("addr")), "연면적": area(r.get("total_area")),
                                "층": r.get("floors_above"), "용도지역": r.get("use_zone"),
                                "최근 실거래": eok(r.get("last_sale_price")) if r.get("last_sale_price") else None}))
    data = _drop_none({"우리 팀": mine.get("total"), "전체": normal.get("total"), "앞": rows})
    return {"kind": "search", "grade": "사실", "source": "건축물대장 · 실거래",
            "note": "화면 검색과 같은 결과", "data": data, "grids": {},
            "show": "검색 결과 부품은 자동으로 떴다. 글로 목록을 되풀이하지 않는다"}


# (method, path 템플릿) → 굽는 함수. 없으면 걷어내고 자른 원문이 그대로 간다
SHAPERS: dict[tuple[str, str], Callable[..., dict]] = {
    ("GET", "/buildings/{building_pk}"): lambda d, body: building(d),
    ("GET", "/buildings/{building_pk}/parcels"): lambda d, body: parcels(d),
    ("GET", "/buildings/{building_pk}/events"): lambda d, body: events(d),
    ("GET", "/news"): lambda d, body: news(d),
    ("GET", "/market/nearby-sales/{building_pk}"): lambda d, body: sales(d),
    ("GET", "/buildings/{building_pk}/pop"): lambda d, body: pop(d),
    ("GET", "/buildings/parcels/{pnu}/pop"): lambda d, body: pop(d),
    ("GET", "/buildings/{building_pk}/tenants"): lambda d, body: tenants(d),
    ("GET", "/buildings/{building_pk}/floor-rents"): lambda d, body: floor_rents(d),
    ("GET", "/listings"): lambda d, body: listings(d),
    ("POST", "/search"): search,
}
