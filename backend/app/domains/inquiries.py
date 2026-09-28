"""문의(상담요청) — S05 §4 · 2묶음(2026-09-28).

보내기는 누구나(any_user). 받은 문의는 광고를 올린 팀만(current_user) — 고객관리의 「문의」 칸.
상태: 미확인 → 상담중 → 고객등록 · 종료. 고객등록하면 매수 문의는 매수자가, 매도 문의는 매물이 된다.
"""
import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core.db import pool
from ..core.deps import current_user, any_user, CurrentUser

router = APIRouter(tags=["inquiries"])

KINDS = ("매수 문의", "매도 문의", "시세 문의")
STATUS = ("미확인", "상담중", "고객등록", "종료")


class InquiryIn(BaseModel):
    ad_id: int
    kind: str
    body: str | None = None
    name: str
    phone: str
    consent: bool
    sell_addr: str | None = None      # 매도 문의 — 팔려는 건물 주소(비워도 된다, 0194)


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
        "SELECT team_id FROM app.ads WHERE id = $1 AND state = '노출' AND expires_on >= current_date", body.ad_id)
    if not ad:
        raise HTTPException(404, "지금 노출 중인 광고가 아닙니다")
    if user.team_id is not None and ad["team_id"] == user.team_id:
        raise HTTPException(409, "우리 팀 광고에는 문의할 수 없습니다")
    iid = await pool().fetchval(
        """INSERT INTO app.inquiries(ad_id, team_id, account_id, kind, body, name, phone, consent_at, sell_addr)
           VALUES($1,$2,$3,$4,$5,$6,$7,now(),$8) RETURNING id""",
        body.ad_id, ad["team_id"], user.account_id, body.kind, (body.body or "").strip() or None,
        body.name.strip(), body.phone.strip(),
        (body.sell_addr or "").strip() or None if body.kind == "매도 문의" else None)
    return {"id": iid}


@router.get("/inquiries")
async def list_inquiries(user: CurrentUser = Depends(current_user)):
    """받은 문의 — 미확인이 위, 그 안에서 최근 순. 고객 프로필(0191)이 있으면 같이 싣는다."""
    rows = await pool().fetch(
        """SELECT i.id, i.kind, i.body, i.name, i.phone, i.status, i.sell_addr, i.created_at,
                  i.buyer_id, i.listing_id, i.ad_id, a.building_pk, a.title AS ad_title,
                  COALESCE(b.addr, '') AS addr,
                  cp.intent, cp.literacy, cp.purposes, cp.regions, cp.budget_min, cp.budget_max, cp.note AS profile_note
             FROM app.inquiries i
             LEFT JOIN app.ads a ON a.id = i.ad_id
             LEFT JOIN master.buildings b ON b.building_pk = a.building_pk
             LEFT JOIN app.customer_profile cp ON cp.account_id = i.account_id
            WHERE i.team_id = $1
            ORDER BY (i.status = '미확인') DESC, i.created_at DESC LIMIT 200""", user.team_id)
    return [dict(r) for r in rows]


@router.get("/inquiries/count")
async def count_inquiries(user: CurrentUser = Depends(current_user)):
    """윗메뉴 「고객관리」 숫자 점 — 미확인 수."""
    n = await pool().fetchval("SELECT count(*) FROM app.inquiries WHERE team_id = $1 AND status = '미확인'", user.team_id)
    return {"unread": int(n or 0)}


class StatusIn(BaseModel):
    status: str


@router.patch("/inquiries/{iid}")
async def set_status(iid: int, body: StatusIn, user: CurrentUser = Depends(current_user)):
    """상태 칩 — 고객등록은 /register 로만 된다(매수자 · 매물이 같이 생겨야 해서)."""
    if body.status not in ("미확인", "상담중", "종료"):
        raise HTTPException(422, "상태는 미확인 · 상담중 · 종료(고객등록은 따로)")
    n = await pool().execute(
        "UPDATE app.inquiries SET status=$3, handled_by=$4, updated_at=now() WHERE id=$1 AND team_id=$2 "
        "AND status <> '고객등록'", iid, user.team_id, body.status, user.account_id)
    if n.endswith(" 0"):
        raise HTTPException(409, "고객등록한 문의는 상태를 바꾸지 않습니다")
    return {"ok": True}


class RegisterIn(BaseModel):
    listing_pk: str | None = None     # 매도 문의 — 매물 담기 창에서 담은 건물(그 뒤에 부른다)


@router.post("/inquiries/{iid}/register")
async def register(iid: int, body: RegisterIn, user: CurrentUser = Depends(current_user)):
    """고객등록.
    · 매수 문의 → 매수자를 만든다(이름 · 전화, 등급 = 고객이 적은 의사, 유입 = 광고)
    · 매도 문의 → 화면이 매물 담기 창을 열어 매물을 먼저 담고, 그 건물로 여기를 부른다
    · 시세 문의 → 매수자로(시세를 묻는 사람은 대개 살 사람이다. 아니면 종료로 닫는다)"""
    i = await pool().fetchrow(
        """SELECT i.*, cp.intent FROM app.inquiries i
             LEFT JOIN app.customer_profile cp ON cp.account_id = i.account_id
            WHERE i.id = $1 AND i.team_id = $2""", iid, user.team_id)
    if not i:
        raise HTTPException(404, "문의가 없습니다")
    if i["status"] == "고객등록":
        return {"buyer_id": i["buyer_id"], "listing_id": i["listing_id"]}
    if i["kind"] == "매도 문의":
        if not body.listing_pk:
            raise HTTPException(422, "매물을 먼저 담으세요")
        lid = await pool().fetchval("SELECT id FROM app.listings WHERE building_pk=$1 AND team_id=$2",
                                    body.listing_pk, user.team_id)
        if not lid:
            raise HTTPException(404, "담긴 매물이 아닙니다")
        await pool().execute(
            "UPDATE app.inquiries SET status='고객등록', listing_id=$3, handled_by=$4, updated_at=now() "
            "WHERE id=$1 AND team_id=$2", iid, user.team_id, lid, user.account_id)
        return {"listing_id": lid}
    memo = f"[{i['kind']}] {dt.date.today():%y.%m.%d} 광고 문의" + (f" — {i['body']}" if i["body"] else "")
    bid = await pool().fetchval(
        """INSERT INTO app.buyers(team_id, assignee_account_id, name, phone, grade, source, memo)
           VALUES($1,$2,$3,$4,$5,'광고',$6) RETURNING id""",
        user.team_id, user.account_id, i["name"], i["phone"], i["intent"], memo)
    await pool().execute(
        "UPDATE app.inquiries SET status='고객등록', buyer_id=$3, handled_by=$4, updated_at=now() "
        "WHERE id=$1 AND team_id=$2", iid, user.team_id, bid, user.account_id)
    return {"buyer_id": bid}
