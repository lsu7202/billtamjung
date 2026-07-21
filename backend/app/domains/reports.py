"""보고서: 생성 요청(202)→비동기 잡→폴링→내 산출물(신선도). specs R · S0M §3.2a.

로컬/베타 단순화: Cloud Tasks 대신 BackgroundTasks로 잡 실행(프로덕션에서 Tasks 전환).
"""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from ..core.db import pool
from ..core.deps import current_user, CurrentUser
from ..jobs.generate_report import run_generate

router = APIRouter(prefix="/reports", tags=["reports"])


class CreateIn(BaseModel):
    building_pk: str
    kind: str                      # briefing|analysis
    options: dict = {}


@router.post("", status_code=202)
async def create(body: CreateIn, bg: BackgroundTasks, user: CurrentUser = Depends(current_user)):
    if body.kind not in ("briefing", "analysis"):
        raise HTTPException(422, "kind는 briefing|analysis")
    rid = await pool().fetchval(
        """INSERT INTO app.reports(account_id,building_pk,kind,options_json)
           VALUES($1,$2,$3::app.report_kind,$4) RETURNING id""",
        user.account_id, body.building_pk, body.kind, body.options and __import__("json").dumps(body.options) or "{}",
    )
    bg.add_task(run_generate, rid, user.team_id)   # 프로덕션: Cloud Tasks enqueue
    return {"report_id": rid, "status": "pending"}


@router.get("/{report_id}")
async def get(report_id: int, user: CurrentUser = Depends(current_user)):
    row = await pool().fetchrow(
        "SELECT * FROM app.reports WHERE id=$1 AND account_id=$2", report_id, user.account_id
    )
    if not row:
        raise HTTPException(404, "산출물이 없습니다")
    return dict(row)


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
