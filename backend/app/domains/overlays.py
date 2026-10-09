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
    # 팀이 적는 **값**(매매가·매도희망가)은 여기가 아니라 매물 줄이다(0173). 오버레이는 대장값 정정용.
    if body.field == "market_area":     # 「주변 반경」은 뺐다(10-01) — 더는 저장하지 않는다
        raise HTTPException(422, "주변 반경은 더 이상 저장하지 않습니다")
    if body.field in ("sale_price", "ask_price"):
        raise HTTPException(422, f"「{body.field}」는 오버레이가 아니다 — PATCH /listings/biz 의 fields 로 준다")
    # 값 이력(0109) — 덮어쓰기 전에 이전 값을 뜬다. 「125 → 120」이 협상의 핵심 정보라
    # 값만 갈아치우면 그 사실이 사라진다(조사 규범: append + 현재값은 최신 행).
    prev = await pool().fetchval(
        """SELECT value FROM app.overlays
            WHERE team_id=$1 AND target_type=$2 AND target_id=$3 AND field=$4""",
        user.team_id, body.target_type, body.target_id, body.field)
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
    if (prev or None) != (body.value or None):
        await pool().execute(
            """INSERT INTO app.field_events(team_id, target_type, target_id, field, prev, value, created_by)
               VALUES($1,$2,$3,$4,$5,$6,$7)""",
            user.team_id, body.target_type, body.target_id, body.field, prev, body.value, user.account_id)
    return {"ok": True}


@router.delete("")
async def revert(body: OverlayIn, user: CurrentUser = Depends(current_user)):
    """되돌리기 = 행 삭제(마스터 원본 복원). 팀원 행도 삭제 가능."""
    await pool().execute(
        "DELETE FROM app.overlays WHERE team_id=$1 AND target_type=$2 AND target_id=$3 AND field=$4",
        user.team_id, body.target_type, body.target_id, body.field,
    )
    return {"ok": True}




