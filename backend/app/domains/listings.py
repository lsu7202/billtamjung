"""매물 등록(선점): 담당자 지정=등록, NULL=해제. specs S02 §4.1 · S0M §3.5 · schema-app §3."""
import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from ..core.db import pool
from ..core.deps import current_user, CurrentUser

router = APIRouter(prefix="/listings", tags=["listings"])

# 업무 필드(사적·팀 공유). 수정 가능 컬럼 화이트리스트
BIZ_FIELDS = {
    "status", "urgency", "grade", "ipji", "owner_type", "owner_name",
    "relation", "cooperation", "kindness", "intent",
    "owner_phone", "listing_no", "received_on",
}


class ClaimIn(BaseModel):
    building_pk: str
    assignee_account_id: int | None = None  # None=해제


class BizPatch(BaseModel):
    building_pk: str
    fields: dict[str, str | None]


def _mask_phone(row: dict, user: CurrentUser, owner_id: int | None) -> dict:
    """전화번호는 담당자 본인+대표만(예외 2곳 중 하나)."""
    if row.get("owner_phone") and not (
        user.role == "owner" or user.account_id == row.get("assignee_account_id")
    ):
        p = row["owner_phone"]
        row["owner_phone"] = p[:3] + "-****-" + p[-4:] if len(p) >= 8 else "****"
    _ = owner_id
    return row


@router.get("/{building_pk}")
async def get_listing(building_pk: str, user: CurrentUser = Depends(current_user)):
    row = await pool().fetchrow(
        "SELECT * FROM app.listings WHERE building_pk=$1 AND team_id=$2",
        building_pk, user.team_id,
    )
    if not row:
        return {"building_pk": building_pk, "registered": False}
    d = dict(row)
    d["registered"] = d["assignee_account_id"] is not None
    return _mask_phone(d, user, row["assignee_account_id"])


@router.put("/claim")
async def claim(body: ClaimIn, user: CurrentUser = Depends(current_user)):
    """담당자 지정=매물 등록(선점). 팀원은 자기 자신만, 대표는 아무나(재배정)."""
    target = body.assignee_account_id
    if target is not None and user.role != "owner" and target != user.account_id:
        raise HTTPException(403, "팀원은 자기 자신만 담당자로 지정할 수 있습니다")
    if target is not None:
        member = await pool().fetchval(
            "SELECT 1 FROM app.team_members WHERE team_id=$1 AND account_id=$2 AND left_at IS NULL",
            user.team_id, target,
        )
        if not member:
            raise HTTPException(422, "팀 멤버가 아닙니다")
    try:
        await pool().execute(
            """INSERT INTO app.listings(building_pk,team_id,assignee_account_id)
               VALUES($1,$2,$3)
               ON CONFLICT (building_pk,team_id)
               DO UPDATE SET assignee_account_id=EXCLUDED.assignee_account_id, updated_at=now()""",
            body.building_pk, user.team_id, target,
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(409, "이미 팀 내 다른 담당자가 선점한 매물입니다")
    return {"ok": True, "registered": target is not None}


@router.patch("/biz")
async def patch_biz(body: BizPatch, user: CurrentUser = Depends(current_user)):
    """업무 필드 자동저장. 등록 여부와 무관하게 조사 데이터 축적 가능(레코드 upsert)."""
    bad = set(body.fields) - BIZ_FIELDS
    if bad:
        raise HTTPException(422, f"허용되지 않은 필드: {sorted(bad)}")
    await pool().execute(
        """INSERT INTO app.listings(building_pk,team_id) VALUES($1,$2)
           ON CONFLICT (building_pk,team_id) DO NOTHING""",
        body.building_pk, user.team_id,
    )
    import datetime as dt
    sets, args = [], [body.building_pk, user.team_id]
    for i, (k, v) in enumerate(body.fields.items(), start=3):
        sets.append(f'"{k}"=${i}')
        if k == "received_on" and v is not None:
            try:
                args.append(dt.date.fromisoformat(v))
            except ValueError:
                raise HTTPException(422, "received_on은 YYYY-MM-DD")
        else:
            args.append(v)
    await pool().execute(
        f"UPDATE app.listings SET {', '.join(sets)}, updated_at=now() "
        f"WHERE building_pk=$1 AND team_id=$2", *args,
    )
    return {"ok": True}


@router.get("")
async def my_listings(user: CurrentUser = Depends(current_user)):
    """내 매물 목록 = 팀의 등록(담당자 있는) 매물."""
    rows = await pool().fetch(
        """SELECT l.building_pk, l.assignee_account_id, l.status, b.addr
           FROM app.listings l JOIN master.buildings b ON b.building_pk=l.building_pk
           WHERE l.team_id=$1 AND l.assignee_account_id IS NOT NULL
           ORDER BY l.updated_at DESC""",
        user.team_id,
    )
    return [dict(r) for r in rows]
