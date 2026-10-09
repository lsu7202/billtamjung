"""건물 상세: master + 팀 오버레이 병합. specs S02 · 01-상세설계 §3.1."""
import json
import re
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from ..core.db import pool
from ..core.deps import current_user, any_user, CurrentUser, viewer
from ..core.shape import drop

router = APIRouter(prefix="/buildings", tags=["buildings"])


@router.get("/{building_pk}", openapi_extra={"x-ai": "read"})   # AI 가 부를 수 있다(10-AI §3-3)
async def get_building(building_pk: str, raw: bool = False, user: CurrentUser = Depends(viewer)):
    """화면값 = master + 팀 오버레이 COALESCE(app.building_view).
    raw=true 면 대장 원본만(10-02) — 상세보기(공개 사실)는 팀 정정을 섞지 않는다. 정정은 매물관리 판 「건축물대장」에서만."""
    team = None if raw else user.team_id
    merged = await pool().fetchval("SELECT app.building_view($1, $2)", building_pk, team)
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
        team, building_pk)
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
    }

    # 지번 단위 값(동 목록 · 추정가 · 이 땅의 매물 · 내 매물 값 · 평단가 · 공시 추이 · 실거래)은 GET /parcels/{pnu} 가 낸다
    # (10-08 · 0255). 여기는 지번 안에서 고른 동 하나의 대장 카드다. 조회 로그(view_log)는 읽는 곳이 없어 지웠다.
    # 법정 건폐·용적 — 계약 문서 화면이 여기서 읽는데 /scene 에만 있었다(감사 2026-09-17)
    lg = await pool().fetchrow(
        "SELECT legal_bcr, legal_far FROM master.building_legal WHERE building_pk=$1", building_pk)
    data["legal_bcr"] = float(lg["legal_bcr"]) if lg and lg["legal_bcr"] is not None else None
    data["legal_far"] = float(lg["legal_far"]) if lg and lg["legal_far"] is not None else None

    return drop(data, _DETAIL_DROP)


# 상세에서 걷는 칸(감사 2026-09-17). 화면 어디에도 안 그려지고 모델에겐 잡음인 것:
#   내부 조각(*_src·*_prec·jibun_norm·sgg_code) · 최상위 elevator_ext(_ref 안 것을 읽음) ·
#   parcel_area(필터 이름).
_DETAIL_DROP = ("bcr_src", "far_src", "approval_ymd_prec", "remodel_ymd_prec", "jibun_norm", "sgg_code",
                "elevator_ext", "parcel_area")


# 지번 단위 값(유동인구 · 입체 지적도 · 주변 소식 · 필지 · 실거래)과 나대지 상세는 GET /parcels/{pnu}/… 로 옮겼다
# (2026-10-08 · 스펙 12 §3-5). 여기 남는 것은 지번 안에서 고른 동 하나의 대장 카드다.
