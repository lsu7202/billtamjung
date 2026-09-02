"""보고서: 생성 요청(202)→비동기 잡→폴링→내 산출물(신선도). specs R · S0M §3.2a.

로컬/베타 단순화: Cloud Tasks 대신 BackgroundTasks로 잡 실행(프로덕션에서 Tasks 전환).
"""
import json
import os
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from ..core.db import pool
from ..core.deps import current_user, CurrentUser
from ..jobs import generate_report as g, value_score

router = APIRouter(prefix="/reports", tags=["reports"])


class CreateIn(BaseModel):
    building_pk: str
    kind: str = "analysis"         # analysis(우리 판단) | briefing(건물 사실 나열)
    options: dict = {}


async def _subject_ctx(building_pk: str, team_id: int):
    """본매물 조립 + F-16 + 시점보정표(preview·comps 공용)."""
    _, params, time_adjust = await g._load_formula_params()
    b = await g._assemble(building_pk, team_id)
    vs = value_score.compute(b, params)
    return b, vs, params, time_adjust


def _preview_dict(vs: dict, syn: dict) -> dict:
    return {"score": vs["score"], "grade": vs["grade"], "fair_price": syn["fair_price"],
            "avg_per_pyeong": syn["avg_per_pyeong"], "avg_per_land": syn.get("avg_per_land"),
            "expected_roi": syn["expected_roi"],
            "gap": syn["gap"], "ask_price": syn["ask_price"], "broker_price": syn.get("broker_price"),
            "applied_rent": syn.get("applied_rent"), "expected_deposit": syn.get("expected_deposit"),
            "market_applied": syn.get("market_applied", False), "breakdown": syn.get("breakdown"),
            "gongsi_ctx": syn.get("gongsi_ctx"), "rent_summary": syn.get("rent_summary"),           # 05 공시지가 맥락(주변 중앙값·공시배율)
            "rent_floors": syn.get("rent_floors"),         # STEP3 층별 표
            "comps_used": syn.get("comps_used")}           # STEP2 유사사례 표(가중 반영분)


async def _master_fair(building_pk: str) -> float | None:
    """적정가 정본 — master.building_sale_est(2026-09-02).

    배치가 만든 값 하나를 검색·상세·리포트·미리보기가 똑같이 본다. 오버레이(comp 제외·
    필드 수정)가 걸린 요청만 그 팀의 가정으로 다시 계산하고, 그때도 마스터는 안 건드린다.
    """
    v = await pool().fetchval(
        "SELECT sale_est FROM master.building_sale_est WHERE building_pk=$1", building_pk)
    return float(v) if v else None


@router.get("/comps/{building_pk}")
async def comps(building_pk: str, user: CurrentUser = Depends(current_user)):
    """S02b 초기 로드: 본매물 요약 + comp 목록(편집 필드 포함) + 지도 핀 + 초기 미리보기."""
    b, vs, params, ta = await _subject_ctx(building_pk, user.team_id)
    comps = await g._fetch_comps(building_pk, b, params)
    rent_apply = await g._nearby_rent_apply(building_pk, b, user.team_id)   # 주변 임대 comp 적용(리포트 임대료 비교·applied_rent)
    syn = g.synthesize(b, vs["score"], g.baseline_comps(comps), params, ta, rent_apply,
                       apply_market=False,           # 초기=배치 동일(추정가·수익률 모두)
                       fair_override=await _master_fair(building_pk))
    ut = await g._use_type(building_pk, b)   # F-20 투자 유형
    g._attach_future(ut, syn.get("rent_summary"))   # F-21 미래가치(개발여지+임대상향)
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
    """S02b 실시간 재산출(크레딧 미차감). comp 편집·제외 반영 → 적정매매가/수익률.

    exclude 가 비면 **None 으로 내린다**(2026-08-28). _load_comps 는 None 일 때만
    baseline(이상치 제외)을 쓰고, 빈 집합이면 이상치까지 전부 넣는다. 생성은 None 으로
    가는데 미리보기만 빈 집합으로 가면 「미리보기에서 본 값」과 「나온 값」이 달라진다.
    검토 창에서 주변사례 고르기를 걷어내면서 드러난 어긋남이다."""
    b, vs, params, ta = await _subject_ctx(body.building_pk, user.team_id)
    comps = await g._load_comps(body.building_pk, b, params,
                                set(body.exclude) if body.exclude else None, body.overrides)
    rent_apply = await g._nearby_rent_apply(body.building_pk, b, user.team_id)
    # 오버레이가 없으면 마스터 값 그대로 — 미리보기와 실제 생성이 어긋나지 않는다.
    _fair = None if (body.exclude or body.overrides) else await _master_fair(body.building_pk)
    syn = g.synthesize(b, vs["score"], comps, params, ta, rent_apply,
                       apply_market=body.include_market, fair_override=_fair)
    return {"preview": _preview_dict(vs, syn),
            "rent_floors": syn.get("rent_floors"),
            "comp_scores": {c["building_pk"]: c["score"] for c in comps}}


@router.post("", status_code=202)
async def create(body: CreateIn, bg: BackgroundTasks, user: CurrentUser = Depends(current_user)):
    if body.kind not in ("analysis", "briefing"):
        raise HTTPException(422, "kind는 analysis 또는 briefing만 지원합니다")
    rid = await pool().fetchval(
        """INSERT INTO app.reports(account_id,building_pk,kind,options_json)
           VALUES($1,$2,$3::app.report_kind,$4) RETURNING id""",
        user.account_id, body.building_pk, body.kind, json.dumps(body.options or {}),
    )
    bg.add_task(g.run_generate, rid, user.team_id)   # 프로덕션: Cloud Tasks enqueue
    return {"report_id": rid, "status": "pending"}


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
