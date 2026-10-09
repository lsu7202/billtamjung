"""지번 페이지 — 열쇠는 지번(pnu) 하나(2026-10-08 · 스펙 12 §3-5).

지도에서 누르는 것은 필지다. 화면 · API 가 부르는 열쇠는 지번(pnu)과 매물(listing_id) 둘뿐이고, 건물 번호는
지번 안에서 동을 고를 때만 쓴다(동 카드 = GET /buildings/{pk}). 나대지는 동이 없는 지번일 뿐이다 — 같은 응답 ·
같은 화면이고, 갈림은 「동이 있나」 하나다.

이 지번의 자리(점)는 대표 동(연면적 큰 동) 좌표, 동이 없으면 필지 안의 점이다. 땅은 대표 동에 딸린 필지
(building_parcels)와 이 지번 필지를 합친다 — 추정가가 쓰는 땅과 같다(0250).
"""
import json
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException

from ..core.db import pool
from ..core.deps import CurrentUser, current_user, viewer
from .prices import is_broker, roi

router = APIRouter(prefix="/parcels", tags=["parcels"])

# 이 지번의 자리 · 대표 동 · 땅(딸린 필지). 동이 없으면 rep_pk 가 NULL 이고 땅은 이 필지 하나
_SPOT = """
  WITH me AS (
    SELECT p.pnu, pr.rep_pk, pr.n_bldg, pr.total_area, pr.floors_above, pr.floors_below,
           COALESCE(b.geom, ST_PointOnSurface(p.geom)) AS pt
      FROM master.parcels p
      LEFT JOIN master.parcel_rep pr ON pr.pnu = p.pnu
      LEFT JOIN master.buildings b ON b.building_pk = pr.rep_pk
     WHERE p.pnu = $1),
  land AS (   -- OR 로 묶으면 필지 표를 통째로 훑는다(4초) — 지번 목록을 먼저 만들고 색인으로 찾는다
    SELECT p.* FROM master.parcels p
     WHERE p.pnu IN (SELECT me.pnu FROM me
                     UNION SELECT bp.pnu FROM master.building_parcels bp JOIN me ON bp.building_pk = me.rep_pk))
"""


def _f(v):
    return float(v) if isinstance(v, Decimal) else v


def _pct(v) -> float | None:
    """법정 건폐/용적 목록 → 계산에 쓸 숫자. 값이 하나일 때만(0153). 병기([50, 60])면 비운다 —
    하나를 고르면 작은 쪽을 법정치인 양 쓰게 되고, 그 값이 확인설명서로 나간다."""
    if not v:
        return None
    return float(v[0]) if len(v) == 1 else None


async def _me(pnu: str):
    r = await pool().fetchrow(_SPOT + "SELECT me.*, ST_X(me.pt) AS lng, ST_Y(me.pt) AS lat FROM me", pnu)
    if r is None:
        raise HTTPException(404, "그런 지번이 없습니다")
    return r


async def listings_of(user: CurrentUser, pnus: list[str], keep_sold: bool = False) -> dict[str, list[dict]]:
    """지번마다 보이는 매물(순번대로, 1번 = 지도 핀에 서는 매물). 매각된 내 매물은 keep_sold 일 때만."""
    if not pnus:
        return {}
    rows = await pool().fetch(
        """SELECT n.pnu, n.listing_id, n.owner, n.office, n.price, n.price_on, n.pp_land, n.pp_total, n.gongsi_ratio,
                  n.ad_id, n.closed, n.rank
             FROM app.listings_now($1, $2) n
            WHERE n.pnu = ANY($3::text[]) AND ($4 OR NOT n.closed)
            ORDER BY n.pnu, n.rank""",
        user.team_id, is_broker(user), list(pnus), keep_sold)
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(r["pnu"], []).append({k: _f(v) for k, v in dict(r).items() if k != "pnu"})
    return out


@router.get("/{pnu}", openapi_extra={"x-ai": "read"})   # AI 가 부를 수 있다(10-AI §3-3)
async def get_parcel(pnu: str, user: CurrentUser = Depends(viewer)):
    """지번 하나 — 땅 · 지번 값 · 동 목록 · 이 땅의 매물 · 추정가 · 공시지가 · 실거래 · 대장 딸림(에너지 · 정화조 · 지역지구구역).
    동 하나의 대장 값(건물정보 카드)은 GET /buildings/{pk}."""
    me = await _me(pnu)
    rep = me["rep_pk"]
    d: dict = {"pnu": pnu, "lng": me["lng"], "lat": me["lat"], "rep_pk": rep,
               "n_bldg": me["n_bldg"] or 0, "total_area": _f(me["total_area"]),
               "floors_above": me["floors_above"], "floors_below": me["floors_below"]}

    # 주소 — 지번 표(parcel_spot · 0259, 나대지 포함). 교통은 대표 동의 값
    a = await pool().fetchrow(
        """SELECT s.addr, s.road_addr, left($1, 10) AS bjd_code,
                  b.subway_json, b.bus_json, b.station_dist
             FROM (SELECT 1) x
             LEFT JOIN master.parcel_spot s ON s.pnu = $1
             LEFT JOIN master.buildings b ON b.building_pk = $2""", pnu, rep)
    d.update(addr=a["addr"], road_addr=a["road_addr"], bjd_code=a["bjd_code"])

    # 동 목록 — 연면적 큰 순(1동 = 대표). 동 칩 · 동 카드가 이 순서를 쓴다
    dongs = await pool().fetch(
        """SELECT b.building_pk, b.main_use_name, b.total_area, b.floors_above, r.rec->>'동명' AS dong_name,
                  r.rec->>'주부속구분' AS main_sub
             FROM master.buildings b LEFT JOIN master.building_ledger_raw r ON r.building_pk = b.building_pk
            WHERE b.pnu = $1 ORDER BY b.total_area DESC NULLS LAST, b.building_pk""", pnu)
    d["dongs"] = [{"building_pk": r["building_pk"], "label": f"{i + 1}동", "dong_name": r["dong_name"],
                   "main_sub": r["main_sub"], "main_use_name": r["main_use_name"],
                   "total_area": _f(r["total_area"]), "floors_above": r["floors_above"]} for i, r in enumerate(dongs)]

    # 땅 — 딸린 필지 합(추정가와 같은 땅). 토지면적은 늘 채워진다 · 대장 대지면적(동 카드)과 섞지 않는다
    land = await pool().fetchrow(
        _SPOT + """SELECT sum(area) AS area, ST_AsGeoJSON(ST_Union(geom)) AS geom,
                          sum(area * gongsi_latest) FILTER (WHERE gongsi_latest > 0) AS gt FROM land""", pnu)
    d["parcel_area"] = _f(land["area"])
    d["parcel_geom"] = json.loads(land["geom"]) if land["geom"] else None
    main = await pool().fetchrow(
        "SELECT jimok, land_use, use_zone, road_frontage, shape, slope, legal_bcr, legal_far, gongsi_latest"
        "  FROM master.parcels WHERE pnu = $1", pnu)
    d.update({k: main[k] for k in ("jimok", "land_use", "use_zone", "road_frontage", "shape", "slope", "gongsi_latest")})

    # 추정가 · 추정가로 나눈 셋 — 지번 값(0250)
    se = await pool().fetchrow("SELECT sale_est, land_area, gongsi_total FROM master.parcel_sale_est WHERE pnu = $1", pnu)
    d["sale_est"] = int(se["sale_est"]) if se and se["sale_est"] else None
    d["gongsi_total"] = _f(se["gongsi_total"]) if se else (_f(land["gt"]) if land["gt"] else None)
    dv = await pool().fetchrow(
        """SELECT pp_land, pp_total, gongsi_ratio, gongsi_up5, gongsi_up10, sale_pnl, bcr_slack, far_slack
             FROM master.building_derived WHERE building_pk = $1""", rep) if rep else None
    for k in ("pp_land", "pp_total", "gongsi_ratio", "gongsi_up5", "gongsi_up10", "sale_pnl", "bcr_slack", "far_slack"):
        d[k] = _f(dv[k]) if dv else None

    # 법정 건폐 · 용적 — 동이 있으면 동 원장(building_legal · 걸친 필지 계산), 없으면 이 필지(값이 하나일 때만)
    lg = await pool().fetchrow("SELECT legal_bcr, legal_far FROM master.building_legal WHERE building_pk = $1", rep) if rep else None
    if lg:
        d["legal_bcr"], d["legal_far"] = _f(lg["legal_bcr"]), _f(lg["legal_far"])
    else:
        d["legal_bcr"], d["legal_far"] = _pct(main["legal_bcr"]), _pct(main["legal_far"])

    # 동이 없으면 지을 수 있는 규모 — 계산이다(땅 × 법정 비율). 사선 · 주차 · 조경은 못 보므로 「이보다 낮을 수 있다」
    if not rep:
        area, bcr, far = d["parcel_area"], d["legal_bcr"], d["legal_far"]
        d["buildable"] = {"total_area": round(area * far / 100, 1) if area and far else None,
                          "build_area": round(area * bcr / 100, 1) if area and bcr else None,
                          "floors": int(far // bcr) if bcr and far and bcr > 0 else None}

    # 교통 — 동이 있으면 빌드 때 잰 값, 없으면 여기서 잰다(같은 모양)
    if rep:
        d["subway_json"], d["bus_json"], d["station_dist"] = a["subway_json"], a["bus_json"], a["station_dist"]
    else:
        st = await pool().fetch(
            """SELECT s.name, s.route, round(ST_Distance(ST_MakePoint(s.lng, s.lat)::geography, $1::geography))::int AS dist
                 FROM master.subway_stations s
                WHERE ST_DWithin(ST_MakePoint(s.lng, s.lat)::geography, $1::geography, 2000)
                ORDER BY dist LIMIT 20""", me["pt"])
        d["subway_json"] = [{"역명": r["name"], "호선": r["route"], "거리": r["dist"], "도보": max(1, round(r["dist"] / 80))}
                            for r in st]
        d["bus_json"], d["station_dist"] = None, (st[0]["dist"] if st else None)

    # 공시지가 추이(이 지번 필지)
    g = await pool().fetch("SELECT year, price FROM master.gongsi_series WHERE pnu = $1 ORDER BY year", pnu)
    d["gongsi_series"] = [[r["year"], r["price"]] for r in g]

    # 이 땅의 매물 — 보이는 것 전부 순번대로. 내 매물이면 관리 줄의 값(매도희망가 · 임대 합계 · 수익률)
    d["listings"] = [{k: m[k] for k in ("listing_id", "owner", "office", "price", "price_on", "rank")}
                     for m in (await listings_of(user, [pnu])).get(pnu, [])]
    lv = await pool().fetchrow(
        """SELECT ol.id, ol.price, ol.ask_price, ol.total_rent, ol.total_deposit, ol.total_mgmt, ol.vacant_area, ol.rent_full
             FROM app.office_listings ol JOIN app.listing_parcels lp ON lp.listing_id = ol.id
            WHERE lp.pnu = $1 AND ol.team_id = $2""", pnu, user.team_id) if user.team_id else None
    d["my_listing_id"] = lv["id"] if lv else None
    d["sale_price"] = lv["price"] if lv else None
    for k in ("ask_price", "total_rent", "total_deposit", "total_mgmt", "vacant_area", "rent_full"):
        d[k] = _f(lv[k]) if lv else None
    d["roi"], d["roi_full"] = roi(d["total_rent"], d["sale_price"]), roi(d["rent_full"], d["sale_price"])

    # 대장 딸림(10-07 대표) — 에너지(지번 · 최근 24개월) · 정화조 · 지역지구구역(동마다)
    en = await pool().fetch(
        """SELECT kind, use_ym, usage_kwh FROM master.building_energy WHERE pnu = $1
            ORDER BY use_ym DESC, kind LIMIT 48""", pnu)
    d["energy"] = [{"kind": r["kind"], "ym": r["use_ym"], "kwh": _f(r["usage_kwh"])} for r in en]
    sp = await pool().fetch(
        """SELECT s.building_pk, s.form_name, s.unit_kind, s.cap_person, s.cap_m3
             FROM master.building_septic s WHERE s.pnu = $1""", pnu)
    d["septic"] = [{k: _f(v) for k, v in dict(r).items()} for r in sp]
    zn = await pool().fetch(
        """SELECT z.building_pk, z.use_zone, z.use_district, z.use_area, z.zones, z.districts, z.areas
             FROM master.building_zone z WHERE z.pnu = $1""", pnu)
    d["zones"] = [dict(r) for r in zn]
    return d


@router.get("/{pnu}/lands", openapi_extra={"x-ai": "read"})
async def get_lands(pnu: str, raw: bool = False, user: CurrentUser = Depends(viewer)):
    """이 지번의 필지(대표 동에 딸린 필지 + 이 지번) — 속성 · 규제 원본 · 폴리곤 + 실측 도로폭(대표 동).
    raw=true 면 팀 정정 없이 원본만(상세보기, 10-02)."""
    me = await _me(pnu)
    rows = await pool().fetch(
        _SPOT + """, dong AS (SELECT DISTINCT ON (bjd_code) bjd_code, dong FROM master.region_index)
        SELECT CASE WHEN land.pnu = $1 THEN '대표' ELSE '부속' END AS role, land.pnu, land.area, land.jimok, land.land_use,
               land.slope, land.shape, land.road_frontage, land.use_zone, land.legal_bcr, land.legal_far, land.regulations,
               d.dong || ' ' || CASE WHEN substr(land.pnu,11,1)='2' THEN '산' ELSE '' END
                 || ltrim(substr(land.pnu,12,4),'0')
                 || CASE WHEN substr(land.pnu,16,4)<>'0000' THEN '-'||ltrim(substr(land.pnu,16,4),'0') ELSE '' END
                 || '번지' AS label,
               ST_AsGeoJSON(land.geom) AS geom_json
          FROM land LEFT JOIN dong d ON d.bjd_code = left(land.pnu, 10)
         ORDER BY (land.pnu = $1) DESC, land.pnu""", pnu)
    out = []
    for r in rows:
        x = dict(r)
        x["area"] = _f(x["area"])
        gj = x.pop("geom_json", None)
        x["geom"] = json.loads(gj) if gj else None
        ov = [] if raw or not user.team_id else await pool().fetch(
            "SELECT field, value FROM app.overlays WHERE team_id=$1 AND target_type='parcel' AND target_id=$2",
            user.team_id, r["pnu"])
        x["_edited"] = [o["field"] for o in ov]
        x["_master"] = {o["field"]: x.get(o["field"]) for o in ov}
        for o in ov:
            x[o["field"]] = o["value"]
        reg = x.pop("regulations", None)
        x["reg_all"] = (json.loads(reg) if isinstance(reg, str) else reg) or []
        out.append(x)
    rw = await pool().fetchrow(
        "SELECT front_m, side_m, rear_m FROM master.building_road WHERE building_pk = $1", me["rep_pk"]) if me["rep_pk"] else None
    return {"parcels": out, "road": {k: _f(v) for k, v in (dict(rw).items() if rw else [])}}


@router.get("/{pnu}/geom")
async def parcel_geom(pnu: str, _: CurrentUser = Depends(viewer)):
    """고른 지번의 땅 폴리곤(딸린 필지 합) — 지도 색칠"""
    gj = await pool().fetchval(_SPOT + "SELECT ST_AsGeoJSON(ST_Union(geom)) FROM land", pnu)
    return {"polygon": json.loads(gj) if gj else None}


_POP_R = 600      # 유동인구 지도 반경(m) — 250m 격자로 대여섯 칸


@router.get("/{pnu}/pop", openapi_extra={"x-ai": "read"})
async def parcel_pop(pnu: str, _: CurrentUser = Depends(viewer)):
    """유동인구 — 이 지번 자리가 든 250m 격자와 둘레 격자의 주간 인구. 생활인구는 땅의 성질이다."""
    me = await _me(pnu)
    cur = await pool().fetchrow(
        """SELECT l.day_avg, l.night_avg, l.peak_hour, l.hourly, l.days FROM master.living_pop l
            WHERE ST_DWithin(l.geom::geography, $1::geography, 200)
            ORDER BY l.geom::geography <-> $1::geography LIMIT 1""", me["pt"])
    if cur is None:
        return {"day": None}          # 격자 밖 — 없는 것은 없다고 한다
    cells = await pool().fetch(
        """SELECT l.day_avg, ST_AsGeoJSON(ST_Transform(ST_Envelope(ST_Expand(ST_Transform(l.geom, 5179), 125)), 4326)) AS gj
             FROM master.living_pop l WHERE ST_DWithin(l.geom::geography, $1::geography, $2)""", me["pt"], _POP_R)
    return {"day": _f(cur["day_avg"]), "night": _f(cur["night_avg"]), "peak_hour": cur["peak_hour"],
            "hourly": [_f(v) for v in (cur["hourly"] or [])], "days": cur["days"],
            "cells": [{"geojson": json.loads(r["gj"]), "pop": _f(r["day_avg"])} for r in cells]}


@router.get("/{pnu}/scene")
async def parcel_scene(pnu: str, _: CurrentUser = Depends(viewer)):
    """입체 지적도 재료 — 땅에 접한 도로 구간 + 법정 건폐/용적(걸친 필지 중 값이 하나인 것의 큰 쪽).
    필지 폴리곤은 GET /parcels/{pnu} 의 parcel_geom 에 있다."""
    roads = await pool().fetch(
        _SPOT + """SELECT r.rn, r.road_bt, ST_AsGeoJSON(r.geom) AS geojson FROM master.road_segment r
                    WHERE ST_DWithin(r.geom::geography, (SELECT ST_Union(geom)::geography FROM land), 40)
                    ORDER BY r.road_bt DESC LIMIT 12""", pnu)
    lim = await pool().fetchrow(
        _SPOT + """SELECT (SELECT legal_bcr FROM land WHERE array_length(legal_bcr, 1) = 1 ORDER BY legal_bcr[1] DESC LIMIT 1) AS bcr,
                          (SELECT legal_far FROM land WHERE array_length(legal_far, 1) = 1 ORDER BY legal_far[1] DESC LIMIT 1) AS far""",
        pnu)
    return {"roads": [{"rn": r["rn"], "road_bt": _f(r["road_bt"]), "geojson": json.loads(r["geojson"])} for r in roads],
            "legal_bcr": lim["bcr"] if lim else None, "legal_far": lim["far"] if lim else None}


@router.get("/{pnu}/events", openapi_extra={"x-ai": "read"})
async def parcel_events(pnu: str, radius: int = 700, kind: str | None = None, years: int | None = None,
                        _: CurrentUser = Depends(viewer)):
    """주변 소식 — master.area_event 에서 이 지번 둘레의 사건을 날짜순으로. 반경은 갈래마다(건축 인허가 250m).
    on_date(정확) · on_year(연도만)는 가른 채로 낸다 — 합치면 「2025년」이 2025-01-01 로 읽힌다."""
    me = await _me(pnu)
    radius = max(100, min(radius, 3000))
    near = {"건축 인허가": 250}
    args: list = [me["pt"], radius]
    where = ""
    if kind:
        args.append(kind)
        where += f" AND e.kind = ${len(args)}"
    if years:
        args.append(years)
        where += (f" AND COALESCE(e.on_date, make_date(COALESCE(e.on_year,1900),1,1))"
                  f" >= (CURRENT_DATE - make_interval(years => ${len(args)}))")
    case = " ".join(f"WHEN '{k}' THEN {v}" for k, v in near.items())
    rows = await pool().fetch(f"""
        SELECT e.id, e.kind, e.name, e.on_date, e.on_year, e.gosi_no, e.body, e.source, e.source_url, p.tags,
               ST_X(ST_PointOnSurface(e.geom)) AS lng, ST_Y(ST_PointOnSurface(e.geom)) AS lat
          FROM master.area_event e
          LEFT JOIN master.press_event p ON e.src_table = 'press_event' AND p.id::text = e.src_key
         WHERE ST_DWithin(e.geom::geography, $1::geography, LEAST($2, CASE e.kind {case} ELSE $2 END)){where}
         ORDER BY COALESCE(e.on_date, make_date(COALESCE(e.on_year,1900),1,1)) DESC, e.id""", *args)
    items = [{"id": r["id"], "kind": r["kind"], "name": r["name"],
              "on_date": r["on_date"].isoformat() if r["on_date"] else None, "on_year": r["on_year"],
              "gosi_no": r["gosi_no"], "body": r["body"], "source": r["source"], "source_url": r["source_url"],
              "tags": list(r["tags"] or []), "lng": r["lng"], "lat": r["lat"]} for r in rows]
    return {"items": items, "radius": radius, "center": [me["lng"], me["lat"]]}


@router.get("/{pnu}/trades")
async def parcel_trades(pnu: str, _: CurrentUser = Depends(viewer)):
    """이 지번의 거래 이력(통매 · 호실 · 토지) — 국토부 실거래 원본만. use = 원천 건축물주용도, 없으면 실거래 유형(0246)."""
    rows = await pool().fetch(
        """SELECT contract_ym, price, total_area, excl_area, land_area, use_label, trade_type, deal_kind, floor
             FROM master.trade_parcel WHERE pnu = $1
            ORDER BY contract_ym DESC, contract_day DESC NULLS LAST, trade_id DESC""", pnu)
    return [{"ym": r["contract_ym"], "price": r["price"], "total_area": _f(r["total_area"]), "excl_area": _f(r["excl_area"]),
             "land_area": _f(r["land_area"]), "use": r["use_label"], "trade_type": r["trade_type"],
             "deal_kind": r["deal_kind"], "floor": r["floor"]} for r in rows]


@router.get("/{pnu}/nearby-trades", openapi_extra={"x-ai": "read"})
async def nearby_trades(pnu: str, radius_m: int = 500, years: int = 5, limit: int = 8, _: CurrentUser = Depends(viewer)):
    """반경 안 최근 통매 — 가까운 순. 이 지번 제외, 지번마다 최근 1건. per_area = 연면적 평단가(원/평)."""
    me = await _me(pnu)
    radius_m, years = max(100, min(radius_m, 3000)), max(1, min(years, 30))
    rows = await pool().fetch(
        """WITH near AS MATERIALIZED (
             SELECT pr.pnu, b.building_pk, b.addr, round(ST_Distance(b.geom::geography, $1::geography)) AS dist_m
               FROM master.buildings b JOIN master.parcel_rep pr ON pr.rep_pk = b.building_pk
              WHERE pr.pnu IS DISTINCT FROM $4 AND ST_DWithin(b.geom::geography, $1::geography, $2))
           SELECT DISTINCT ON (n.pnu) n.pnu, n.building_pk, n.addr, n.dist_m, sh.total_area, sh.land_area,
                  sh.contract_ym, sh.price, sh.trade_type, sh.use_label AS trade_use
             FROM near n JOIN master.trade_whole sh ON sh.pnu = n.pnu
            WHERE sh.total_area > 0 AND sh.contract_ym >= to_char(now() - make_interval(years => $3::int), 'YYYYMM')
            ORDER BY n.pnu, sh.contract_ym DESC, sh.contract_day DESC NULLS LAST""", me["pt"], radius_m, years, pnu)
    sales = []
    for r in rows:
        x = {k: _f(v) for k, v in dict(r).items()}
        x["is_outlier"] = False
        x["per_area"] = round(x["price"] / x["total_area"] * 3.305785) if x["total_area"] else None
        sales.append(x)
    sales.sort(key=lambda x: x["dist_m"])
    return {"sales": sales[:max(1, min(limit, 50))], "radius_m": radius_m}


@router.get("/{pnu}/market")
async def parcel_market(pnu: str, _: CurrentUser = Depends(current_user)):
    """매매시세 · 임대시세(중개사만, 0212) — 이 지번의 네이버 광고, 수집한 날마다 한 줄.
    매매는 지번, 임대는 그 지번의 동들(적재는 대표 동에 몬다 · 0259)."""
    sale = await pool().fetch(
        """SELECT s.observed_on, s.price, s.posted_on, s.n_ads, s.land_area::float, s.total_area::float, s.use_type
             FROM master.market_sale s
            WHERE s.pnu = $1   -- 매매시세는 지번이 열쇠(0259)
            ORDER BY s.observed_on DESC""", pnu)
    rent = await pool().fetch(
        """SELECT r.floor, r.area_key, r.observed_on, r.contract_area::float, r.excl_area::float, r.deposit, r.rent,
                  r.posted_on, r.n_ads, r.use_type
             FROM master.market_rent r WHERE r.building_pk IN (SELECT building_pk FROM master.buildings WHERE pnu = $1)
            ORDER BY CASE WHEN r.floor LIKE '지하%' THEN 1000 + substring(r.floor FROM '\\d+')::int
                          ELSE substring(r.floor FROM '\\d+')::int END NULLS LAST, r.area_key, r.observed_on DESC""", pnu)
    return {"sale": [dict(r) for r in sale], "rent": [dict(r) for r in rent]}
