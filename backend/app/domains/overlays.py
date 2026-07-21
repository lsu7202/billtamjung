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
