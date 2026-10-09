"""숨기기(0197, 대표 09-28) — 계정마다 「안 보는」 지번(10-08 지번 열쇠 · 0253).

조건과 상관없이 계속 안 보인다. 필터를 바꾸거나 창을 닫아도 그대로고, 「다시 보기」로만 되돌린다.
고객 계정도 쓴다(any_user).
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..core.db import pool
from ..core.deps import any_user, CurrentUser, viewer

router = APIRouter(tags=["hidden"])


@router.get("/hidden")
async def list_hidden(user: CurrentUser = Depends(viewer)):
    """숨긴 지번 — 최근에 숨긴 것이 위. 주소를 같이 낸다(「다시 보기」 목록)."""
    rows = await pool().fetch(
        """SELECT h.pnu, h.created_at, COALESCE(app.parcel_addr(h.pnu), '') AS addr
             FROM app.hidden_parcels h
            WHERE h.account_id = $1 ORDER BY h.created_at DESC""", user.account_id)
    return [dict(r) for r in rows]


class HideIn(BaseModel):
    pnu: str


@router.post("/hidden", status_code=201)
async def hide(body: HideIn, user: CurrentUser = Depends(any_user)):
    await pool().execute(
        "INSERT INTO app.hidden_parcels(account_id, pnu) VALUES($1,$2) ON CONFLICT DO NOTHING",
        user.account_id, body.pnu)
    return {"ok": True}


@router.delete("/hidden/{pnu}")
async def unhide(pnu: str, user: CurrentUser = Depends(any_user)):
    await pool().execute("DELETE FROM app.hidden_parcels WHERE account_id=$1 AND pnu=$2", user.account_id, pnu)
    return {"ok": True}


@router.delete("/hidden")
async def unhide_all(user: CurrentUser = Depends(any_user)):
    await pool().execute("DELETE FROM app.hidden_parcels WHERE account_id=$1", user.account_id)
    return {"ok": True}
