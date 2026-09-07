"""건물 상세: master + 팀 오버레이 병합. specs S02 · 01-상세설계 §3.1."""
import json
import re
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from ..core.db import pool
from ..core.deps import current_user, CurrentUser
from ..core.market import STORES
from ..jobs import value_score as vs

router = APIRouter(prefix="/buildings", tags=["buildings"])


@router.get("/{building_pk}")
async def get_building(building_pk: str, user: CurrentUser = Depends(current_user)):
    """화면값 = master + 팀 오버레이 COALESCE(app.building_view)."""
    merged = await pool().fetchval("SELECT app.building_view($1, $2)", building_pk, user.team_id)
    if merged is None:
        raise HTTPException(404, "건물을 찾을 수 없습니다")
    data = json.loads(merged) if isinstance(merged, str) else merged
    coords = await pool().fetchrow(
        "SELECT ST_X(geom) AS lng, ST_Y(geom) AS lat FROM master.buildings WHERE building_pk=$1",
        building_pk,
    )
    if coords:
        data["lng"], data["lat"] = coords["lng"], coords["lat"]
    data.pop("geom", None)   # WKB 불필요

    # 어느 칸이 팀 오버레이인지(2026-08-25) — building_view 가 마스터와 오버레이를 COALESCE 로
    # 합쳐 버려서 화면이 「대장 값」과 「팀이 고친 값」을 구분할 수 없었다.
    # 값 옆에 대장 원본을 곁말로 띄우고 ↺를 그 줄에만 다는 데 쓴다.
    ed = await pool().fetch(
        """SELECT field FROM app.overlays
            WHERE team_id=$1 AND target_type='building' AND target_id=$2""",
        user.team_id, building_pk)
    fields = [r["field"] for r in ed]
    data["_edited"] = fields
    if fields:
        # 그 칸들의 대장 원본 — 줄 곁말에 「대장 121.5평」으로 띄운다.
        raw = await pool().fetchval(
            "SELECT to_jsonb(b) FROM master.buildings b WHERE b.building_pk=$1", building_pk)
        m = json.loads(raw) if isinstance(raw, str) else (raw or {})
        data["_master"] = {f: m.get(f) for f in fields if f in m}

    # 필지 경계(보고서 지도용) — 대표+부속 필지 합집합 GeoJSON
    pgeom = await pool().fetchval(
        """SELECT ST_AsGeoJSON(ST_Union(p.geom)) FROM master.building_parcels bp
           JOIN master.parcels p ON p.pnu = bp.pnu WHERE bp.building_pk = $1""",
        building_pk)
    data["parcel_geom"] = json.loads(pgeom) if pgeom else None

    # 참조값(2026-09-04) — **본값이 아니다.** 화면은 대장 값을 세우고 이것을 옆에 작게 띄운다.
    # 대장이 비었을 때 중개인이 가늠할 거리를 남기되, 확인설명서·계약서로 나가는 자리에는 안 선다.
    calc = await pool().fetchrow(
        """SELECT bcr_calc, far_calc, bcr_src AS bcr_calc_src, far_src AS far_calc_src
           FROM master.building_calc WHERE building_pk=$1""", building_pk)
    data["_ref"] = {
        "elevator_ext": data.get("elevator_ext"),
        "bcr_calc": float(calc["bcr_calc"]) if calc and calc["bcr_calc"] is not None else None,
        "far_calc": float(calc["far_calc"]) if calc and calc["far_calc"] is not None else None,
        "bcr_calc_src": calc["bcr_calc_src"] if calc else None,
        "far_calc_src": calc["far_calc_src"] if calc else None,
    }

    # 유동인구 — 실측(서울 생활인구 250m 주간 평균). 오버레이 > 실측 > 접근성 대용(2026-08-26).
    # 격자는 건물 좌표를 나눗셈으로 접은 것이라 조회가 인덱스 한 번이다.
    pop = await pool().fetchrow(
        "SELECT day_avg, night_avg, peak, peak_hour FROM master.building_pop WHERE building_pk=$1", building_pk)
    if pop and pop["day_avg"] is not None:
        data["pop_day"] = float(pop["day_avg"])
        data["pop_night"] = float(pop["night_avg"]) if pop["night_avg"] is not None else None
        data["pop_peak"] = float(pop["peak"]) if pop["peak"] is not None else None
        data["pop_peak_hour"] = pop["peak_hour"]
    data["float_pop"] = vs.float_pop_label(data)

    # 조회 로그(0048) — F-23 행동 학습의 재료. 실패해도 조회를 막지 않는다.
    try:
        await pool().execute(
            """INSERT INTO app.view_log(account_id, team_id, building_pk)
               VALUES($1,$2,$3)
               ON CONFLICT (account_id, building_pk, viewed_on) DO UPDATE SET n = app.view_log.n + 1""",
            user.account_id, user.team_id, building_pk)
    except Exception:
        pass

    # 실측 도로폭(배치 master.building_road) — 대장 '도로접면'은 광대/중로 같은 분류라 미터 값이 없다.
    # 지금까지 브리핑만 이 표를 읽고 S02 상세는 안 읽어서 화면이 비어 있었다(2026-08-11).
    # setdefault — 팀이 손으로 고친 오버레이가 이미 병합돼 있으면 그 값을 덮지 않는다.
    rw = await pool().fetchrow(
        "SELECT front_m, side_m, rear_m, front_rn FROM master.building_road WHERE building_pk=$1",
        building_pk)
    if rw:
        for k, v in (("road_front_m", rw["front_m"]), ("road_side_m", rw["side_m"]),
                     ("road_rear_m", rw["rear_m"]), ("road_front_rn", rw["front_rn"])):
            if v is not None and data.get(k) in (None, ""):
                data[k] = float(v) if isinstance(v, Decimal) else v

    # 추정가 추정(F-17 v2 배치) — 매매가 미입력 시 기본값. specs R.
    se = await pool().fetchval(
        "SELECT sale_est FROM master.building_sale_est WHERE building_pk=$1", building_pk)
    data["sale_est"] = int(se) if se is not None else None

    # 활용유형(F-20)·매도가능성 — 배치(master.building_score, 0038). 매력도(F-16)는 2026-09-06 에 없앴다(0161).
    # 예전엔 리포트를 만들어야만(30크레딧) 존재하던 값이라 상세·영업 어디서도 못 썼다.
    sc = await pool().fetchrow(
        """SELECT use_type, util_ratio, sell_score, sell_axes
           FROM master.building_score WHERE building_pk=$1""", building_pk)
    if sc:
        d = dict(sc)
        if isinstance(d.get("sell_axes"), str):     # asyncpg는 jsonb를 문자열로 준다
            d["sell_axes"] = json.loads(d["sell_axes"])
        data.update({k: (float(v) if isinstance(v, Decimal) else v) for k, v in d.items()})

    # 마스터 예상수익률 — 검색(classified)과 동일 체인: rent(팀 total_rent×12 ?? 마스터 rent_est) ÷ 매매가(팀 sale_price ?? 추정가).
    re = await pool().fetchval(
        "SELECT annual_rent FROM master.building_rent_est WHERE building_pk=$1", building_pk)

    def _f(x):
        try:
            return float(x)
        except (TypeError, ValueError):
            return None
    m_price = _f(data.get("sale_price")) or (float(se) if se is not None else None)
    _tr = _f(data.get("total_rent"))
    m_rent = (_tr * 12 if _tr else None) or (float(re) if re is not None else None)
    data["roi"] = round(m_rent / m_price * 100, 2) if (m_rent and m_price) else None
    # 추정 연임대(원) — 머리줄의 **순수 추정 수익률**이 쓴다(0134).
    # 추정가 ÷ 추정임대로 짝을 맞춘 값이라, 실측과 섞이지 않는다.
    data["est_annual_rent"] = float(re) if re is not None else None

    # 지역 지가 상승률(리포트 맥락) — 자치구별 누적 지가변동률(land_adjust)
    if data.get("bjd_code"):
        gu = str(data["bjd_code"])[:5]
        la = await pool().fetch("SELECT yr, adj FROM master.land_adjust WHERE gu=$1 ORDER BY yr", gu)
        if not la:
            la = await pool().fetch("SELECT yr, adj FROM master.land_adjust WHERE gu='11' ORDER BY yr")
        amap = {r["yr"]: float(r["adj"]) for r in la}
        data["region_land_5y"] = amap.get(2020)
        data["region_land_10y"] = amap.get(2016)

    # 시계열: 공시지가(대표 PNU 연도별) · 매각 이력 (S02 §3.7)
    if data.get("pnu"):
        g = await pool().fetch(
            "SELECT year, price FROM master.gongsi_series WHERE pnu=$1 ORDER BY year",
            data["pnu"],
        )
        data["gongsi_series"] = [[r["year"], r["price"]] for r in g]
    s = await pool().fetch(
        """SELECT contract_ym, price, total_area FROM master.sales_history
           WHERE building_pk=$1 ORDER BY contract_ym""",
        building_pk,
    )
    data["sales_history"] = [
        {"ym": r["contract_ym"], "price": r["price"], "total_area": float(r["total_area"]) if r["total_area"] else None}
        for r in s
    ]
    return data


_POP_R = 600      # 유동인구 지도 반경(m) — 250m 격자로 대여섯 칸. 300m면 두 칸이라 그림이 안 된다


@router.get("/{building_pk}/pop")
async def building_pop(building_pk: str, _: CurrentUser = Depends(current_user)):
    """유동인구 지도(분석 탭) — 250m 격자에 **색과 진하기를 같이** 준다.

    상권과 유동인구는 겹치는 정보가 아니라 다른 차원이다: 무슨 동네냐(색=지배 용도)와
    얼마나 붐비냐(진하기=주간 인구). 한 격자에 둘을 같이 주면 레이어 둘이 아니라 한 장이다.

    색은 **실제 업체**로 센다(2026-09-06, core/market.py). 업체 55만 점을 반경으로 자를 땐
    `geom && ST_Expand(...)` 상자를 먼저 건다 — geography 캐스트만으론 색인을 못 타 1.5초, 상자를 걸면 0.1초. 대장 층별 용도로 세던 때는
    절반이 「기타」라 칸이 비었다. 격자 칸(250m 상자)에 든 업체 점을 갈래별로 세고 1등이 색이다.
    """
    me = await pool().fetchrow(
        """SELECT b.geom, p.grid, p.day_avg, p.night_avg, p.peak, p.peak_hour, l.hourly, l.days
           FROM master.buildings b
           LEFT JOIN master.building_pop p ON p.building_pk = b.building_pk
           LEFT JOIN master.living_pop l ON l.grid = p.grid
           WHERE b.building_pk = $1""", building_pk)
    if me is None:
        raise HTTPException(404, "건물을 찾을 수 없습니다")

    cells = await pool().fetch(
        f"""WITH s AS (SELECT geom FROM master.buildings WHERE building_pk = $1),
             g AS (SELECT l.grid, l.day_avg,
                          ST_Transform(ST_Envelope(ST_Expand(ST_Transform(l.geom, 5179), 125)), 4326) AS cell
                     FROM master.living_pop l, s
                    WHERE ST_DWithin(l.geom::geography, s.geom::geography, $2)),
             c AS (SELECT g.grid, st.cat, count(*) AS n
                     FROM g JOIN ({STORES}) st ON ST_Contains(g.cell, st.geom)
                    GROUP BY 1, 2),
             dom AS (SELECT DISTINCT ON (grid) grid, cat, n FROM c ORDER BY grid, n DESC)
           SELECT g.grid, g.day_avg, dom.cat, dom.n, ST_AsGeoJSON(g.cell) AS geojson
             FROM g LEFT JOIN dom ON dom.grid = g.grid""",
        building_pk, _POP_R)

    mix = await pool().fetch(
        f"""WITH s AS (SELECT geom FROM master.buildings WHERE building_pk = $1)
           SELECT st.cat, count(*) AS n
             FROM ({STORES}) st, s
            WHERE st.geom && ST_Expand(s.geom, $2 / 80000.0)
              AND ST_DWithin(st.geom::geography, s.geom::geography, $2)
            GROUP BY 1""",
        building_pk, _POP_R)

    def _f(v):
        return float(v) if v is not None else None

    return {
        "grid": me["grid"],
        "day": _f(me["day_avg"]), "night": _f(me["night_avg"]),
        "peak": _f(me["peak"]), "peak_hour": me["peak_hour"],
        "hourly": [_f(v) for v in (me["hourly"] or [])],
        "days": me["days"],
        "cells": [{"grid": r["grid"], "geojson": json.loads(r["geojson"]),
                   "pop": _f(r["day_avg"]), "cat": r["cat"], "n": r["n"]} for r in cells],
        # 상권 구성 — 지도의 테두리 색이 「이 동네 성격」이라면 이건 그 비율이다.
        # 격자 지배 용도만 세면 칸마다 한 표라 큰 칸도 작은 칸도 같은 무게가 된다.
        "mix": {r["cat"]: r["n"] for r in mix if r["cat"] != "기타"},
    }


@router.get("/{building_pk}/scene")
async def building_scene(building_pk: str, _: CurrentUser = Depends(current_user)):
    """입체 지적도(분석 탭) 재료 — 접한 도로 구간 + 법정 건폐/용적.

    필지 폴리곤은 상세 응답(parcel_geom)에 이미 있어 여기서 다시 내지 않는다.
    브리핑이 리포트 스냅샷으로만 이 그림을 그려서, 리포트를 만들지 않은 건물은
    입체 지적도를 볼 수 없었다(2026-08-26).
    """
    roads = await pool().fetch(
        """SELECT r.rn, r.road_bt, ST_AsGeoJSON(r.geom) AS geojson
             FROM master.road_segment r
            WHERE ST_DWithin(r.geom::geography,
                  (SELECT geom::geography FROM master.buildings WHERE building_pk=$1), 40)
            ORDER BY r.road_bt DESC LIMIT 12""", building_pk)
    lim = await pool().fetchrow(
        # **숫자로 고른다.** 0153 전에는 text 에 max() 를 걸어 '50%' 가 '245%' 보다
        # 컸다(첫 글자 5>2). 여러 필지에 걸친 건물 5,494동 중 332동이 틀린 값을 받고 있었다.
        # 병기(길이>1)는 견줄 수 없으므로 뺀다 — 다른 필지 값이 있으면 그것을 쓴다.
        """SELECT
             (SELECT p.legal_bcr FROM master.building_parcels bp
                JOIN master.parcels p ON p.pnu = bp.pnu
               WHERE bp.building_pk = $1 AND array_length(p.legal_bcr, 1) = 1
               ORDER BY p.legal_bcr[1] DESC LIMIT 1) AS bcr,
             (SELECT p.legal_far FROM master.building_parcels bp
                JOIN master.parcels p ON p.pnu = bp.pnu
               WHERE bp.building_pk = $1 AND array_length(p.legal_far, 1) = 1
               ORDER BY p.legal_far[1] DESC LIMIT 1) AS far""", building_pk)
    return {
        "roads": [{"rn": r["rn"], "road_bt": float(r["road_bt"]) if r["road_bt"] is not None else None,
                   "geojson": json.loads(r["geojson"])} for r in roads],
        "legal_bcr": lim["bcr"] if lim else None,
        "legal_far": lim["far"] if lim else None,
    }


@router.get("/{building_pk}/floor-outline")
async def floor_outline(building_pk: str, _: CurrentUser = Depends(current_user)):
    """층별개요(대장) 프리필 — 층·용도·층별면적(바닥, 합=연면적) + 임대료/보증금 추정(공공 상권시세). 층별임대정보 시드용(S02 §3.5).
    rent_est/deposit_est = 마스터 추정값(유저가 입력하면 오버레이가 덮음)."""
    rows = await pool().fetch(
        """SELECT fo.floor, fo.use, fo.floor_area, fre.rent_est, fre.deposit_est
           FROM master.floor_outline fo
           LEFT JOIN master.floor_rent_est fre USING (building_pk, seq)
           WHERE fo.building_pk=$1 ORDER BY fo.seq""",
        building_pk)
    return [{"floor": r["floor"], "use": r["use"],
             "floor_area": float(r["floor_area"]) if r["floor_area"] is not None else None,
             "rent_est": r["rent_est"], "deposit_est": r["deposit_est"]}
            for r in rows]


# 규제 여섯 칸(reg_godo…reg_munhwa)은 **걷어냈다**(2026-09-07). 원문에서 이름이 맞는 것만
# 골라 담다가 건수로 93.4%가 빠졌고(토지거래허가구역·대공방어협조구역·상대보호구역이 화면에 안 떴다),
# 0136 에서 원문 전부를 담는 `parcels.regulations` 로 갈아탔다. 그런데 옛 칸을 안 지워서
# 빌드 단계가 빠진 2026-09-01 부터 0행인 채로 쿼리·화면에 남아 있었다.


@router.get("/{building_pk}/events")
async def area_events(building_pk: str, radius: int = 700, kind: str | None = None,
                      years: int | None = None, _: CurrentUser = Depends(current_user)):
    """주변 소식 — master.area_event 에서 이 건물 둘레의 사건을 날짜순으로.

    표에는 사건만 담고 **건물과의 관계는 여기서 낸다**(건물×사건을 미리 곱하면 천만 줄이 넘는다).
    화면과 에이전트가 같은 것을 읽는다 — 화면에 있는 값만 여기 있고, 여기 없는 값은 화면에도 없다.

    `on_date`(정확)와 `on_year`(연도만)를 **가른 채로 내보낸다.** 한 칸으로 합쳐 주면
    읽는 쪽이 「2025년」을 2025-01-01 로 읽는다 — 정비구역 839개 중 고시일자가 있는 것은 273개뿐이다.
    거리(`distance_m`)는 지도가 쓰라고 내보내되 **목록에 열로 세우지 않는다**(S02 주변 소식).

    **반경은 갈래마다 다르다.** 정비구역·지구단위계획은 구역째로 동네를 바꾸니 넓게 보고,
    옆 땅 신축은 가까워야 내 건물 값에 닿는다. 다 700m 로 잡았더니 삼성동 78 한 건물에
    120줄이 서고 목록 스크롤이 열 화면이 됐다(건축 인허가만 88줄). 250m 로 좁히면 5줄이다.
    """
    radius = max(100, min(radius, 3000))
    # 갈래별 반경 상한 — 요청 반경보다 좁은 쪽을 쓴다
    NEAR = {"건축 인허가": 250}
    args: list = [building_pk, radius]
    where = ""
    if kind:
        args.append(kind)
        where += f" AND e.kind = ${len(args)}"
    if years:
        args.append(years)
        where += (f" AND COALESCE(e.on_date, make_date(COALESCE(e.on_year,1900),1,1))"
                  f" >= (CURRENT_DATE - make_interval(years => ${len(args)}))")
    near = " ".join(f"WHEN '{k}' THEN {v}" for k, v in NEAR.items())
    rows = await pool().fetch(f"""
        WITH me AS (SELECT geom FROM master.buildings WHERE building_pk=$1)
        SELECT e.id, e.kind, e.name, e.on_date, e.on_year, e.gosi_no, e.body,
               e.source, e.source_url, p.tags,
               ST_Contains(e.geom, me.geom) AS inside,
               round(ST_Distance(e.geom::geography, me.geom::geography))::int AS distance_m,
               -- 지도 아이콘 자리. 면(정비구역)은 면 안의 점 — 무게중심은 초승달꼴에서 밖으로 나간다
               ST_X(ST_PointOnSurface(e.geom)) AS lng, ST_Y(ST_PointOnSurface(e.geom)) AS lat
          FROM master.area_event e
          LEFT JOIN master.press_event p ON e.src_table = 'press_event' AND p.id::text = e.src_key,
               me
         WHERE ST_DWithin(e.geom::geography, me.geom::geography,
                          LEAST($2, CASE e.kind {near} ELSE $2 END)){where}
         ORDER BY COALESCE(e.on_date, make_date(COALESCE(e.on_year,1900),1,1)) DESC, e.id""",
        *args)
    items = [{
        "id": r["id"], "kind": r["kind"], "name": r["name"],
        # 날짜 두 칸은 합치지 않는다. 없으면 null 이다 — 빈 문자열이 아니다
        "on_date": r["on_date"].isoformat() if r["on_date"] else None,
        "on_year": r["on_year"], "gosi_no": r["gosi_no"], "body": r["body"],
        "source": r["source"], "source_url": r["source_url"],
        "tags": list(r["tags"] or []),
        "relation": "구역 안" if r["inside"] else "반경 안",
        "distance_m": 0 if r["inside"] else r["distance_m"],
        "lng": r["lng"], "lat": r["lat"],
    } for r in rows]
    kinds: dict[str, int] = {}
    for x in items:
        kinds[x["kind"]] = kinds.get(x["kind"], 0) + 1
    return {"items": items, "kinds": kinds, "radius": radius}


@router.get("/{building_pk}/parcels")
async def get_parcels(building_pk: str, user: CurrentUser = Depends(current_user)):
    """필지 셀렉터(S02 §3.6): 대표+부속 필지별 속성·공시지가 시계열·규제 + 건물 요약(OR 집계)."""
    rows = await pool().fetch(
        """WITH dong AS (SELECT DISTINCT ON (bjd_code) bjd_code, dong FROM master.region_index)
           SELECT bp.role, p.pnu, p.area, p.jimok, p.land_use, p.slope, p.shape,
                  p.road_frontage, p.use_zone, p.legal_bcr, p.legal_far, p.gongsi_latest,
                  -- 국토부 토지이용계획정보 원본(0136) — 필지에 걸린 지역·지구등 전부.
                  -- 여섯 칸은 그중 이름이 맞는 것만 담아서 건수로 93.4%가 빠져 있었다:
                  -- 토지거래허가구역·대공방어협조구역·상대보호구역이 화면에 아예 안 떴다.
                  p.regulations,
                  -- 사람이 읽는 지번(2026-09-07 대표): PNU 는 화면에 못 세운다. vacant_parcels MV 와 같은 산식
                  d.dong || ' ' || CASE WHEN substr(p.pnu,11,1)='2' THEN '산' ELSE '' END
                    || ltrim(substr(p.pnu,12,4),'0')
                    || CASE WHEN substr(p.pnu,16,4)<>'0000' THEN '-'||ltrim(substr(p.pnu,16,4),'0') ELSE '' END
                    || '번지' AS label,
                  -- 이 필지만의 폴리곤 — 고르면 지도가 여기로 따라간다
                  ST_AsGeoJSON(p.geom) AS geom_json
           FROM master.building_parcels bp
           JOIN master.parcels p ON p.pnu = bp.pnu
           LEFT JOIN dong d ON d.bjd_code = left(p.pnu, 10)
           WHERE bp.building_pk = $1
           ORDER BY (bp.role='대표') DESC, p.pnu""",
        building_pk,
    )
    parcels = []
    for r in rows:
        d = dict(r)
        d["area"] = float(d["area"]) if d["area"] is not None else None
        gj = d.pop("geom_json", None)
        d["geom"] = json.loads(gj) if gj else None
        # 필지별 오버레이 병합(팀)
        ov = await pool().fetch(
            """SELECT field, value FROM app.overlays
               WHERE team_id=$1 AND target_type='parcel' AND target_id=$2""",
            user.team_id, r["pnu"],
        )
        for o in ov:
            d[o["field"]] = o["value"]
        # 공시지가 시계열
        g = await pool().fetch(
            "SELECT year, price FROM master.gongsi_series WHERE pnu=$1 ORDER BY year", r["pnu"]
        )
        d["gongsi_series"] = [[x["year"], x["price"]] for x in g]
        # 원본 목록 — [이름, 저촉여부, 코드]. 적재 때 토지이음 순서로 정렬해 뒀다
        # (국토계획법 UQ* 가 먼저, 그 안에서 포함·저촉·접함 차례).
        raw = d.pop("regulations", None)
        if isinstance(raw, str):
            raw = json.loads(raw)
        d["reg_all"] = raw or []
        parcels.append(d)
    # 실측 도로폭은 **건물** 단위 배치값(master.building_road)이라 필지 행에는 없다.
    # 필지 오버레이로 손수 고친 값이 없을 때 화면이 이걸 기본값으로 쓴다(2026-08-11).
    rw = await pool().fetchrow(
        "SELECT front_m, side_m, rear_m, front_rn FROM master.building_road WHERE building_pk=$1",
        building_pk)
    road = {k: (float(v) if isinstance(v, Decimal) else v)
            for k, v in (dict(rw).items() if rw else [])}
    return {"parcels": parcels, "count": len(parcels), "road": road}


# ── 나대지(건물이 없는 「대」 필지) ─────────────────────────────────────
#
# 건물 상세는 건물을 전제로 짜여 있다 — 연면적·층수·용도·임대·실거래.
# 나대지엔 그중 절반이 없어서, 같은 화면에 태우면 빈칸 목록이 된다.
# 그래서 대상도(building_pk 가 아니라 pnu) 화면도 따로 둔다(2026-08-27).
#
# 여기서 답하는 물음은 하나다 — **여기 뭘 얼마나 지을 수 있나.**
# 그 답은 이미 있는 값의 곱셈이다: 대지면적 × 법정 용적률·건폐율.
# 추정이 아니라 계산이므로 「추정」 배지를 달지 않는다.

_PCT = re.compile(r"[\d.]+")


def _pct(v) -> float | None:
    """법정 건폐/용적 목록 → 계산에 쓸 숫자. 값이 하나일 때만 준다(0153).

    [60] → 60.0 · [50, 60] → None · None → None

    **값이 둘이면 비운다.** 걸친 필지 중 작은 쪽이 330㎡(상업 660㎡)를 넘으면 법이
    가중평균을 금해 각각 적는다(서울 6,529필지). 하나를 고르면 작은 쪽을 법정치인 양
    쓰게 되고, 그 값이 확인설명서로 나간다.
    """
    if not v:
        return None
    return float(v[0]) if len(v) == 1 else None


@router.get("/{building_pk}/rent-series")
async def rent_series(building_pk: str, _: CurrentUser = Depends(current_user)):
    """임대 시세 추이 — 이 건물의 지난 임대료를 역산한다(2026-08-28).

    우리가 가진 건 **지금** 추정 임대료 하나뿐이다. 과거 값은 한국부동산원 임대동향
    통계표(master.sanggwon_rent_series, 2013Q1~)의 상권·계열 요율이 그 사이 얼마나
    움직였는지로 되돌린다:  그 해 임대료 = 지금 임대료 × (그 해 요율 ÷ 지금 요율).

    층별로 따로 역산하지 않는다 — 5년 지수를 층별로 재 보면 1.046~1.103 으로 거의 같아
    (지하1층 1.046 · 1층 1.095 · 11층이상 1.080), 상권·계열 하나로 묶어도 결과가 같다.
    건물의 층 구성은 어차피 지금 값 안에 이미 들어 있다.
    """
    cur = await pool().fetchrow(
        """SELECT monthly_rent, deposit_est, sanggwon, series
             FROM master.building_rent_est WHERE building_pk=$1""", building_pk)
    if not cur or not cur["monthly_rent"] or not cur["sanggwon"]:
        return {"series": [], "up5": None, "up10": None}

    # 연 단위 평균 요율 — 분기 진동을 지우고 「해마다 얼마였나」로 본다.
    rows = await pool().fetch(
        """SELECT y, avg(rate) AS rate FROM master.sanggwon_rent_series
            WHERE sanggwon=$1 AND series=$2 AND rate>0 GROUP BY y ORDER BY y""",
        cur["sanggwon"], cur["series"])
    if len(rows) < 2:
        return {"series": [], "up5": None, "up10": None}

    base = float(rows[-1]["rate"])                       # 가장 최근 해 = 지금 값의 기준
    now = int(cur["monthly_rent"])
    series = [[int(r["y"]), round(now * float(r["rate"]) / base)] for r in rows if r["rate"]]
    by_year = {y: v for y, v in series}
    last_y = series[-1][0]

    def up(n: int):
        """n년 상승률(%) — 그 해 값이 없으면 계산하지 않는다(가까운 해로 대신 세지 않는다)."""
        a, b = by_year.get(last_y - n), by_year.get(last_y)
        return round((b - a) / a * 100, 1) if (a and b) else None

    return {"series": series, "up5": up(5), "up10": up(10),
            "sanggwon": cur["sanggwon"], "series_name": cur["series"]}


@router.get("/parcels/{pnu}")
async def get_vacant_parcel(pnu: str, user: CurrentUser = Depends(current_user)):
    """나대지 상세 — 필지 하나. 건물이 없으므로 building_pk 가 아니라 pnu 로 가리킨다."""
    r = await pool().fetchrow(
        """SELECT v.pnu, v.addr, v.bjd_code, v.sgg_code, v.area, v.jimok, v.land_use, v.use_zone,
                  v.slope, v.shape, v.road_frontage, v.legal_bcr, v.legal_far, v.gongsi_latest,
                  -- 규제 원본은 MV(vacant_parcels)에 없다 — 필지 표에서 바로 가져온다(0136).
                  -- MV 를 다시 굽는 것보다 조인 한 번이 싸고, 건물 상세와 같은 값을 준다.
                  p.regulations,
                  ST_X(ST_Centroid(v.geom)) AS lng, ST_Y(ST_Centroid(v.geom)) AS lat
             FROM master.vacant_parcels v
             LEFT JOIN master.parcels p ON p.pnu = v.pnu
            WHERE v.pnu = $1""",
        pnu,
    )
    if not r:
        raise HTTPException(404, "그런 필지가 없습니다")
    d = dict(r)
    d["area"] = float(d["area"]) if d["area"] is not None else None
    raw = d.pop("regulations", None)
    if isinstance(raw, str):
        raw = json.loads(raw)
    d["reg_all"] = raw or []

    # 팀 오버레이 — 필지도 건물과 같이 팀이 고쳐 쓸 수 있다
    for o in await pool().fetch(
            """SELECT field, value FROM app.overlays
                WHERE team_id=$1 AND target_type='parcel' AND target_id=$2""",
            user.team_id, pnu):
        d[o["field"]] = o["value"]

    # 지을 수 있는 것 — 계산이다. 대지 × 법정 비율.
    area, bcr, far = d["area"], _pct(d.get("legal_bcr")), _pct(d.get("legal_far"))
    d["buildable"] = {
        "total_area": round(area * far / 100, 1) if area and far else None,   # 연면적
        "build_area": round(area * bcr / 100, 1) if area and bcr else None,   # 건축면적
        # 층수 = 용적률 ÷ 건폐율. 한 층을 건폐율만큼 채운다고 볼 때의 최대다.
        # 사선제한·주차·조경은 못 보므로 「이보다 낮을 수 있다」가 맞다.
        "floors": int(far // bcr) if bcr and far and bcr > 0 else None,
    }
    # 공시지가 총액 — 추정이 아니라 국가가 매긴 값이다. 땅값의 바닥.
    d["gongsi_total"] = int(d["gongsi_latest"] * area) if d.get("gongsi_latest") and area else None

    # 공시지가 시계열 — 건물 상세와 같은 그래프를 그린다. 땅값 흐름은 건물 유무와 무관하다.
    g = await pool().fetch(
        "SELECT year, price FROM master.gongsi_series WHERE pnu=$1 ORDER BY year", pnu)
    d["gongsi_series"] = [[r["year"], r["price"]] for r in g]

    # 필지 폴리곤 — 입체 지적도가 대지 모양을 그리는 재료
    geo = await pool().fetchval(
        "SELECT ST_AsGeoJSON(geom) FROM master.vacant_parcels WHERE pnu=$1", pnu)
    d["parcel_geom"] = json.loads(geo) if geo else None

    # 지하철 — 건물은 빌드 때 계산한 subway_json 을 갖고 있지만 필지엔 없다. 여기서 잰다.
    # 화면(LocationPanel)이 읽는 모양을 그대로 맞춘다: 거리순 · 호선별 최단만 골라 쓴다.
    st_rows = await pool().fetch(
        """SELECT s.name, s.route,
                  round(ST_Distance(ST_MakePoint(s.lng, s.lat)::geography,
                                    ST_Centroid(p.geom)::geography))::int AS dist
             FROM master.subway_stations s, master.vacant_parcels p
            WHERE p.pnu = $1
              AND ST_DWithin(ST_MakePoint(s.lng, s.lat)::geography,
                             ST_Centroid(p.geom)::geography, 2000)
            ORDER BY dist LIMIT 20""", pnu)
    d["subway_json"] = [{"역명": r["name"], "호선": r["route"], "거리": r["dist"],
                         "도보": max(1, round(r["dist"] / 80))} for r in st_rows]
    d["station_dist"] = st_rows[0]["dist"] if st_rows else None
    # 버스는 정류소 원천을 아직 안 실었다 — 없는 것은 비워 둔다(빈 배열을 지어내지 않는다)
    return d


@router.get("/parcels/{pnu}/scene")
async def vacant_scene(pnu: str, _: CurrentUser = Depends(current_user)):
    """나대지 입체 지적도 재료 — 접한 도로 + 법정 건폐/용적.

    건물용(`/{building_pk}/scene`)은 buildings.geom 을 기준으로 도로를 찾는데,
    나대지엔 건물이 없다. 필지 폴리곤에서 잰다 — 땅에 접한 도로는 그 땅의 성질이다.
    """
    roads = await pool().fetch(
        """SELECT r.rn, r.road_bt, ST_AsGeoJSON(r.geom) AS geojson
             FROM master.road_segment r
            WHERE ST_DWithin(r.geom::geography,
                  (SELECT geom::geography FROM master.vacant_parcels WHERE pnu=$1), 40)
            ORDER BY r.road_bt DESC LIMIT 12""", pnu)
    lim = await pool().fetchrow(
        "SELECT legal_bcr AS bcr, legal_far AS far FROM master.vacant_parcels WHERE pnu=$1", pnu)
    return {
        "roads": [{"rn": r["rn"], "road_bt": float(r["road_bt"]) if r["road_bt"] is not None else None,
                   "geojson": json.loads(r["geojson"])} for r in roads],
        "legal_bcr": lim["bcr"] if lim else None,
        "legal_far": lim["far"] if lim else None,
    }


@router.get("/parcels/{pnu}/pop")
async def vacant_pop(pnu: str, _: CurrentUser = Depends(current_user)):
    """나대지 유동인구 — 건물용과 **같은 그림**. 생활인구는 땅의 성질이지 건물의 것이 아니다.

    건물용은 building_pop(건물↔격자 매핑)에서 제 격자를 찾는데 나대지엔 그 행이 없다.
    필지 중심점이 어느 격자에 드는지로 잡는다. 주변 격자 집계는 건물용과 같은 쿼리다 —
    그 동네에 무엇이 서 있는지는 이 필지가 비어 있는 것과 무관하다.
    """
    # living_pop.geom 은 격자 **중심점**이라 ST_Contains 로는 안 잡힌다(면이 아니다).
    # 250m 격자니 중심점에서 가장 가까운 칸이 그 필지가 든 칸이다 — 200m 안에서만 찾는다.
    me = await pool().fetchrow(
        """SELECT l.grid, l.day_avg, l.night_avg, l.peak, l.peak_hour, l.hourly, l.days
             FROM master.vacant_parcels p
             LEFT JOIN LATERAL (
               SELECT * FROM master.living_pop x
                WHERE ST_DWithin(x.geom::geography, ST_Centroid(p.geom)::geography, 200)
                ORDER BY x.geom::geography <-> ST_Centroid(p.geom)::geography LIMIT 1) l ON TRUE
            WHERE p.pnu = $1""", pnu)
    if me is None:
        raise HTTPException(404, "그런 필지가 없습니다")
    if me["grid"] is None:
        return {"day": None}          # 격자 밖 — 없는 것은 없다고 한다

    cells = await pool().fetch(
        f"""WITH s AS (SELECT geom FROM master.vacant_parcels WHERE pnu = $1),
             g AS (SELECT l.grid, l.day_avg,
                          ST_Transform(ST_Envelope(ST_Expand(ST_Transform(l.geom, 5179), 125)), 4326) AS cell
                     FROM master.living_pop l, s
                    WHERE ST_DWithin(l.geom::geography, s.geom::geography, $2)),
             c AS (SELECT g.grid, st.cat, count(*) AS n
                     FROM g JOIN ({STORES}) st ON ST_Contains(g.cell, st.geom)
                    GROUP BY 1, 2),
             dom AS (SELECT DISTINCT ON (grid) grid, cat, n FROM c ORDER BY grid, n DESC)
           SELECT g.grid, g.day_avg, dom.cat, dom.n, ST_AsGeoJSON(g.cell) AS geojson
             FROM g LEFT JOIN dom ON dom.grid = g.grid""",
        pnu, _POP_R)

    mix = await pool().fetch(
        f"""WITH s AS (SELECT geom FROM master.vacant_parcels WHERE pnu = $1)
           SELECT st.cat, count(*) AS n
             FROM ({STORES}) st, s
            WHERE st.geom && ST_Expand(s.geom, $2 / 80000.0)
              AND ST_DWithin(st.geom::geography, s.geom::geography, $2)
            GROUP BY 1""",
        pnu, _POP_R)

    def _f(v):
        return float(v) if v is not None else None

    return {
        "grid": me["grid"],
        "day": _f(me["day_avg"]), "night": _f(me["night_avg"]),
        "peak": _f(me["peak"]), "peak_hour": me["peak_hour"],
        "hourly": [_f(v) for v in (me["hourly"] or [])],
        "days": me["days"],
        "cells": [{"grid": r["grid"], "geojson": json.loads(r["geojson"]),
                   "pop": _f(r["day_avg"]), "cat": r["cat"], "n": r["n"]} for r in cells],
        "mix": {r["cat"]: r["n"] for r in mix if r["cat"] != "기타"},
    }
