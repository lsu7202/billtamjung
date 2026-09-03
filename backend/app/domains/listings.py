"""매물 등록(선점): 담당자 지정=등록, NULL=해제. specs S02 §4.1 · S0M §3.5 · schema-app §3."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from ..core.db import pool, tx
from ..core.deps import current_user, CurrentUser

router = APIRouter(prefix="/listings", tags=["listings"])

# 업무 필드(사적·팀 공유). 수정 가능 컬럼 화이트리스트
# 매물에 남는 값 — 이 건물 이 건의 성질.
# 매물번호·접수일은 여기 없다 — 등록 순간 DB 트리거가 발급한다(0068). 손으로 안 짓는다.
# 진행상태(status)는 없앴다(0142) — 매물에 상태 칸을 두지 않는다. 지금 어디까지 왔나는
# 사실에서 파생한다(app.v_listing_stage · app.nego_rank).
LISTING_FIELDS = {
    "urgency", "grade", "ipji", "intent",
    "meongdo", "use_change", "myeolsil", "nohudo", "building_use",   # S02 업무탭·S01b 필터
    # 업무 사다리(0090·S04b) — 접촉 창이 없어 통화 결과는 커밋 칩이 여기로 쓴다.
    # 광고 상태는 우리가 광고를 올리지 않아도 필요하다 — 광고 중이면 경쟁이 있고,
    # 광고가 없으면 나만 아는 물건이다(S04b §3.5).
    "call_result", "ad_status", "ad_off",
    "co_sent_on",   # 공동중개 발송일(0098) — 노출 창 칩. 날짜다(아래 patch 특례)
    "sell_on", "sell_vague",   # 매도 시기(0099) — 의사 창. 정지의 깨움과 다르다(원함인 채의 정보)
    "rent_check",              # 임대내역 확인 상태(0100) — null=안 받음 · 확인중. 받았다=파생
    # 임대 총계(0134) — 수익률의 분자. 층별 실측이 있으면 그 합계가 이깁니다(아래 특례).
    # 숫자 칸이라 빈 문자열은 null 로 눕힌다.
    "total_deposit", "total_rent", "total_mgmt",
}
# 숫자로 눕힐 칸 — 화면은 「5억」처럼 치므로 프론트가 원 단위 숫자 문자열로 보낸다
NUM_FIELDS = {"total_deposit", "total_rent", "total_mgmt"}
# 사람에게 가는 값 — 같은 소유자의 다른 매물에서도 같다(0058, app.owners)
OWNER_FIELDS = {
    "owner_name": "name", "owner_phone": "phone", "owner_type": "owner_type",
    "relation": "relation", "cooperation": "cooperation", "kindness": "kindness",
    "owner_note": "note",
    # 나이대·성별(0063) — 매수자와 같은 enum(buyer_age·buyer_gender)을 쓴다
    "owner_age_band": "age_band", "owner_gender": "gender",
    # 계약서 인적사항(0128) — 주소·법인 대표자·법인등록번호·내외국인. 주민등록번호는 칸 자체가 없다
    "owner_addr": "addr", "owner_rep_name": "rep_name",
    "owner_corp_no": "corp_no", "owner_nationality": "nationality",
}
BIZ_FIELDS = LISTING_FIELDS | set(OWNER_FIELDS)


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
    # 소유자 값은 사람 표(0058)에서 온다. 화면·필터가 쓰던 이름(owner_name…)은 그대로 낸다 —
    # 저장 위치가 바뀌었다고 읽는 쪽 어휘까지 바꿀 이유는 없다.
    row = await pool().fetchrow(
        """SELECT l.*, o.name AS owner_name, o.phone AS owner_phone, o.owner_type,
                  o.relation, o.cooperation, o.kindness, o.note AS owner_note
           FROM app.listings l
           LEFT JOIN app.owners o ON o.id = l.owner_id AND o.deleted_at IS NULL
           WHERE l.building_pk=$1 AND l.team_id=$2""",
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
    # 전화번호는 읽기와 같은 경계로 쓰기도 막는다(S0M §3.4 예외 2곳).
    # 안 막으면 마스킹된 값(010-****-5678)을 보는 팀원이 그대로 저장해 진짜 번호를 덮는다.
    if "owner_phone" in body.fields:
        cur = await pool().fetchval(
            "SELECT assignee_account_id FROM app.listings WHERE building_pk=$1 AND team_id=$2",
            body.building_pk, user.team_id)
        if not (user.role == "owner" or user.account_id == cur):
            raise HTTPException(403, "전화번호는 담당자 본인 또는 대표만 수정할 수 있습니다")
    await pool().execute(
        """INSERT INTO app.listings(building_pk,team_id) VALUES($1,$2)
           ON CONFLICT (building_pk,team_id) DO NOTHING""",
        body.building_pk, user.team_id,
    )
    import datetime as dt
    own = {OWNER_FIELDS[k]: v for k, v in body.fields.items() if k in OWNER_FIELDS}
    lst = {k: v for k, v in body.fields.items() if k in LISTING_FIELDS}

    if own:
        # 소유자 값이 오면 사람 행을 만들거나 갱신한다. 이 매물에 아직 사람이 안 붙어 있으면
        # 새로 만든다 — 매물 하나에 소유자 하나(0058)라 여기서 갈라질 일이 없다.
        oid = await pool().fetchval(
            "SELECT owner_id FROM app.listings WHERE building_pk=$1 AND team_id=$2",
            body.building_pk, user.team_id)
        if oid is None:
            # 같은 사람이 이미 있으면 거기 붙인다 — 없으면 한 사람이 매물마다 쪼개진다(0058의 요점).
            # 판정은 **전화번호(숫자만)**가 우선, 없으면 이름. 기존 사람에게 번호가 아직 없을 때도
            # 같은 이름이면 같은 사람으로 본다(번호가 나중에 채워지는 흐름).
            digits = "".join(ch for ch in (body.fields.get("owner_phone") or "") if ch.isdigit())
            nm = (body.fields.get("owner_name") or "").strip()
            oid = await pool().fetchval(
                r"""SELECT id FROM app.owners
                     WHERE team_id=$1 AND deleted_at IS NULL
                       AND ( ($2 <> '' AND regexp_replace(COALESCE(phone,''),'\D','','g') = $2)
                          OR ($3 <> '' AND name = $3
                              AND ($2 = '' OR regexp_replace(COALESCE(phone,''),'\D','','g') = '')) )
                     ORDER BY id LIMIT 1""",
                user.team_id, digits, nm)
            if oid is None:
                oid = await pool().fetchval(
                    "INSERT INTO app.owners(team_id, created_by) VALUES($1,$2) RETURNING id",
                    user.team_id, user.account_id)
            # 찾았든 만들었든 **여기서 한 번** 잇는다. 예전엔 만들 때만 이어서,
            # 기존 사람을 찾아낸 매물은 주인 없이 남았다.
            await pool().execute(
                "UPDATE app.listings SET owner_id=$3 WHERE building_pk=$1 AND team_id=$2",
                body.building_pk, user.team_id, oid)


        # 확보는 **파생**이다(2026-08-17) — 이름과 전화가 **둘 다** 차는 순간.
        # 전이 시점을 잡아야 장부 한 줄이 정확히 한 번 선다(수정 때마다 서면 소음).
        prev = await pool().fetchrow(
            "SELECT name, phone FROM app.owners WHERE id=$1", oid)
        was_got = bool(prev and (prev["name"] or "").strip() and (prev["phone"] or "").strip())
        cols = ", ".join(f'"{c}"=${i}' for i, c in enumerate(own, start=2))
        await pool().execute(
            f"UPDATE app.owners SET {cols}, updated_at=now() WHERE id=$1", oid, *own.values())
        now_ = await pool().fetchrow(
            "SELECT name, phone FROM app.owners WHERE id=$1", oid)
        # 값 저장은 장부에 줄을 남기지 않는다(2026-08-18) — 값이 이미 그 사실이다.
        got_now = (now_["name"] or "").strip() and (now_["phone"] or "").strip()
        if not was_got and got_now:
            # 소유자 찾기가 끝났다 — 열린 멈춤은 자동 해제(확보됐는데 멈춤이면 모순)
            await pool().execute(
                """UPDATE app.stops SET resolved_at=now()
                    WHERE team_id=$1 AND target_type='listing' AND target_id=$2
                      AND stage='owner' AND resolved_at IS NULL""",
                user.team_id, body.building_pk)

    if lst:
        sets, args = [], [body.building_pk, user.team_id]
        for i, (k, v) in enumerate(lst.items(), start=3):
            sets.append(f'"{k}"=${i}')
            if k in ("received_on", "co_sent_on", "sell_on") and v is not None:
                try:
                    args.append(dt.date.fromisoformat(v))
                except ValueError:
                    raise HTTPException(422, f"{k}는 YYYY-MM-DD")
            elif k in NUM_FIELDS:
                # 빈 문자열 = 지움(null). 0 은 「안 받는다」라 null 과 다르다 — 그대로 0 으로 둔다.
                if v is None or str(v).strip() == "":
                    args.append(None)
                else:
                    try:
                        args.append(int(float(str(v).replace(",", ""))))
                    except ValueError:
                        raise HTTPException(422, f"{k}는 숫자")
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
        """SELECT l.building_pk, l.assignee_account_id,
                  COALESCE(b.addr, vp.addr) AS addr
           FROM app.listings l
           LEFT JOIN master.buildings b ON b.building_pk=l.building_pk
           LEFT JOIN master.vacant_parcels vp ON l.building_pk = 'P' || vp.pnu
           WHERE l.team_id=$1 AND l.assignee_account_id IS NOT NULL
           ORDER BY l.updated_at DESC""",
        user.team_id,
    )
    return [dict(r) for r in rows]
