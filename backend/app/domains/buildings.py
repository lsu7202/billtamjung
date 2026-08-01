"""건물 상세: master + 팀 오버레이 병합. specs S02 · 01-상세설계 §3.1."""
import json
from fastapi import APIRouter, Depends, HTTPException
from ..core.db import pool
from ..core.deps import current_user, CurrentUser
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

    # 필지 경계(보고서 지도용) — 대표+부속 필지 합집합 GeoJSON
    pgeom = await pool().fetchval(
        """SELECT ST_AsGeoJSON(ST_Union(p.geom)) FROM master.building_parcels bp
           JOIN master.parcels p ON p.pnu = bp.pnu WHERE bp.building_pk = $1""",
        building_pk)
    data["parcel_geom"] = json.loads(pgeom) if pgeom else None

    # 유동인구: 오버레이 없으면 접근성 proxy(도로+역)로 추정 등급 채움 — '미지정' 방지(footer 주의사항이 추정 커버)
    data["float_pop"] = vs.float_pop_label(data)

    # 적정가 추정(F-17 v2 배치) — 매매가 미입력 시 기본값. specs R.
    se = await pool().fetchval(
        "SELECT sale_est FROM master.building_sale_est WHERE building_pk=$1", building_pk)
    data["sale_est"] = int(se) if se is not None else None

    # 마스터 예상수익률 — 검색(classified)과 동일 체인: rent(팀 total_rent×12 ?? 마스터 rent_est) ÷ 매매가(팀 sale_price ?? 적정가).
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


@router.get("/{building_pk}/floor-outline")
async def floor_outline(building_pk: str, _: CurrentUser = Depends(current_user)):
    """층별개요(대장) 프리필 — 층·용도·층별면적(바닥, 합=연면적) + 임대료/보증금 추정(공공 상권시세). 층별임대정보 시드용(S02 §3.5).
    rent_est/deposit_est = 마스터 추정값(유저가 입력하면 오버레이가 덮음)."""
    rows = await pool().fetch(
        """SELECT fo.floor, fo.use, fo.exclusive_area, fre.rent_est, fre.deposit_est
           FROM master.floor_outline fo
           LEFT JOIN master.floor_rent_est fre USING (building_pk, seq)
           WHERE fo.building_pk=$1 ORDER BY fo.seq""",
        building_pk)
    return [{"floor": r["floor"], "use": r["use"],
             "exclusive_area": float(r["exclusive_area"]) if r["exclusive_area"] is not None else None,
             "rent_est": r["rent_est"], "deposit_est": r["deposit_est"]}
            for r in rows]


REG_LABELS = {
    "reg_godo": "고도지구", "reg_district": "지구단위계획", "reg_jeongbi": "정비구역",
    "reg_gyeong": "경관지구", "reg_banghwa": "방화지구", "reg_munhwa": "문화재보존",
}


@router.get("/{building_pk}/parcels")
async def get_parcels(building_pk: str, user: CurrentUser = Depends(current_user)):
    """필지 셀렉터(S02 §3.6): 대표+부속 필지별 속성·공시지가 시계열·규제 + 건물 요약(OR 집계)."""
    rows = await pool().fetch(
        """SELECT bp.role, p.pnu, p.area, p.jimok, p.land_use, p.slope, p.shape,
                  p.road_frontage, p.use_zone, p.legal_bcr, p.legal_far, p.gongsi_latest,
                  p.reg_godo, p.reg_district, p.reg_jeongbi, p.reg_gyeong, p.reg_banghwa, p.reg_munhwa
           FROM master.building_parcels bp
           JOIN master.parcels p ON p.pnu = bp.pnu
           WHERE bp.building_pk = $1
           ORDER BY (bp.role='대표') DESC, p.pnu""",
        building_pk,
    )
    parcels = []
    summary: dict[str, str] = {}   # 건물 요약 = 전 필지 OR(한 필지라도 걸리면)
    for r in rows:
        d = dict(r)
        d["area"] = float(d["area"]) if d["area"] is not None else None
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
        d["regs"] = {REG_LABELS[k]: d[k] for k in REG_LABELS if d.get(k)}
        for k, label in REG_LABELS.items():
            if d.get(k) and label not in summary:
                summary[label] = d[k]
        parcels.append(d)
    return {"parcels": parcels, "reg_summary": summary, "count": len(parcels)}
