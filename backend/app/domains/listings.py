"""매물 등록(선점): 담당자 지정=등록, NULL=해제. specs S02 §4.1 · S0M §3.5 · schema-app §3.
열쇠는 매물 번호(listing_id). 새로 등록할 때만 지번(pnu)을 받는다(0255 · 매물-중심 §5-0)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from ..core.db import pool, tx
from ..core.deps import current_user, CurrentUser
from .listing_core import create_office_listing, listing_of_pnu, need_listing
from .mirror import listing_values_write, listing_values_fold

router = APIRouter(prefix="/listings", tags=["listings"])

# 업무 필드(사적·팀 공유). 수정 가능 컬럼 화이트리스트
# 매물에 남는 값 — 이 건물 이 건의 성질.
# 매물번호·접수일은 여기 없다 — 등록 순간 DB 트리거가 발급한다(0068). 손으로 안 짓는다.
# 진행상태(status)는 없앴다(0142) — 매물에 상태 칸을 두지 않는다. 지금 어디까지 왔나는
# 사실에서 파생한다(app.v_listing_stage · app.nego_rank).
LISTING_FIELDS = {
    "urgency", "grade", "ipji", "intent",
    "meongdo", "use_change", "myeolsil", "nohudo", "building_use",
    "price_vs_market",  # 시세대비(0187) — 저렴·적정·비쌈. 사람이 매긴다
    "building_major",   # 매물 유형(0184 · 0193) — 빌딩·상가주택·공장·창고·숙박·기타 하나. 소분류(building_use)는 여럿   # S02 업무탭·S01b 필터
    # 업무 사다리(0090·S04b) — 접촉 창이 없어 통화 결과는 커밋 칩이 여기로 쓴다.
    "call_result",
    "exclusive",    # 전속(0182) — 참·거짓·null(모름)
    "sell_on", "sell_vague",   # 매도 시기(0099) — 의사 창. 정지의 깨움과 다르다(원함인 채의 정보)
    "rent_check",              # 임대내역 확인 상태(0100) — null=안 받음 · 확인중. 받았다=파생
    # 임대 총계(0134) — 수익률의 분자. 사람이 적는다(10-06 · 임대내역 합계로 덮지 않는다).
    # 숫자 칸이라 빈 문자열은 null 로 눕힌다.
    "total_deposit", "total_rent", "total_mgmt",
    # 가격 — 매매가(중개인 판단)·매도희망가(건물주). 매매가는 매매가 표의 내매물 줄(0224), 매도희망가는 매물 줄.
    # 둘 다 mirror.listing_values_write 로만 쓴다 — 이력(field_events)이 거기 있다.
    "sale_price", "ask_price",
    # 광고 값의 정본(0209) — 융자금 · 융자 표시 · 입주가능일. 광고는 읽기만
    "loan", "loan_open", "move_in", "move_in_on",
}
# 숫자로 눕힐 칸 — 화면은 「5억」처럼 치므로 프론트가 원 단위 숫자 문자열로 보낸다
NUM_FIELDS = {"total_deposit", "total_rent", "total_mgmt", "sale_price", "ask_price", "loan"}
VALUE_FOLD = NUM_FIELDS     # 이 칸이 바뀌면 층별 합계 · 만실 월임대를 매물 줄로 다시 접는다
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
    pnu: str                                # 이 땅을 매물로(지번). 이미 있으면 그 매물
    assignee_account_id: int | None = None  # None=해제


class BizPatch(BaseModel):
    listing_id: int
    # 소분류(building_use)만 여럿이라 목록으로 온다(0182). 전속은 참·거짓
    fields: dict[str, bool | str | list[str] | None]


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


@router.get("/of-parcel/{pnu}")
async def listing_of_parcel(pnu: str, user: CurrentUser = Depends(current_user)):
    """이 지번의 우리 사무소 매물 번호(없으면 null) — 지번 페이지 · 탐색에서 「매물관리에서 열기」를 고를 때"""
    lid = await listing_of_pnu(user.team_id, pnu)
    reg = await pool().fetchval("SELECT assignee_account_id IS NOT NULL FROM app.listing_office WHERE listing_id=$1", lid) if lid else False
    return {"listing_id": lid, "registered": bool(reg)}


@router.get("/{listing_id}", openapi_extra={"x-ai": "read"})   # AI 가 부를 수 있다(10-AI §3-3)
async def get_listing(listing_id: int, user: CurrentUser = Depends(current_user)):
    # 소유자 값은 사람 표(0058)에서 온다. 화면·필터가 쓰던 이름(owner_name…)은 그대로 낸다 —
    # 저장 위치가 바뀌었다고 읽는 쪽 어휘까지 바꿀 이유는 없다.
    row = await pool().fetchrow(
        """SELECT l.*, o.name AS owner_name, o.phone AS owner_phone, o.owner_type,
                  o.relation, o.cooperation, o.kindness, o.note AS owner_note
           FROM app.office_listings l
           LEFT JOIN app.owners o ON o.id = l.owner_id AND o.deleted_at IS NULL
           WHERE l.id=$1 AND l.team_id=$2""",
        listing_id, user.team_id,
    )
    if not row:
        raise HTTPException(404, "우리 사무소 매물이 아닙니다")
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
            # 매물은 지번에 붙는다(0229) — 이 지번의 우리 매물
            """SELECT o.assignee_account_id, l.id FROM app.listings l JOIN app.listing_office o ON o.listing_id = l.id
                 JOIN app.listing_parcels lp ON lp.listing_id = l.id
                WHERE lp.pnu = $1 AND l.team_id=$2 FOR UPDATE OF o""",
            body.pnu, user.team_id,
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
        if cur is None and target is None:
            return {"ok": True, "registered": False, "listing_id": None}       # 없는 매물을 풀 것은 없다
        # 매물 등록 = 담당자 지정(0226 — 매물은 여기서만 생긴다). 다시 받으면 같은 매물을 다시 연다
        lid = cur["id"] if cur else await create_office_listing(user.team_id, body.pnu, conn)
        await conn.execute("UPDATE app.listing_office SET assignee_account_id=$2 WHERE listing_id=$1", lid, target)
    # 매물 등록 순간 원장 업체를 임대 내역 호실로 한 번 복사한다(0185). 이미 줄이 있으면 안 한다
    if target is not None:
        from .floor_rents import seed_from_ledger
        await seed_from_ledger(user.team_id, lid)
    return {"ok": True, "registered": target is not None, "listing_id": lid}


@router.patch("/biz")
async def patch_biz(body: BizPatch, user: CurrentUser = Depends(current_user)):
    """매물관리 칸 자동저장. **매물이 있어야 한다**(0226 — 등록 안 한 건물엔 못 적는다)."""
    bad = set(body.fields) - BIZ_FIELDS
    if bad:
        raise HTTPException(422, f"허용되지 않은 필드: {sorted(bad)}")
    # 전화번호는 읽기와 같은 경계로 쓰기도 막는다(S0M §3.4 예외 2곳).
    # 안 막으면 마스킹된 값(010-****-5678)을 보는 팀원이 그대로 저장해 진짜 번호를 덮는다.
    lid = await need_listing(user.team_id, body.listing_id)
    if "owner_phone" in body.fields:
        cur = await pool().fetchval("SELECT assignee_account_id FROM app.listing_office WHERE listing_id=$1", lid)
        if not (user.role == "owner" or user.account_id == cur):
            raise HTTPException(403, "전화번호는 담당자 본인 또는 대표만 수정할 수 있습니다")
    import datetime as dt
    own = {OWNER_FIELDS[k]: v for k, v in body.fields.items() if k in OWNER_FIELDS}
    if any(v is not None and not isinstance(v, str) for v in own.values()):
        raise HTTPException(422, "소유자 칸은 글자")
    lst = {k: v for k, v in body.fields.items() if k in LISTING_FIELDS}

    if own:
        # 소유자 값이 오면 사람 행을 만들거나 갱신한다. 이 매물에 아직 사람이 안 붙어 있으면
        # 새로 만든다 — 매물 하나에 소유자 하나(0058)라 여기서 갈라질 일이 없다.
        oid = await pool().fetchval("SELECT owner_id FROM app.listing_office WHERE listing_id=$1", lid)
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
            await pool().execute("UPDATE app.listing_office SET owner_id=$2 WHERE listing_id=$1", lid, oid)


        cols = ", ".join(f'"{c}"=${i}' for i, c in enumerate(own, start=2))
        await pool().execute(
            f"UPDATE app.owners SET {cols}, updated_at=now() WHERE id=$1", oid, *own.values())

    # 가격은 거울 동사로(0173 · 0224) — 이력(field_events)이 거기 있다
    prices = {k: lst.pop(k) for k in ("sale_price", "ask_price") if k in lst}
    if prices:
        parsed = {}
        for k, v in prices.items():
            if v is None or str(v).strip() == "":
                parsed[k] = None
            else:
                try:
                    parsed[k] = int(float(str(v).replace(",", "")))
                except ValueError:
                    raise HTTPException(422, f"{k}는 숫자")
        await listing_values_write(user.team_id, lid, parsed, user.account_id)

    if lst:
        sets, args = [], [lid]
        for i, (k, v) in enumerate(lst.items(), start=2):
            sets.append(f'"{k}"=${i}')
            if k == "building_use":
                # 소분류 — 사전(ref.enums building_use)에 있는 것만, 빈 목록은 null(0182)
                vals = [x for x in (v or []) if isinstance(x, str) and x.strip()] if isinstance(v, list) else None
                if v is not None and not isinstance(v, list):
                    raise HTTPException(422, "building_use 는 목록")
                if vals:
                    ok = {r["code"] for r in await pool().fetch(
                        "SELECT code FROM ref.enums WHERE enum_key='building_use' AND active")}
                    if set(vals) - ok:
                        raise HTTPException(422, f"모르는 소분류: {sorted(set(vals) - ok)}")
                args.append(list(dict.fromkeys(vals)) if vals else None)
            elif k in ("exclusive", "loan_open"):
                if v is not None and not isinstance(v, bool):
                    raise HTTPException(422, f"{k} 는 참·거짓")
                args.append(True if (k == "loan_open" and v is None) else v)
            elif isinstance(v, (bool, list)):
                raise HTTPException(422, f"{k}는 글자")
            elif k in ("received_on", "sell_on", "move_in_on") and v is not None:
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
        await pool().execute(f"UPDATE app.listing_office SET {', '.join(sets)} WHERE listing_id=$1", *args)
        if VALUE_FOLD & set(lst):
            await listing_values_fold(lid)
    return {"ok": True}


@router.get("", openapi_extra={"x-ai": "read"})   # AI 가 부를 수 있다(10-AI §3-3)
async def my_listings(user: CurrentUser = Depends(current_user)):
    """내 매물 목록 = 팀의 등록(담당자 있는) 매물."""
    rows = await pool().fetch(
        """SELECT l.id AS listing_id, l.pnu, l.assignee_account_id, app.parcel_addr(l.pnu) AS addr
           FROM app.office_listings l
           WHERE l.team_id=$1 AND l.assignee_account_id IS NOT NULL
           ORDER BY l.updated_at DESC""",
        user.team_id,
    )
    return [dict(r) for r in rows]
