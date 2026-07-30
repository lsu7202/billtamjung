"""보고서: 생성 요청(202)→비동기 잡→폴링→내 산출물(신선도). specs R · S0M §3.2a.

로컬/베타 단순화: Cloud Tasks 대신 BackgroundTasks로 잡 실행(프로덕션에서 Tasks 전환).
"""
import json
import os
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from ..core.db import pool
from ..core.deps import current_user, CurrentUser
from ..jobs import generate_report as g, value_score

router = APIRouter(prefix="/reports", tags=["reports"])


class CreateIn(BaseModel):
    building_pk: str
    kind: str                      # briefing|analysis
    options: dict = {}


async def _subject_ctx(building_pk: str, team_id: int):
    """본매물 조립 + F-16 + 시점보정표(preview·comps 공용)."""
    _, params, time_adjust = await g._load_formula_params()
    b = await g._assemble(building_pk, team_id)
    vs = value_score.compute(b, params)
    return b, vs, params, time_adjust


def _preview_dict(vs: dict, syn: dict) -> dict:
    return {"score": vs["score"], "grade": vs["grade"], "fair_price": syn["fair_price"],
            "avg_per_pyeong": syn["avg_per_pyeong"], "expected_roi": syn["expected_roi"],
            "gap": syn["gap"], "ask_price": syn["ask_price"], "broker_price": syn.get("broker_price"),
            "applied_rent": syn.get("applied_rent"), "expected_deposit": syn.get("expected_deposit"),
            "market_applied": syn.get("market_applied", False), "breakdown": syn.get("breakdown"),
            "gongsi_ctx": syn.get("gongsi_ctx"), "rent_summary": syn.get("rent_summary"),           # 05 공시지가 맥락(주변 중앙값·공시배율)
            "rent_floors": syn.get("rent_floors"),         # STEP3 층별 표
            "comps_used": syn.get("comps_used")}           # STEP2 유사사례 표(가중 반영분)


@router.get("/comps/{building_pk}")
async def comps(building_pk: str, user: CurrentUser = Depends(current_user)):
    """S02b 초기 로드: 본매물 요약 + comp 목록(편집 필드 포함) + 지도 핀 + 초기 미리보기."""
    b, vs, params, ta = await _subject_ctx(building_pk, user.team_id)
    comps = await g._fetch_comps(building_pk, b, params)
    rent_apply = await g._nearby_rent_apply(building_pk, b, user.team_id)   # 주변 임대 comp 적용(리포트 임대료 비교·applied_rent)
    syn = g.synthesize(b, vs["score"], [c for c in comps if not c["is_outlier"]], params, ta, rent_apply)  # 초기=이상치 제외
    ut = await g._use_type(building_pk, b)   # F-20 투자 유형
    poly, radius, center = g._market_spatial(b)
    geom = await pool().fetchrow(
        "SELECT ST_X(geom) AS lng, ST_Y(geom) AS lat FROM master.buildings WHERE building_pk=$1", building_pk)
    ctr = center or (dict(geom) if geom else None)
    rent_rows = await pool().fetch(
        f"""SELECT DISTINCT b.building_pk, ST_X(b.geom) AS lng, ST_Y(b.geom) AS lat
            FROM app.floor_rents fr JOIN master.buildings b ON b.building_pk = fr.building_pk
            WHERE fr.deleted_at IS NULL AND fr.is_vacant IS NOT TRUE AND fr.building_pk <> $4
              AND {g._COMP_SPATIAL}""",
        ctr["lng"] if ctr else None, ctr["lat"] if ctr else None, radius, building_pk,
        json.dumps(poly) if poly else None,
    )
    return {
        "subject": {"addr": b.get("addr"), "score": vs["score"], "grade": vs["grade"],
                    "items": vs["items"],   # F-16 8축(리포트 레이더용)
                    "total_area": g._fnum(b.get("total_area")), "sale_price": g._fnum(b.get("sale_price")),
                    "total_rent": g._fnum(b.get("total_rent")), "center": ctr,
                    "radius_m": radius, "polygon": bool(poly)},
        "preview": {**_preview_dict(vs, syn), "use_type": ut},
        "comps": comps,
        "rent_pins": [dict(r) for r in rent_rows],
        "counts": {"sale": len(comps), "rent": len(rent_rows)},
    }


class PreviewIn(BaseModel):
    building_pk: str
    exclude: list[str] = []
    overrides: dict = {}           # {building_pk: {fields}}
    include_market: bool = True


@router.post("/preview")
async def preview(body: PreviewIn, user: CurrentUser = Depends(current_user)):
    """S02b 실시간 재산출(크레딧 미차감). comp 편집·제외 반영 → 적정매매가/수익률."""
    b, vs, params, ta = await _subject_ctx(body.building_pk, user.team_id)
    comps = await g._load_comps(body.building_pk, b, params, set(body.exclude), body.overrides)
    rent_apply = await g._nearby_rent_apply(body.building_pk, b, user.team_id) if body.include_market else None
    syn = g.synthesize(b, vs["score"], comps, params, ta, rent_apply)
    return {"preview": _preview_dict(vs, syn),
            "rent_floors": syn.get("rent_floors"),
            "comp_scores": {c["building_pk"]: c["score"] for c in comps}}


@router.post("", status_code=202)
async def create(body: CreateIn, bg: BackgroundTasks, user: CurrentUser = Depends(current_user)):
    if body.kind not in ("briefing", "analysis"):
        raise HTTPException(422, "kind는 briefing|analysis")
    rid = await pool().fetchval(
        """INSERT INTO app.reports(account_id,building_pk,kind,options_json)
           VALUES($1,$2,$3::app.report_kind,$4) RETURNING id""",
        user.account_id, body.building_pk, body.kind, json.dumps(body.options or {}),
    )
    bg.add_task(g.run_generate, rid, user.team_id)   # 프로덕션: Cloud Tasks enqueue
    return {"report_id": rid, "status": "pending"}


@router.get("/{report_id}/download")
async def download(report_id: int, user: CurrentUser = Depends(current_user)):
    """완료된 보고서 PPTX 다운로드(본인 소유만). 파일 없으면 410(재생성 안내)."""
    row = await pool().fetchrow(
        "SELECT file_path, kind, status FROM app.reports WHERE id=$1 AND account_id=$2",
        report_id, user.account_id)
    if not row or row["status"] != "done" or not row["file_path"]:
        raise HTTPException(404, "다운로드할 보고서가 없습니다")
    if not os.path.exists(row["file_path"]):
        raise HTTPException(410, "파일이 만료되었습니다 — 재생성해 주세요")
    name = f"빌탐정_{'분석보고서' if row['kind'] == 'analysis' else '브리핑'}_{report_id}.pptx"
    return FileResponse(
        row["file_path"], filename=name,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation")


@router.get("/{report_id}")
async def get(report_id: int, user: CurrentUser = Depends(current_user)):
    row = await pool().fetchrow(
        "SELECT * FROM app.reports WHERE id=$1 AND account_id=$2", report_id, user.account_id
    )
    if not row:
        raise HTTPException(404, "산출물이 없습니다")
    d = dict(row)
    for k in ("result_json", "options_json"):   # jsonb → 객체(프론트 파싱 불필요)
        if isinstance(d.get(k), str):
            d[k] = json.loads(d[k])
    return d


@router.get("")
async def list_reports(user: CurrentUser = Depends(current_user), limit: int = 20):
    """내 산출물 + stale('데이터 변경됨') 판정."""
    rows = await pool().fetch(
        """SELECT r.*, app.report_is_stale(r.id) AS is_stale, b.addr
           FROM app.reports r
           LEFT JOIN master.buildings b ON b.building_pk=r.building_pk
           WHERE r.account_id=$1
           ORDER BY r.created_at DESC LIMIT $2""",
        user.account_id, limit,
    )
    return [dict(r) for r in rows]
