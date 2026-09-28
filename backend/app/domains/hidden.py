"""숨기기(0197, 대표 09-28) — 계정마다 「안 보는」 건물.

조건과 상관없이 계속 안 보인다. 필터를 바꾸거나 창을 닫아도 그대로고, 「다시 보기」로만 되돌린다.
고객 계정도 쓴다(any_user).
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..core.db import pool
from ..core.deps import any_user, CurrentUser

router = APIRouter(tags=["hidden"])


@router.get("/hidden")
async def list_hidden(user: CurrentUser = Depends(any_user)):
    """숨긴 건물 — 최근에 숨긴 것이 위. 주소를 같이 낸다(「다시 보기」 목록)."""
    rows = await pool().fetch(
        """SELECT h.building_pk, h.created_at, COALESCE(b.addr, '') AS addr
             FROM app.hidden_buildings h
             LEFT JOIN master.buildings b ON b.building_pk = h.building_pk
            WHERE h.account_id = $1 ORDER BY h.created_at DESC""", user.account_id)
    return [dict(r) for r in rows]


class HideIn(BaseModel):
    building_pk: str


@router.post("/hidden", status_code=201)
async def hide(body: HideIn, user: CurrentUser = Depends(any_user)):
    await pool().execute(
        "INSERT INTO app.hidden_buildings(account_id, building_pk) VALUES($1,$2) ON CONFLICT DO NOTHING",
        user.account_id, body.building_pk)
    return {"ok": True}


@router.delete("/hidden/{building_pk}")
async def unhide(building_pk: str, user: CurrentUser = Depends(any_user)):
    await pool().execute("DELETE FROM app.hidden_buildings WHERE account_id=$1 AND building_pk=$2",
                         user.account_id, building_pk)
    return {"ok": True}


@router.delete("/hidden")
async def unhide_all(user: CurrentUser = Depends(any_user)):
    await pool().execute("DELETE FROM app.hidden_buildings WHERE account_id=$1", user.account_id)
    return {"ok": True}
