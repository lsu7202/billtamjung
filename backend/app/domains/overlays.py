"""오버레이: 필드 수정(자동저장)·되돌리기. specs S02 §5.2. 레지스트리 검증(트리거)."""
import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from ..core.db import pool
from ..core.deps import current_user, CurrentUser

router = APIRouter(prefix="/overlays", tags=["overlays"])


class OverlayIn(BaseModel):
    target_type: str = "building"   # building|parcel
    target_id: str
    field: str
    value: str | None


@router.put("")
async def upsert(body: OverlayIn, user: CurrentUser = Depends(current_user)):
    """자동저장(넛지·저장버튼 없음). 잘못된 필드·enum은 트리거가 차단."""
    try:
        await pool().execute(
            """INSERT INTO app.overlays(team_id,target_type,target_id,field,value,updated_by)
               VALUES($1,$2,$3,$4,$5,$6)
               ON CONFLICT (team_id,target_type,target_id,field)
               DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()""",
            user.team_id, body.target_type, body.target_id, body.field, body.value, user.account_id,
        )
    except asyncpg.RaiseError as e:  # 트리거 검증 실패
        raise HTTPException(422, str(e))
    return {"ok": True}


@router.delete("")
async def revert(body: OverlayIn, user: CurrentUser = Depends(current_user)):
    """되돌리기 = 행 삭제(마스터 원본 복원). 팀원 행도 삭제 가능."""
    await pool().execute(
        "DELETE FROM app.overlays WHERE team_id=$1 AND target_type=$2 AND target_id=$3 AND field=$4",
        user.team_id, body.target_type, body.target_id, body.field,
    )
    return {"ok": True}


@router.delete("/all/{target_id}")
async def revert_all(target_id: str, user: CurrentUser = Depends(current_user)):
    """전체 되돌리기(S02 §5) — 그 건물의 팀 오버레이 전부 삭제(확인은 프론트)."""
    n = await pool().fetchval(
        """WITH d AS (DELETE FROM app.overlays
             WHERE team_id=$1 AND target_id=$2 RETURNING 1)
           SELECT count(*) FROM d""",
        user.team_id, target_id,
    )
    return {"ok": True, "reverted": n}


@router.get("/distribution/{target_id}")
async def distribution(target_id: str, _: CurrentUser = Depends(current_user)):
    """수정이력 = 값별 분포(익명, S02 §4.3). 공공 마스터 정정 필드만 — 전 팀 집계."""
    rows = await pool().fetch(
        """SELECT o.field, f.label, o.value, count(*) AS cnt
           FROM app.overlays o
           JOIN ref.fields f ON f.field_key = o.field AND f.layer = 'public'
           WHERE o.target_id = $1 AND o.target_type = 'building'
           GROUP BY o.field, f.label, o.value
           ORDER BY o.field, cnt DESC""",
        target_id,
    )
    out: dict[str, dict] = {}
    for r in rows:
        e = out.setdefault(r["field"], {"label": r["label"], "values": []})
        e["values"].append({"value": r["value"], "count": r["cnt"]})
    return out
