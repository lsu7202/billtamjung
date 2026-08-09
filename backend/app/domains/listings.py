"""매물 등록(선점): 담당자 지정=등록, NULL=해제. specs S02 §4.1 · S0M §3.5 · schema-app §3."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from ..core.db import pool, tx
from ..core.deps import current_user, CurrentUser

router = APIRouter(prefix="/listings", tags=["listings"])

# 업무 필드(사적·팀 공유). 수정 가능 컬럼 화이트리스트
BIZ_FIELDS = {
    "status", "urgency", "grade", "ipji", "owner_type", "owner_name",
    "relation", "cooperation", "kindness", "intent",
    "owner_phone", "listing_no", "received_on",
    "meongdo", "use_change", "myeolsil", "nohudo", "building_use",   # S02 업무탭·S01b 필터
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


@router.get("/members")
async def team_members(user: CurrentUser = Depends(current_user)):
    """내 팀 멤버 목록(담당자 드롭다운·필터용). 대표 우선·이름순. §S02 §4.1 · S01b 담당자 필터."""
    rows = await pool().fetch(
        """SELECT a.id AS account_id, a.name, tm.role
           FROM app.team_members tm JOIN app.accounts a ON a.id = tm.account_id
           WHERE tm.team_id = $1 AND tm.left_at IS NULL AND a.deleted_at IS NULL
           ORDER BY (tm.role = 'owner') DESC, a.name""",
        user.team_id,
    )
    return [{"account_id": r["account_id"], "name": r["name"], "role": r["role"]} for r in rows]


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
    """담당자 지정=매물 등록(선점). 팀원은 자기 자신만, 대표는 아무나(재배정)·해제.

    해제(target=None)도 **남의 담당은 못 푼다.** 예전엔 해제만 검사에서 빠져 있어서
    팀원이 「해제 → 내가 담당」 두 번으로 대표·다른 팀원의 매물을 가져갈 수 있었다
    (2026-08-09 발견 · 권한 QA C9·C13). 선점 규칙(S0M §3.5)이 통째로 무의미해지는 구멍이었다.
    """
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
    async with tx() as conn:  # 선점 판정·갱신 원자화(경합 방지: 행 잠금)
        cur = await conn.fetchrow(
            "SELECT assignee_account_id FROM app.listings WHERE building_pk=$1 AND team_id=$2 FOR UPDATE",
            body.building_pk, user.team_id,
        )
        cur_assignee = cur["assignee_account_id"] if cur else None
        # 해제는 담당자 본인 또는 대표만. "해제 = 명시적 행위"(§3.5)는 부수효과로 풀리지 말라는 뜻이지
        # 아무나 풀어도 된다는 뜻이 아니다.
        if (target is None and cur_assignee is not None
                and user.role != "owner" and cur_assignee != user.account_id):
            raise HTTPException(403, "담당자 본인 또는 대표만 해제할 수 있습니다")
        # 이미 다른 팀원이 선점 → 팀원은 탈취 불가(대표만 재배정). specs S0M §3.5 "중복 선점 불가"
        if (target is not None and cur_assignee is not None
                and cur_assignee != target and user.role != "owner"):
            raise HTTPException(409, "이미 팀 내 다른 담당자가 선점한 매물입니다")
        await conn.execute(
            """INSERT INTO app.listings(building_pk,team_id,assignee_account_id)
               VALUES($1,$2,$3)
               ON CONFLICT (building_pk,team_id)
               DO UPDATE SET assignee_account_id=EXCLUDED.assignee_account_id, updated_at=now()""",
            body.building_pk, user.team_id, target,
        )
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
