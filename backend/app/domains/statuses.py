"""상태 — 사람이 고른다(0199, 대표 2026-09-29).

자동 판정 엔진(사다리 뷰 · nego_rank · 보류 표)을 걷고 부기사처럼 바꿨다.
  · 사무소가 상태를 만든다 — 매물(작업 · 준비 · 보류 · 완료)과 고객(진행 · 계약 · 보류 · 종료 · 해약)이 기본값
  · 이름 · 색 · 순서를 고치고, 지울 때는 그 상태의 매물 · 고객을 어디로 옮길지 고른다(비우면 미지정)
  · 매물 · 고객마다 손으로 고른다. 완료를 고를 때 매각일 · 매각금액을 같이 받는다
"""
import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core.db import pool, tx
from ..core.deps import current_user, CurrentUser

router = APIRouter(tags=["statuses"])

KINDS = ("listing", "buyer")


def _kind(k: str) -> str:
    if k not in KINDS:
        raise HTTPException(422, "종류는 listing · buyer")
    return k


@router.get("/statuses")
async def list_statuses(kind: str, user: CurrentUser = Depends(current_user)):
    rows = await pool().fetch(
        """SELECT s.id, s.name, s.color, s.sort,
                  (SELECT count(*) FROM app.listings l WHERE l.status_id = s.id)
                  + (SELECT count(*) FROM app.buyers b WHERE b.status_id = s.id AND b.deleted_at IS NULL) AS n
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
    """지우면 그 상태의 매물 · 고객을 move_to 로 옮긴다(부기사 「삭제 시 이동될 분류」). 없으면 미지정."""
    row = await pool().fetchrow("SELECT kind FROM app.statuses WHERE id=$1 AND team_id=$2", sid, user.team_id)
    if not row:
        raise HTTPException(404, "상태가 없습니다")
    if move_to is not None:
        ok = await pool().fetchval("SELECT 1 FROM app.statuses WHERE id=$1 AND team_id=$2 AND kind=$3 AND id<>$4",
                                   move_to, user.team_id, row["kind"], sid)
        if not ok:
            raise HTTPException(422, "옮길 상태가 이상합니다")
    async with tx() as con:
        tbl = "app.listings" if row["kind"] == "listing" else "app.buyers"
        await con.execute(f"UPDATE {tbl} SET status_id=$2 WHERE status_id=$1", sid, move_to)
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


@router.put("/listings/{building_pk}/status")
async def set_listing_status(building_pk: str, body: ListingStatusIn, user: CurrentUser = Depends(current_user)):
    """상태를 고른다. 비우면 미지정. 완료가 아니면 매각일 · 매각금액은 지운다."""
    name = await _own(body.status_id, user.team_id, "listing")
    done = name == "완료"
    n = await pool().execute(
        """UPDATE app.listings SET status_id=$3, sold_on=$4, sold_price=$5, updated_at=now()
            WHERE building_pk=$1 AND team_id=$2""",
        building_pk, user.team_id, body.status_id,
        body.sold_on if done else None, body.sold_price if done else None)
    if n.endswith(" 0"):
        raise HTTPException(404, "매물관리에 담긴 매물이 아닙니다")
    return {"ok": True}


class BuyerStatusIn(BaseModel):
    status_id: int | None = None


@router.put("/buyers/{bid}/status")
async def set_buyer_status(bid: int, body: BuyerStatusIn, user: CurrentUser = Depends(current_user)):
    await _own(body.status_id, user.team_id, "buyer")
    n = await pool().execute(
        "UPDATE app.buyers SET status_id=$3, updated_at=now() WHERE id=$1 AND team_id=$2 AND deleted_at IS NULL",
        bid, user.team_id, body.status_id)
    if n.endswith(" 0"):
        raise HTTPException(404, "고객이 없습니다")
    return {"ok": True}
