"""건물 상세: master + 팀 오버레이 병합. specs S02 · 01-상세설계 §3.1."""
import json
from fastapi import APIRouter, Depends, HTTPException
from ..core.db import pool
from ..core.deps import current_user, CurrentUser

router = APIRouter(prefix="/buildings", tags=["buildings"])


@router.get("/{building_pk}")
async def get_building(building_pk: str, user: CurrentUser = Depends(current_user)):
    """화면값 = master + 팀 오버레이 COALESCE(app.building_view)."""
    merged = await pool().fetchval("SELECT app.building_view($1, $2)", building_pk, user.team_id)
    if merged is None:
        raise HTTPException(404, "건물을 찾을 수 없습니다")
    return json.loads(merged) if isinstance(merged, str) else merged
