"""상태 — 사람이 고른다(0199, 대표 2026-09-29).

자동 판정 엔진(사다리 뷰 · nego_rank · 보류 표)을 걷고 부기사처럼 바꿨다.
  · 사무소가 상태를 만든다 — 매물(작업 · 준비 · 보류 · 완료)이 기본값. 고객 상태는 0220 에서 지웠다(10-04)
  · 이름 · 색 · 순서를 고치고, 지울 때는 그 상태의 매물을 어디로 옮길지 고른다(비우면 미지정)
  · 매물마다 손으로 고른다. 완료를 고를 때 매각일 · 매각금액을 같이 받는다
"""
import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core.db import pool, tx
from ..core.deps import current_user, CurrentUser

router = APIRouter(tags=["statuses"])

KINDS = ("listing",)


def _kind(k: str) -> str:
    if k not in KINDS:
        raise HTTPException(422, "종류는 listing")
    return k


@router.get("/statuses")
async def list_statuses(kind: str, user: CurrentUser = Depends(current_user)):
    rows = await pool().fetch(
        """SELECT s.id, s.name, s.color, s.sort,
                  (SELECT count(*) FROM app.listing_office l WHERE l.status_id = s.id) AS n
             FROM app.statuses s WHERE s.team_id=$1 AND s.kind=$2 ORDER BY s.sort, s.id""",
        user.team_id, _kind(kind))
    return [dict(r) for r in rows]


class StatusIn(BaseModel):
    kind: str
    name: str
    color: str = "#8B95A1"


def _check(name: str | None, color: str | None) -> None:
    if name is not None and not (1 <= len(name.strip()) <= 12):
        raise HTTPException(422, "이름은 1~12자")
    if color is not None and not (len(color) == 7 and color.startswith("#")):
        raise HTTPException(422, "색은 #RRGGBB")


@router.post("/statuses", status_code=201)
async def add_status(body: StatusIn, user: CurrentUser = Depends(current_user)):
    _check(body.name, body.color)
    sid = await pool().fetchval(
        """INSERT INTO app.statuses(team_id, kind, name, color, sort)
           VALUES($1,$2,$3,$4,(SELECT COALESCE(max(sort),0)+1 FROM app.statuses WHERE team_id=$1 AND kind=$2))
           ON CONFLICT (team_id, kind, name) DO NOTHING RETURNING id""",
        user.team_id, _kind(body.kind), body.name.strip(), body.color)
    if sid is None:
        raise HTTPException(409, "같은 이름의 상태가 있습니다")
    return {"id": sid}


class StatusPatch(BaseModel):
    name: str | None = None
    color: str | None = None


@router.patch("/statuses/{sid}")
async def edit_status(sid: int, body: StatusPatch, user: CurrentUser = Depends(current_user)):
    _check(body.name, body.color)
    try:
        n = await pool().execute(
            "UPDATE app.statuses SET name=COALESCE($3,name), color=COALESCE($4,color) WHERE id=$1 AND team_id=$2",
            sid, user.team_id, body.name.strip() if body.name else None, body.color)
    except Exception:                                           # noqa: BLE001 — 유일 제약
        raise HTTPException(409, "같은 이름의 상태가 있습니다")
    if n.endswith(" 0"):
        raise HTTPException(404, "상태가 없습니다")
    return {"ok": True}


class OrderIn(BaseModel):
    kind: str
    ids: list[int]


@router.put("/statuses/order")
async def order_statuses(body: OrderIn, user: CurrentUser = Depends(current_user)):
    async with tx() as con:
        for i, sid in enumerate(body.ids, start=1):
            await con.execute("UPDATE app.statuses SET sort=$4 WHERE id=$1 AND team_id=$2 AND kind=$3",
                              sid, user.team_id, _kind(body.kind), i)
    return {"ok": True}


@router.delete("/statuses/{sid}")
async def del_status(sid: int, move_to: int | None = None, user: CurrentUser = Depends(current_user)):
    """지우면 그 상태의 매물을 move_to 로 옮긴다(부기사 「삭제 시 이동될 분류」). 없으면 미지정."""
    row = await pool().fetchrow("SELECT kind FROM app.statuses WHERE id=$1 AND team_id=$2", sid, user.team_id)
    if not row:
        raise HTTPException(404, "상태가 없습니다")
    if move_to is not None:
        ok = await pool().fetchval("SELECT 1 FROM app.statuses WHERE id=$1 AND team_id=$2 AND kind=$3 AND id<>$4",
                                   move_to, user.team_id, row["kind"], sid)
        if not ok:
            raise HTTPException(422, "옮길 상태가 이상합니다")
    async with tx() as con:
        # 옮겨 가면 보류 사유는 새 상태에서 의미가 없다 — 비운다
        await con.execute("UPDATE app.listing_office SET status_id=$2, hold_reason=NULL WHERE status_id=$1", sid, move_to)
        await con.execute("DELETE FROM app.statuses WHERE id=$1", sid)
    return {"ok": True}


async def _own(sid: int | None, team_id: int, kind: str) -> str | None:
    if sid is None:
        return None
    name = await pool().fetchval("SELECT name FROM app.statuses WHERE id=$1 AND team_id=$2 AND kind=$3",
                                 sid, team_id, kind)
    if name is None:
        raise HTTPException(422, "이 사무소의 상태가 아닙니다")
    return name


class ListingStatusIn(BaseModel):
    status_id: int | None = None
    sold_on: dt.date | None = None     # 완료일 때 — 매각일 · 매각금액(부기사 「매물상태변경」)
    sold_price: int | None = None
    hold_reason: str | None = None     # 보류일 때 — 사유 하나(0201, hold_reason_listing 사전)


async def _reason(kind: str, name: str | None, reason: str | None) -> str | None:
    """보류일 때만 사유를 둔다. 사전(ref.enums hold_reason_*)에 없는 값은 422."""
    if name != "보류" or not reason:
        return None
    ok = await pool().fetchval("SELECT 1 FROM ref.enums WHERE enum_key=$1 AND code=$2 AND active",
                               f"hold_reason_{kind}", reason)
    if not ok:
        raise HTTPException(422, "보류 사유가 이상합니다")
    return reason


@router.put("/listings/{listing_id}/status")
async def set_listing_status(listing_id: int, body: ListingStatusIn, user: CurrentUser = Depends(current_user)):
    """상태를 고른다. 비우면 미지정. 완료가 아니면 매각일 · 매각금액, 보류가 아니면 사유를 지운다."""
    name = await _own(body.status_id, user.team_id, "listing")
    done = name == "완료"
    reason = await _reason("listing", name, body.hold_reason)
    n = await pool().execute(
        """UPDATE app.listing_office o SET status_id=$3, sold_on=$4, sold_price=$5, hold_reason=$6
             FROM app.listings l WHERE l.id = o.listing_id AND l.id=$1 AND l.team_id=$2""",
        listing_id, user.team_id, body.status_id,
        body.sold_on if done else None, body.sold_price if done else None, reason)
    if n.endswith(" 0"):
        raise HTTPException(404, "매물관리에 담긴 매물이 아닙니다")
    return {"ok": True}
