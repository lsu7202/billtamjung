"""문의(상담요청) — S05 §4 · S09 고객관리 = 문의 관리(2026-10-04).

보내기는 누구나(any_user). 받은 문의는 광고를 올린 팀만(current_user) — 고객관리.
상태: 미확인 · 상담중 · 종료. 고객등록(문의 → 매수자 · 매물)은 없앴다 — 고객관리는 매물과 잇지 않는다(0213).
문의 순간 고객이 적어 둔 배경을 profile_snap 으로 떠 둔다 — 고객이 나중에 프로필을 고쳐도 받은 문의는 그대로.
"""
import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core.db import pool
from ..core.deps import current_user, any_user, CurrentUser

router = APIRouter(tags=["inquiries"])

KINDS = ("매수 문의", "매도 문의", "시세 문의")
STATUS = ("미확인", "상담중", "종료")
SNAP_COLS = "goal, build_intent, regions, budget_min, budget_max, budget_any, equity_won, timing, experience, is_corp, note"


async def profile_snapshot(con, account_id: int) -> str | None:
    """문의 순간의 고객 배경(customer_profile) 사본 — 칸이 하나도 없으면 null(지어내지 않는다)"""
    r = await con.fetchrow(f"SELECT {SNAP_COLS} FROM app.customer_profile WHERE account_id=$1", account_id)
    if not r:
        return None
    d = {k: v for k, v in dict(r).items() if v not in (None, [], "")}
    return json.dumps(d, ensure_ascii=False, default=str) if d else None


async def wants_snapshot(con, account_id: int) -> str | None:
    """문의 순간 고객이 프로필에 저장한 조건(내 저장한 조건) 사본 — [{name, conditions_json}]. 없으면 null"""
    rows = await con.fetch(
        """SELECT name, conditions_json FROM app.saved_searches
            WHERE account_id=$1 AND buyer_id IS NULL AND closed_at IS NULL ORDER BY created_at DESC LIMIT 10""", account_id)
    out = [{"name": r["name"], "conditions_json": json.loads(r["conditions_json"]) if isinstance(r["conditions_json"], str)
            else r["conditions_json"]} for r in rows]
    return json.dumps(out, ensure_ascii=False) if out else None


class InquiryIn(BaseModel):
    ad_id: int
    kind: str
    body: str | None = None
    name: str
    phone: str
    consent: bool
    sell_addr: str | None = None      # 매도 문의 — 팔려는 건물 주소(비워도 된다, 0194)
    # 프로필이 비어 있으면 폼에서 바로 고르는 세 칸(S09 §2) — 고르면 프로필에도 남는다. 안 골라도 된다
    goal: list[str] | None = None
    budget_min: int | None = None
    budget_max: int | None = None
    timing: str | None = None


@router.post("/inquiries", status_code=201)
async def send_inquiry(body: InquiryIn, user: CurrentUser = Depends(any_user)):
    if body.kind not in KINDS:
        raise HTTPException(422, "문의 유형은 매수 · 매도 · 시세")
    if not body.consent:
        raise HTTPException(422, "개인정보 제공에 동의해야 보낼 수 있습니다")
    if not body.name.strip() or not body.phone.strip():
        raise HTTPException(422, "이름과 전화를 적으세요")
    if body.body and len(body.body) > 200:
        raise HTTPException(422, "내용은 200자까지")
    ad = await pool().fetchrow(
        """SELECT l.team_id, a.listing_id FROM app.ads a JOIN app.listings l ON l.id = a.listing_id
            WHERE a.id = $1 AND a.state = '노출' AND a.expires_on >= current_date""", body.ad_id)
    if not ad:
        raise HTTPException(404, "지금 노출 중인 광고가 아닙니다")
    if user.team_id is not None and ad["team_id"] == user.team_id:
        raise HTTPException(409, "우리 팀 광고에는 문의할 수 없습니다")
    from .customer import GOALS, TIMING
    if body.goal and any(g not in GOALS for g in body.goal):
        raise HTTPException(422, "목표는 시세차익 · 수익률 · 실사용")
    if body.timing not in (None, *TIMING):
        raise HTTPException(422, "시기는 3개월 안 · 6개월 안 · 1년 안 · 미정")
    async with pool().acquire() as con, con.transaction():
        # 폼에서 고른 칸은 프로필의 **빈 칸만** 채운다 — 고객이 프로필에 적어 둔 값을 덮지 않는다
        if body.goal or body.budget_min is not None or body.budget_max is not None or body.timing:
            await con.execute(
                """INSERT INTO app.customer_profile(account_id, goal, budget_min, budget_max, timing, updated_at)
                   VALUES($1,$2,$3,$4,$5,now())
                   ON CONFLICT (account_id) DO UPDATE SET
                     goal = COALESCE(app.customer_profile.goal, EXCLUDED.goal),
                     budget_min = COALESCE(app.customer_profile.budget_min, EXCLUDED.budget_min),
                     budget_max = COALESCE(app.customer_profile.budget_max, EXCLUDED.budget_max),
                     timing = COALESCE(app.customer_profile.timing, EXCLUDED.timing), updated_at = now()""",
                user.account_id, body.goal or None, body.budget_min, body.budget_max, body.timing)
        snap = await profile_snapshot(con, user.account_id)
        wants = await wants_snapshot(con, user.account_id)
        iid = await con.fetchval(
            """INSERT INTO app.inquiries(ad_id, team_id, account_id, kind, body, name, phone, consent_at, sell_addr,
                                         profile_snap, wants_snap, listing_id)
               VALUES($1,$2,$3,$4,$5,$6,$7,now(),$8,$9::jsonb,$10::jsonb,$11) RETURNING id""",
            body.ad_id, ad["team_id"], user.account_id, body.kind, (body.body or "").strip() or None,
            body.name.strip(), body.phone.strip(),
            (body.sell_addr or "").strip() or None if body.kind == "매도 문의" else None,
            snap, wants, ad["listing_id"])
    return {"id": iid}


@router.get("/inquiries")
async def list_inquiries(user: CurrentUser = Depends(current_user)):
    """받은 문의 — 미확인이 위, 그 안에서 최근 순. 고객 배경은 **문의 순간 사본**(profile_snap)을 싣는다.
    same_n = 같은 고객 계정이 우리 팀에 보낸 문의 수(「이 고객의 다른 문의」)."""
    rows = await pool().fetch(
        """SELECT i.id, i.kind, i.body, i.name, i.phone, i.status, i.sell_addr, i.created_at, i.updated_at,
                  i.ad_id, i.seek_id, i.account_id, COALESCE(lp.pnu, sk.pnu) AS pnu, a.title AS ad_title,
                  COALESCE(app.parcel_addr(COALESCE(lp.pnu, sk.pnu)), '') AS addr,
                  i.profile_snap, i.wants_snap, i.buyer_id, bu.name AS buyer_name, hb.name AS handled_name,
                  count(*) OVER (PARTITION BY i.account_id) AS same_n,
                  (SELECT count(*) FROM app.inquiry_notes n WHERE n.inquiry_id = i.id) AS note_n
             FROM app.inquiries i
             LEFT JOIN app.ads a ON a.id = i.ad_id
             LEFT JOIN app.listing_parcels lp ON lp.listing_id = i.listing_id AND lp.main   -- 주소는 매물 · 구해요의 지번에서
             LEFT JOIN app.seeks sk ON sk.id = i.seek_id
             LEFT JOIN app.accounts hb ON hb.id = i.handled_by
             LEFT JOIN app.buyers bu ON bu.id = i.buyer_id AND bu.deleted_at IS NULL
            WHERE i.team_id = $1
            ORDER BY (i.status = '미확인') DESC, i.created_at DESC LIMIT 500""", user.team_id)
    out = []
    for r in rows:
        d = dict(r)
        for k in ("profile_snap", "wants_snap"):
            d[k] = json.loads(d[k]) if isinstance(d[k], str) else d[k]
        out.append(d)
    return out


@router.get("/inquiries/count")
async def count_inquiries(user: CurrentUser = Depends(current_user)):
    """윗메뉴 「고객관리」 숫자 점 — 미확인 수."""
    n = await pool().fetchval("SELECT count(*) FROM app.inquiries WHERE team_id = $1 AND status = '미확인'", user.team_id)
    return {"unread": int(n or 0)}


class StatusIn(BaseModel):
    status: str


@router.patch("/inquiries/{iid}")
async def set_status(iid: int, body: StatusIn, user: CurrentUser = Depends(current_user)):
    """상태 칩 — 미확인 · 상담중 · 종료."""
    if body.status not in STATUS:
        raise HTTPException(422, "상태는 미확인 · 상담중 · 종료")
    n = await pool().execute(
        "UPDATE app.inquiries SET status=$3, handled_by=$4, updated_at=now() WHERE id=$1 AND team_id=$2",
        iid, user.team_id, body.status, user.account_id)
    if n.endswith(" 0"):
        raise HTTPException(404, "문의가 없습니다")
    return {"ok": True}


@router.post("/inquiries/{iid}/customer")
async def to_customer(iid: int, user: CurrentUser = Depends(current_user)):
    """고객으로 등록(S09 §2) — 문의를 우리 팀 고객 기록에 붙인다. 매물과는 잇지 않는다.
    · 같은 계정의 고객이 이미 있으면 그 고객에 붙인다(칸은 안 건드린다 — 중개사가 쓴 값을 덮지 않는다)
    · 없으면 새 고객을 만들고 문의 당시 배경 사본으로 칸을 **처음 한 번** 채운다. 담당 = 누른 사람
    · 문의 당시 조건 사본은 그 고객에 붙은 저장한 조건이 된다(새 고객일 때만)"""
    async with pool().acquire() as con, con.transaction():
        i = await con.fetchrow("SELECT * FROM app.inquiries WHERE id=$1 AND team_id=$2", iid, user.team_id)
        if not i:
            raise HTTPException(404, "문의가 없습니다")
        if i["buyer_id"]:
            return {"buyer_id": i["buyer_id"], "created": False}
        bid = await con.fetchval(
            "SELECT id FROM app.buyers WHERE team_id=$1 AND account_id=$2 AND deleted_at IS NULL", user.team_id, i["account_id"])
        created = bid is None
        if created:
            p = json.loads(i["profile_snap"]) if isinstance(i["profile_snap"], str) else (i["profile_snap"] or {})
            bid = await con.fetchval(
                """INSERT INTO app.buyers(team_id, assignee_account_id, account_id, name, phone, source,
                                          goal, build_intent, timing, experience, equity_won, budget_min, budget_max,
                                          budget_any, regions, is_corp)
                   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id""",
                user.team_id, user.account_id, i["account_id"], i["name"], i["phone"],
                "구해요" if i["seek_id"] else "광고",
                p.get("goal") or None, p.get("build_intent"), p.get("timing"), p.get("experience"), p.get("equity_won"),
                p.get("budget_min"), p.get("budget_max"), p.get("budget_any"), p.get("regions") or None, p.get("is_corp"))
            wants = json.loads(i["wants_snap"]) if isinstance(i["wants_snap"], str) else (i["wants_snap"] or [])
            for w in wants:
                await con.execute(
                    """INSERT INTO app.saved_searches(account_id, name, conditions_json, team_id, buyer_id)
                       VALUES($1,$2,$3,$4,$5)""",
                    user.account_id, w.get("name") or "조건", json.dumps(w.get("conditions_json") or {}), user.team_id, bid)
        # 같은 계정의 다른 문의도 같이 붙인다 — 한 고객에 문의가 모인다
        await con.execute(
            "UPDATE app.inquiries SET buyer_id=$3, updated_at=now() WHERE team_id=$1 AND account_id=$2 AND buyer_id IS NULL",
            user.team_id, i["account_id"], bid)
    return {"buyer_id": bid, "created": created}


class NoteIn(BaseModel):
    body: str


async def _mine(iid: int, team_id: int):
    if not await pool().fetchval("SELECT 1 FROM app.inquiries WHERE id=$1 AND team_id=$2", iid, team_id):
        raise HTTPException(404, "문의가 없습니다")


@router.get("/inquiries/{iid}/notes")
async def list_notes(iid: int, user: CurrentUser = Depends(current_user)):
    """상담 메모 — 오래된 것이 위(대화처럼 읽힌다)."""
    await _mine(iid, user.team_id)
    rows = await pool().fetch(
        """SELECT n.id, n.body, n.created_at, a.name AS author FROM app.inquiry_notes n
             LEFT JOIN app.accounts a ON a.id = n.account_id
            WHERE n.inquiry_id = $1 ORDER BY n.created_at""", iid)
    return [dict(r) for r in rows]


@router.post("/inquiries/{iid}/notes", status_code=201)
async def add_note(iid: int, body: NoteIn, user: CurrentUser = Depends(current_user)):
    """메모 한 줄 — 원문 그대로. 상태는 안 건드린다(상태는 사람이 고른다)."""
    text = body.body.strip()
    if not text:
        raise HTTPException(422, "내용을 적으세요")
    await _mine(iid, user.team_id)
    nid = await pool().fetchval(
        "INSERT INTO app.inquiry_notes(inquiry_id, account_id, body) VALUES($1,$2,$3) RETURNING id",
        iid, user.account_id, text)
    return {"id": nid}


@router.delete("/inquiries/{iid}/notes/{nid}")
async def del_note(iid: int, nid: int, user: CurrentUser = Depends(current_user)):
    await _mine(iid, user.team_id)
    await pool().execute("DELETE FROM app.inquiry_notes WHERE id=$1 AND inquiry_id=$2", nid, iid)
    return {"ok": True}


@router.get("/inquiries/mine")
async def my_inquiries(user: CurrentUser = Depends(any_user)):
    """내가 보낸 상담요청(S05 §1 「내 문의 내역」) — 받은 쪽 상태를 그대로 보인다."""
    rows = await pool().fetch(
        """SELECT i.id, i.kind, i.body, i.status, i.created_at, COALESCE(lp.pnu, sk.pnu) AS pnu,
                  a.title AS ad_title, COALESCE(t.office_name, t.name) AS office_name,
                  COALESCE(app.parcel_addr(COALESCE(lp.pnu, sk.pnu)), '') AS addr
             FROM app.inquiries i
             LEFT JOIN app.listing_parcels lp ON lp.listing_id = i.listing_id AND lp.main
             LEFT JOIN app.ads a ON a.id = i.ad_id
             LEFT JOIN app.seeks sk ON sk.id = i.seek_id
             LEFT JOIN app.teams t ON t.id = i.team_id
            WHERE i.account_id = $1 ORDER BY i.created_at DESC LIMIT 100""", user.account_id)
    return [dict(r) for r in rows]
