"""영업관리(S04) — 매수자 · 제안 · 접촉이력.

설계 근거 = specs/03-features/S04-영업관리.md
핵심: 매수자 조건은 `saved_searches.conditions_json`과 **같은 모양**이다.
      조건 편집 = 상세검색 모달, 매칭 = 검색 엔진. 규칙이 한 벌이라 결과가 어긋나지 않는다.
"""
import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core.db import pool
from ..core.deps import current_user, CurrentUser

router = APIRouter(tags=["sales"])

# 제안 상태 — 보드의 열. '후보'가 있어야 "골라놓고 아직 안 돌린 것"이 안 샌다.
STATUSES = ("후보", "제안", "관심", "거절", "계약")
# 거절 사유 — 집계가 목적이라 카테고리를 적게 두고 겹치지 않게 한다.
# buyer_side(매수자 사정)를 분리하지 않으면 '매물 탓 거절'과 섞여 어떤 집계든 거짓이 된다.
REJECT_REASONS = ("price", "roi", "location", "condition", "size",
                  "meongdo", "tenant", "use", "buyer_side", "etc")


def _row(r) -> dict:
    d = dict(r)
    v = d.get("conditions_json")
    if isinstance(v, str):
        d["conditions_json"] = json.loads(v)
    return d


# ── 매수자 ──────────────────────────────────────────────
class BuyerIn(BaseModel):
    name: str
    phone: str | None = None
    grade: str | None = None
    source: str | None = None
    is_corp: bool | None = None
    status: str = "활성"
    memo: str | None = None
    conditions: dict = {}
    assignee_account_id: int | None = None


@router.get("/buyers")
async def list_buyers(user: CurrentUser = Depends(current_user)):
    """팀의 매수자 목록 + 제안 진행 수(보드로 안 가도 상태가 보이게)."""
    rows = await pool().fetch(
        """SELECT b.*,
                  (SELECT count(*) FROM app.proposals p
                    WHERE p.buyer_id = b.id AND p.status <> '거절') AS active_proposals
           FROM app.buyers b
           WHERE b.team_id = $1 AND b.deleted_at IS NULL
           ORDER BY b.updated_at DESC""",
        user.team_id)
    return [_row(r) for r in rows]


@router.post("/buyers", status_code=201)
async def create_buyer(body: BuyerIn, user: CurrentUser = Depends(current_user)):
    if not body.name.strip():
        raise HTTPException(422, "이름이 필요합니다")
    bid = await pool().fetchval(
        """INSERT INTO app.buyers
             (team_id, assignee_account_id, name, phone, grade, source, is_corp, status, memo, conditions_json)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id""",
        user.team_id, body.assignee_account_id or user.account_id, body.name.strip(),
        body.phone, body.grade, body.source, body.is_corp, body.status, body.memo,
        json.dumps(body.conditions))
    return {"id": bid}


class BuyerPatch(BaseModel):
    """부분 수정 — 넘어온 것만 갱신한다(이름만 바꿔도 조건이 날아가면 안 된다)."""
    name: str | None = None
    phone: str | None = None
    grade: str | None = None
    source: str | None = None
    is_corp: bool | None = None
    status: str | None = None
    memo: str | None = None
    conditions: dict | None = None
    assignee_account_id: int | None = None


@router.patch("/buyers/{bid}")
async def update_buyer(bid: int, body: BuyerPatch, user: CurrentUser = Depends(current_user)):
    n = await pool().execute(
        """UPDATE app.buyers SET
             name = COALESCE($3, name), phone = COALESCE($4, phone),
             grade = COALESCE($5, grade), source = COALESCE($6, source),
             is_corp = COALESCE($7, is_corp), status = COALESCE($8, status),
             memo = COALESCE($9, memo),
             conditions_json = COALESCE($10::jsonb, conditions_json),
             assignee_account_id = COALESCE($11, assignee_account_id)
           WHERE id=$1 AND team_id=$2 AND deleted_at IS NULL""",
        bid, user.team_id, body.name, body.phone, body.grade, body.source, body.is_corp,
        body.status, body.memo,
        json.dumps(body.conditions) if body.conditions is not None else None,
        body.assignee_account_id)
    if n.endswith(" 0"):
        raise HTTPException(404, "매수자를 찾을 수 없습니다")
    return {"ok": True}


@router.delete("/buyers/{bid}")
async def delete_buyer(bid: int, user: CurrentUser = Depends(current_user)):
    """소프트 삭제 — 개인정보라 흔적을 남기되 목록에서 빠진다."""
    await pool().execute(
        "UPDATE app.buyers SET deleted_at = now() WHERE id=$1 AND team_id=$2", bid, user.team_id)
    return {"ok": True}


# ── 제안 ────────────────────────────────────────────────
class ProposalIn(BaseModel):
    buyer_id: int
    building_pk: str
    status: str = "후보"
    channel: str | None = None
    report_id: int | None = None
    note: str | None = None


@router.get("/proposals")
async def list_proposals(buyer_id: int | None = None, building_pk: str | None = None,
                         user: CurrentUser = Depends(current_user)):
    """제안 목록. 매물 값은 building_pk로 조인해서 붙인다 —
    엑셀이 매수자별로 옮겨 적던 열(면적·가격·수익률)을 사람이 다시 치지 않게 하는 것이 1차 가치."""
    rows = await pool().fetch(
        """SELECT p.*, y.name AS buyer_name, y.grade AS buyer_grade,
                  b.addr, b.land_area, b.total_area, b.use_zone,
                  COALESCE(so.v::numeric, se.sale_est) AS price,
                  (so.v IS NULL) AS price_is_est
           FROM app.proposals p
           JOIN app.buyers y ON y.id = p.buyer_id
           LEFT JOIN master.buildings b ON b.building_pk = p.building_pk
           LEFT JOIN master.building_sale_est se ON se.building_pk = p.building_pk
           LEFT JOIN LATERAL (SELECT value AS v FROM app.overlays o
                               WHERE o.team_id = p.team_id AND o.target_type='building'
                                 AND o.target_id = p.building_pk AND o.field='sale_price'
                                 AND o.value ~ '^[0-9.]+$') so ON TRUE
           WHERE p.team_id = $1
             AND ($2::bigint IS NULL OR p.buyer_id = $2)
             AND ($3::text IS NULL OR p.building_pk = $3)
           ORDER BY p.updated_at DESC""",
        user.team_id, buyer_id, building_pk)
    return [dict(r) for r in rows]


@router.post("/proposals", status_code=201)
async def create_proposal(body: ProposalIn, user: CurrentUser = Depends(current_user)):
    """같은 (매수자, 매물)이면 새 행을 만들지 않는다 — 중복 제안을 구조로 막는다.
    이미 있으면 상태만 올리고 재제안 횟수를 센다."""
    if body.status not in STATUSES:
        raise HTTPException(422, f"상태는 {'/'.join(STATUSES)} 중 하나")
    sent = body.status in ("제안", "관심", "계약")
    pid = await pool().fetchval(
        """INSERT INTO app.proposals
             (team_id, buyer_id, building_pk, status, channel, report_id, note, created_by,
              proposed_on, propose_count)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,
                  CASE WHEN $9 THEN current_date END, CASE WHEN $9 THEN 1 ELSE 0 END)
           ON CONFLICT (team_id, buyer_id, building_pk) DO UPDATE SET
             status = EXCLUDED.status,
             channel = COALESCE(EXCLUDED.channel, app.proposals.channel),
             report_id = COALESCE(EXCLUDED.report_id, app.proposals.report_id),
             note = COALESCE(EXCLUDED.note, app.proposals.note),
             proposed_on = COALESCE(app.proposals.proposed_on, EXCLUDED.proposed_on),
             propose_count = app.proposals.propose_count + CASE WHEN $9 THEN 1 ELSE 0 END,
             updated_at = now()
           RETURNING id""",
        user.team_id, body.buyer_id, body.building_pk, body.status, body.channel,
        body.report_id, body.note, user.account_id, sent)
    return {"id": pid}


class ProposalPatch(BaseModel):
    status: str | None = None
    channel: str | None = None
    note: str | None = None
    reject_reason: str | None = None
    reject_reason_sub: list[str] | None = None
    reject_price: int | None = None


@router.patch("/proposals/{pid}")
async def update_proposal(pid: int, body: ProposalPatch, user: CurrentUser = Depends(current_user)):
    if body.status and body.status not in STATUSES:
        raise HTTPException(422, f"상태는 {'/'.join(STATUSES)} 중 하나")
    # 거절은 사유가 있어야 한다 — 사유 없는 거절은 나중에 아무것도 못 읽는다.
    if body.status == "거절" and not body.reject_reason:
        raise HTTPException(422, "거절 사유가 필요합니다")
    if body.reject_reason and body.reject_reason not in REJECT_REASONS:
        raise HTTPException(422, f"거절 사유 코드가 올바르지 않습니다: {body.reject_reason}")
    sent = body.status in ("제안", "관심", "계약")
    n = await pool().execute(
        """UPDATE app.proposals SET
             status = COALESCE($3, status),
             channel = COALESCE($4, channel),
             note = COALESCE($5, note),
             reject_reason = COALESCE($6, reject_reason),
             reject_reason_sub = COALESCE($7, reject_reason_sub),
             reject_price = COALESCE($8, reject_price),
             proposed_on = CASE WHEN $9 AND proposed_on IS NULL THEN current_date ELSE proposed_on END,
             propose_count = propose_count + CASE WHEN $9 AND proposed_on IS NULL THEN 1 ELSE 0 END
           WHERE id=$1 AND team_id=$2""",
        pid, user.team_id, body.status, body.channel, body.note,
        body.reject_reason, body.reject_reason_sub, body.reject_price, sent)
    if n.endswith(" 0"):
        raise HTTPException(404, "제안을 찾을 수 없습니다")
    return {"ok": True}


@router.delete("/proposals/{pid}")
async def delete_proposal(pid: int, user: CurrentUser = Depends(current_user)):
    await pool().execute("DELETE FROM app.proposals WHERE id=$1 AND team_id=$2", pid, user.team_id)
    return {"ok": True}


# ── 접촉 이력 ───────────────────────────────────────────
class ContactIn(BaseModel):
    target_type: str      # buyer | listing
    target_id: str
    kind: str | None = None
    occurred_on: str | None = None
    note: str | None = None


@router.get("/contacts")
async def list_contacts(target_type: str, target_id: str,
                        user: CurrentUser = Depends(current_user)):
    rows = await pool().fetch(
        """SELECT * FROM app.contacts
           WHERE team_id=$1 AND target_type=$2 AND target_id=$3
           ORDER BY occurred_on DESC, id DESC LIMIT 100""",
        user.team_id, target_type, target_id)
    return [dict(r) for r in rows]


@router.post("/contacts", status_code=201)
async def create_contact(body: ContactIn, user: CurrentUser = Depends(current_user)):
    if body.target_type not in ("buyer", "listing"):
        raise HTTPException(422, "target_type은 buyer 또는 listing")
    cid = await pool().fetchval(
        """INSERT INTO app.contacts(team_id, target_type, target_id, kind, occurred_on, note, created_by)
           VALUES($1,$2,$3,$4,COALESCE($5::date, current_date),$6,$7) RETURNING id""",
        user.team_id, body.target_type, body.target_id, body.kind,
        body.occurred_on, body.note, user.account_id)
    return {"id": cid}
