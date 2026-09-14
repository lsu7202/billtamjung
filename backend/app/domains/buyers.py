"""영업관리(S04) — 매수자 · 제안 · 접촉이력.

설계 근거 = specs/03-features/S04-영업관리.md
핵심: 매수자 조건은 `saved_searches.conditions_json`과 **같은 모양**이다.
      조건 편집 = 상세검색 모달, 매칭 = 검색 엔진. 규칙이 한 벌이라 결과가 어긋나지 않는다.
"""
import datetime as dt
import json
import re as _re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..core.db import pool, tx
from ..core.deps import current_user, CurrentUser
# 거울 동사는 전부 mirror.py 한 곳 — 커밋↔일정↔참석자↔가격이 같은 함수로 오간다.
# 여기서 인라인으로 다시 쓰면 반쪽 거울이 또 생긴다(2026-08-14 QA의 교훈).
from .mirror import (
    iso_date as _d, iso_time as _t, has_money as _has_money,
    mirror_to_listing, mirror_to_proposal,
    schedule_create, schedule_retract, schedule_log, schedule_set_state,
    attendees_sync, apply_sched_op, event_mark, event_unmark, resolve_anchor, mirror_skips,
    SCHED_CATEGORIES,
    overlays_write, overlays_restore, proposal_prices_prev, proposal_prices_restore,
)

router = APIRouter(tags=["sales"])

# 짝(매수자×매물)에는 **상태 칸이 없다**(0141). 상태는 사실에서 파생한다 — app.nego_rank:
#   0 죽음(dropped_at) · 1 합의 전 · 2 합의중(브리핑 or 매수희망가) · 3 계약예정(picked_at)
#   4 계약완료 · 5 중도금 · 6 거래종료(각각 그 종류의 일정이 완료됐을 때)
#
# 예전엔 status 칸('후보'·'제안'·'계약'·'철회'·'계약파기')이 따로 있었고 그게 사고를 냈다:
# 브리핑 뒤 값을 조절하며 흥정하는 내내 '제안'에 멈춰 있어 「10일째 답 없음」이 매일 떴다.
# 화면(nego_rank)은 「합의중」인데 카드(status)는 거짓말을 했다 — 사실 하나에 값 둘이면
# 반드시 갈라진다. 그래서 값을 없애고 사실만 남겼다.
#
# **거절도 상태가 아니다.** 거절은 보류로 적는다(app.stops · target_type='proposal') —
# 한 번 적고 끝나는 값이 아니라 사유가 줄로 서고 사람이 풀 수 있어야 하기 때문이다.


def _can_see(user: CurrentUser, assignee: int | None) -> bool:
    """개인정보 경계 — 담당자 본인 + 대표만. 매물 소유자 전화번호와 같은 규칙(S0M §3.4)."""
    return user.role == "owner" or user.account_id == assignee


def _mask(phone: str | None) -> str | None:
    if not phone:
        return phone
    return phone[:3] + "-****-" + phone[-4:] if len(phone) >= 8 else "****"


def _row(r, user: CurrentUser | None = None) -> dict:
    d = dict(r)
    v = d.get("conditions_json")
    if isinstance(v, str):
        d["conditions_json"] = json.loads(v)
    # 매수자 연락처도 개인정보다. 팀 전체 공유(R7)의 예외 — 매물 전화번호와 같은 급인데
    # 매수자만 뚫려 있었다(권한 QA 2026-08-09).
    if user is not None and not _can_see(user, d.get("assignee_account_id")):
        d["phone"] = _mask(d.get("phone"))
        d["phone_masked"] = True
    return d


# ── 매수자 ──────────────────────────────────────────────
class BuyerIn(BaseModel):
    name: str
    phone: str | None = None
    grade: str | None = None
    source: str | None = None
    is_corp: bool | None = None
    memo: str | None = None
    assignee_account_id: int | None = None
    age_band: str | None = None
    cooperation: str | None = None
    kindness: str | None = None
    exclusive: str | None = None
    gender: str | None = None
    # 업무 사다리(0090) — 본인/대리인(공동중개 상대는 매수자 명단에 그대로 한 줄로 선다) · 긴급도
    is_agent: bool | None = None
    urgency: str | None = None


@router.get("/buyers", openapi_extra={"x-ai": "read"})   # AI 가 부를 수 있다(10-AI §3-3)
async def list_buyers(user: CurrentUser = Depends(current_user)):
    """팀의 매수자 목록 + 담긴 매물 수(보드로 안 가도 상태가 보이게)."""
    rows = await pool().fetch(
        """SELECT b.*,
                  (SELECT count(*) FROM app.proposals p
                    WHERE p.buyer_id = b.id AND p.dropped_at IS NULL) AS active_proposals,
                  -- 사람 상태는 저장하지 않는다(0087) — 사실에서 파생한다
                  CASE WHEN EXISTS (SELECT 1 FROM app.proposals p2
                                     WHERE p2.buyer_id = b.id AND p2.dropped_at IS NULL) THEN '진행중'
                       WHEN GREATEST(
                              COALESCE((SELECT max(c.occurred_on) FROM app.contacts c
                                         WHERE c.team_id=b.team_id AND c.target_type='buyer'
                                           AND c.target_id=b.id::text), b.created_at::date),
                              b.created_at::date) >= current_date - 30 THEN '활성'
                       ELSE '휴면' END AS activity,
                  -- ②사다리(0092) — 준비도. 합의 단계(nego)와 다른 층이다
                  vb.stage AS b_stage, vb.b1_buyer, vb.b4_match, vb.b4_open, vb.cells,
                  -- 대표 쌍의 거래 칸(2026-08-19) — 목록의 점이 레일과 같은 말을 하려면
                  -- 계약 뒤(잔금·신고)까지 실려야 한다. 대표는 **계약 상대**가 1순위.
                  ld.d7_pay, ld.d8_file, ld.cells AS deal_cells,
                  -- 협의 단계(0127) — 담은 매물들 중 가장 앞선 것
                  COALESCE((SELECT max(app.nego_rank(p5)) FROM app.proposals p5
                             WHERE p5.buyer_id = b.id), 0) AS nego,
                  -- 이 사람이 **계약을 마쳤나**(2026-08-20) — 목록을 「매수자 / 계약」으로
                  -- 가르는 축이고, 추천에서도 빠진다. 판정은 레일과 같다(계약 일정 완료).
                  EXISTS (SELECT 1 FROM app.proposals pd
                           JOIN app.schedules sd ON sd.proposal_id = pd.id
                                                AND sd.category = '계약' AND sd.state = '완료'
                          WHERE pd.buyer_id = b.id AND pd.picked_at IS NOT NULL
                            AND pd.dropped_at IS NULL) AS dealt,
                  st.id AS stop_id, st.stage AS stop_stage, st.reason AS stop_reason
           FROM app.buyers b
           LEFT JOIN app.v_buyer_stage vb ON vb.id = b.id
           LEFT JOIN LATERAL (
               SELECT vp.d7_pay, vp.d8_file, vp.cells
                 FROM app.proposals p3
                 JOIN app.v_proposal_stage vp ON vp.id = p3.id
                WHERE p3.buyer_id = b.id AND p3.dropped_at IS NULL
                ORDER BY (p3.picked_at IS NOT NULL) DESC, p3.id DESC
                LIMIT 1) ld ON TRUE
           LEFT JOIN app.stops st ON st.team_id = b.team_id AND st.target_type='buyer'
                 AND st.target_id = b.id::text AND st.resolved_at IS NULL
           WHERE b.team_id = $1 AND b.deleted_at IS NULL
           ORDER BY b.updated_at DESC""",
        user.team_id)
    # 조건은 세트가 여러 개다 — 한 사람이 "종로 수익형"과 "강남 신축부지"를 같이 들고 다닌다.
    conds = await pool().fetch(
        """SELECT id, buyer_id, name, conditions_json FROM app.buyer_conditions
           WHERE team_id=$1 ORDER BY id""", user.team_id)
    by: dict[int, list] = {}
    for c in conds:
        d = dict(c)
        if isinstance(d["conditions_json"], str):
            d["conditions_json"] = json.loads(d["conditions_json"])
        by.setdefault(d["buyer_id"], []).append(d)
    return [{**_row(r, user), "conditions": by.get(r["id"], [])} for r in rows]


@router.post("/buyers", status_code=201)
async def create_buyer(body: BuyerIn, user: CurrentUser = Depends(current_user)):
    if not body.name.strip():
        raise HTTPException(422, "이름이 필요합니다")
    bid = await pool().fetchval(
        """INSERT INTO app.buyers
             (team_id, assignee_account_id, name, phone, grade, source, is_corp, memo,
              age_band, cooperation, kindness, exclusive, gender, is_agent, urgency)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id""",
        user.team_id, body.assignee_account_id or user.account_id, body.name.strip(),
        body.phone, body.grade, body.source, body.is_corp, body.memo,
        body.age_band, body.cooperation, body.kindness, body.exclusive, body.gender,
        bool(body.is_agent), body.urgency)
    return {"id": bid}


class BuyerPatch(BaseModel):
    """부분 수정 — 넘어온 것만 갱신한다(이름만 바꿔도 조건이 날아가면 안 된다)."""
    name: str | None = None
    phone: str | None = None
    grade: str | None = None
    source: str | None = None
    is_corp: bool | None = None
    memo: str | None = None
    assignee_account_id: int | None = None
    age_band: str | None = None
    cooperation: str | None = None
    kindness: str | None = None
    exclusive: str | None = None
    gender: str | None = None
    is_agent: bool | None = None
    urgency: str | None = None
    call_result: str | None = None   # 대화창 통화 칩이 쓴다(0092) — 부분 patch
    # 계약서 인적사항(0128) — 주민등록번호는 칸 자체가 없다
    addr: str | None = None
    rep_name: str | None = None
    corp_no: str | None = None
    nationality: str | None = None
    # 투자 가정(0133) — 자기자본·금리·부대비용률. 매물이 아니라 그 사람의 형편이라 여기 산다.
    # 숫자라 빈 문자열 어법을 못 쓴다 — 비우기는 clear 로.
    equity_won: int | None = None
    loan_rate: float | None = None
    fee_pct: float | None = None
    # 불리언은 빈 문자열 어법을 못 쓴다 — 비우기는 명시 목록으로(is_corp·is_agent)
    clear: list[str] | None = None


@router.patch("/buyers/{bid}")
async def update_buyer(bid: int, body: BuyerPatch, user: CurrentUser = Depends(current_user)):
    # 연락처는 읽기와 같은 경계로 쓰기도 막는다 — 마스킹된 값을 그대로 저장해 원본을 덮는 사고를 막는다.
    if body.phone is not None:
        cur = await pool().fetchval(
            "SELECT assignee_account_id FROM app.buyers WHERE id=$1 AND team_id=$2", bid, user.team_id)
        if not _can_see(user, cur):
            raise HTTPException(403, "연락처는 담당자 본인 또는 대표만 수정할 수 있습니다")
    n = await pool().execute(
        # **빈 문자열은 「지운다」**(2026-08-19) — COALESCE 만 쓰면 null 이 「그대로 두기」라
        # 메모를 비워도 옛 값이 남았다. 안 보낸 것(null)과 비운 것('')은 다른 뜻이다.
        """UPDATE app.buyers SET
             name = COALESCE($3, name),
             phone = CASE WHEN $4::text IS NULL THEN phone WHEN $4::text = '' THEN NULL ELSE $4::text END,
             grade = CASE WHEN $5::text IS NULL THEN grade WHEN $5::text = '' THEN NULL ELSE $5::text END,
             source = CASE WHEN $6::text IS NULL THEN source WHEN $6::text = '' THEN NULL ELSE $6::text END,
             is_corp = COALESCE($7, is_corp),
             memo = CASE WHEN $8::text IS NULL THEN memo WHEN $8::text = '' THEN NULL ELSE $8::text END,
             assignee_account_id = COALESCE($9, assignee_account_id),
             age_band = CASE WHEN $10::text IS NULL THEN age_band WHEN $10::text = '' THEN NULL ELSE $10::text END,
             cooperation = CASE WHEN $11::text IS NULL THEN cooperation WHEN $11::text = '' THEN NULL ELSE $11::text END,
             kindness = CASE WHEN $12::text IS NULL THEN kindness WHEN $12::text = '' THEN NULL ELSE $12::text END,
             exclusive = CASE WHEN $13::text IS NULL THEN exclusive WHEN $13::text = '' THEN NULL ELSE $13::text END,
             gender = CASE WHEN $14::text IS NULL THEN gender WHEN $14::text = '' THEN NULL ELSE $14::text END,
             is_agent = COALESCE($15, is_agent),
             urgency = CASE WHEN $16::text IS NULL THEN urgency WHEN $16::text = '' THEN NULL ELSE $16::text END,
             call_result = CASE WHEN $17::text IS NULL THEN call_result WHEN $17::text = '' THEN NULL ELSE $17::text END,
             addr = CASE WHEN $18::text IS NULL THEN addr WHEN $18::text = '' THEN NULL ELSE $18::text END,
             rep_name = CASE WHEN $19::text IS NULL THEN rep_name WHEN $19::text = '' THEN NULL ELSE $19::text END,
             corp_no = CASE WHEN $20::text IS NULL THEN corp_no WHEN $20::text = '' THEN NULL ELSE $20::text END,
             nationality = CASE WHEN $21::text IS NULL THEN nationality WHEN $21::text = '' THEN NULL ELSE $21::text END,
             equity_won = COALESCE($22::bigint, equity_won),
             loan_rate = COALESCE($23::numeric, loan_rate),
             fee_pct = COALESCE($24::numeric, fee_pct)
           WHERE id=$1 AND team_id=$2 AND deleted_at IS NULL""",
        bid, user.team_id, body.name, body.phone, body.grade, body.source, body.is_corp,
        body.memo, body.assignee_account_id,
        body.age_band, body.cooperation, body.kindness, body.exclusive, body.gender,
        body.is_agent, body.urgency, body.call_result,
        body.addr, body.rep_name, body.corp_no, body.nationality,
        body.equity_won, body.loan_rate, body.fee_pct)
    if body.clear:
        ok_clear = set(body.clear) & {"is_corp", "is_agent", "equity_won", "loan_rate", "fee_pct"}
        if ok_clear:
            sets = ", ".join(f"{c} = NULL" for c in sorted(ok_clear))
            await pool().execute(
                f"UPDATE app.buyers SET {sets} WHERE id=$1 AND team_id=$2 AND deleted_at IS NULL",
                bid, user.team_id)
    if n.endswith(" 0"):
        raise HTTPException(404, "매수자를 찾을 수 없습니다")
    return {"ok": True}


@router.delete("/buyers/{bid}")
async def delete_buyer(bid: int, user: CurrentUser = Depends(current_user)):
    """소프트 삭제 — 개인정보라 흔적을 남기되 목록에서 빠진다.
    조건 세트는 같이 지운다. 사람이 빠졌는데 그 사람의 검색 조건만 DB에 남을 이유가 없다
    (매칭 쿼리는 활성 매수자만 보지만, 안 쓰는 행을 남기면 다음 사람이 헷갈린다)."""
    async with pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "UPDATE app.buyers SET deleted_at = now() WHERE id=$1 AND team_id=$2", bid, user.team_id)
            await conn.execute(
                "DELETE FROM app.buyer_conditions WHERE buyer_id=$1 AND team_id=$2", bid, user.team_id)
    return {"ok": True}


# ── 매수자 조건 세트 ────────────────────────────────────
class CondIn(BaseModel):
    name: str = "조건"
    conditions: dict = {}


@router.post("/buyers/{bid}/conditions", status_code=201)
async def add_condition(bid: int, body: CondIn, user: CurrentUser = Depends(current_user)):
    owned = await pool().fetchval(
        "SELECT 1 FROM app.buyers WHERE id=$1 AND team_id=$2 AND deleted_at IS NULL", bid, user.team_id)
    if not owned:
        raise HTTPException(404, "매수자를 찾을 수 없습니다")
    cid = await pool().fetchval(
        """INSERT INTO app.buyer_conditions(team_id, buyer_id, name, conditions_json)
           VALUES($1,$2,$3,$4) RETURNING id""",
        user.team_id, bid, body.name.strip() or "조건", json.dumps(body.conditions))
    return {"id": cid}


@router.patch("/conditions/{cid}")
async def update_condition(cid: int, body: CondIn, user: CurrentUser = Depends(current_user)):
    n = await pool().execute(
        """UPDATE app.buyer_conditions SET name=$3, conditions_json=$4
           WHERE id=$1 AND team_id=$2""",
        cid, user.team_id, body.name.strip() or "조건", json.dumps(body.conditions))
    if n.endswith(" 0"):
        raise HTTPException(404, "조건을 찾을 수 없습니다")
    return {"ok": True}


@router.delete("/conditions/{cid}")
async def delete_condition(cid: int, user: CurrentUser = Depends(current_user)):
    await pool().execute("DELETE FROM app.buyer_conditions WHERE id=$1 AND team_id=$2", cid, user.team_id)
    return {"ok": True}


# ── 짝(매수자 × 매물) ───────────────────────────────────
class ProposalIn(BaseModel):
    buyer_id: int
    building_pk: str
    report_id: int | None = None
    note: str | None = None


@router.get("/proposals")
async def list_proposals(buyer_id: int | None = None, building_pk: str | None = None,
                         user: CurrentUser = Depends(current_user)):
    """짝(매수자×매물) 목록. 매물 값은 building_pk로 조인해서 붙인다 —
    엑셀이 매수자별로 옮겨 적던 열(면적·가격·수익률)을 사람이 다시 치지 않게 하는 것이 1차 가치."""
    rows = await pool().fetch(
        """SELECT p.*, y.name AS buyer_name, y.grade AS buyer_grade,
                  y.addr AS buyer_addr, y.rep_name AS buyer_rep_name,
                  y.corp_no AS buyer_corp_no, y.nationality AS buyer_nationality,
                  y.is_corp AS buyer_is_corp,
                  -- 매수자 전화(0128 문서 씨앗) — 열람 경계는 목록과 같다: 담당자 본인·대표만
                  CASE WHEN $4::bigint = y.assignee_account_id OR $5::text = 'owner'
                       THEN y.phone END AS buyer_phone,
                  ns.*,
                  b.addr, b.land_area, b.total_area, b.use_zone, cs.cell_sched,
                  plog.price_log, sl2.scheds,
                  COALESCE(so.v::numeric, se.sale_est) AS price,
                  (so.v IS NULL) AS price_is_est,
                  -- 카드에 값 판단 재료를 같이 낸다. "3.2억"만 있으면 비싼지 싼지 모른다.
                  se.sale_est, sc.use_type,
                  CASE WHEN se.sale_est > 0 AND so.v IS NOT NULL
                       THEN round((so.v::numeric / se.sale_est - 1) * 100, 1) END AS vs_est_pct,
                  -- 수익률 = **총임대료 × 12** ÷ 값(0134). 검색·상세와 같은 분자다.
                  -- 예전엔 여기만 마스터 추정(re.annual_rent)을 써서, 팀이 층별 임대를 다 넣어도
                  -- 매수자 화면만 추정으로 계산했다.
                  CASE WHEN COALESCE(fa.rent_total, l2.total_rent) > 0
                        AND COALESCE(so.v::numeric, se.sale_est) > 0
                       THEN round(COALESCE(fa.rent_total, l2.total_rent) * 12.0
                                  / COALESCE(so.v::numeric, se.sale_est) * 100, 2) END AS roi,
                  -- 연임대(원) = 총임대료 × 12. 투자 시뮬의 수입 쪽(0133·0134).
                  -- 마스터 추정을 안 쓴다: ROE는 레버리지가 걸려 임대 오차가 몇 배로 증폭된다.
                  COALESCE(fa.rent_total, l2.total_rent) * 12.0 AS annual_rent,
                  p.hope_price, p.deal_price,
                  ph.id AS photo_id,
                  -- ③사다리(0093) — 준비도. nego_rank(합의~거래종료)와 다른 층이다
                  vps.stage AS d_stage, vps.cells AS deal_cells,
                  -- 이 매수자가 **다른 매물에서** 계약을 마쳤나(2026-08-20).
                  -- 한 사람이 어디선가 사면 남은 후보 자리는 사실상 죽는다 — 화면이 스스로 알아야 한다.
                  EXISTS (SELECT 1 FROM app.proposals p9
                           JOIN app.schedules s9 ON s9.proposal_id = p9.id
                                                AND s9.category = '계약' AND s9.state = '완료'
                          WHERE p9.buyer_id = p.buyer_id AND p9.id <> p.id
                            AND p9.picked_at IS NOT NULL)                    AS buyer_dealt,
                  -- 이 **매물**이 다른 매수자와 계약을 마쳤나 — 그러면 이 쌍은 끝난 자리다
                  EXISTS (SELECT 1 FROM app.proposals p8
                           JOIN app.schedules s8 ON s8.proposal_id = p8.id
                                                AND s8.category = '계약' AND s8.state = '완료'
                          WHERE p8.building_pk = p.building_pk AND p8.team_id = p.team_id
                            AND p8.id <> p.id AND p8.picked_at IS NOT NULL)   AS listing_dealt,
                  vps.d2_brief, vps.d3_visit, vps.d4_nego,
                  vps.d5_pre, vps.d6_sign, vps.d7_pay, vps.d8_file,
                  st.id AS stop_id, st.reason AS stop_reason,
                  -- 합의 단계(0138·0141) — 짝의 상태는 이 하나다. 낱말은 words.ts NEGO
                  app.nego_rank(p) AS nego
           FROM app.proposals p
           LEFT JOIN app.v_proposal_stage vps ON vps.id = p.id
           LEFT JOIN app.stops st ON st.team_id = p.team_id AND st.target_type='proposal'
                 AND st.target_id = p.id::text AND st.resolved_at IS NULL
           -- 소프트 삭제된 매수자의 짝은 보드에서 뺀다. 사람은 목록에서 사라졌는데
           -- 그 사람 카드만 보드에 남으면 눌러도 갈 곳이 없다(2026-08-09 QA).
           JOIN app.buyers y ON y.id = p.buyer_id AND y.deleted_at IS NULL
           LEFT JOIN master.buildings b ON b.building_pk = p.building_pk
           LEFT JOIN master.building_sale_est se ON se.building_pk = p.building_pk
           LEFT JOIN master.building_score sc ON sc.building_pk = p.building_pk
           LEFT JOIN master.building_rent_est re ON re.building_pk = p.building_pk
           -- 임대 총계의 정본(0134) — 층별 실측이 있으면 그 합계, 없으면 직접 적은 총액.
           -- 하이브리드(팀 입력 + 미입력층 대장 추정)는 폐지했다: 한 숫자에 실측과 추정을 안 섞는다.
           LEFT JOIN app.listings l2 ON l2.building_pk = p.building_pk AND l2.team_id = p.team_id
           LEFT JOIN LATERAL (SELECT SUM(rent) AS rent_total, count(*) AS rows
                                FROM app.floor_rents fr
                               WHERE fr.building_pk = p.building_pk AND fr.team_id = p.team_id
                                 AND fr.deleted_at IS NULL) fa ON TRUE
           -- 팀이 올린 사진 한 장(외관 우선) — 제안 카드 썸네일
           LEFT JOIN LATERAL (SELECT id FROM app.photos f
                               WHERE f.building_pk = p.building_pk AND f.team_id = p.team_id
                                 AND f.deleted_at IS NULL
                               ORDER BY (f.kind = 'exterior') DESC, f.sort_order, f.id
                               LIMIT 1) ph ON TRUE
           LEFT JOIN LATERAL (SELECT value AS v FROM app.overlays o
                               WHERE o.team_id = p.team_id AND o.target_type='building'
                                 AND o.target_id = p.building_pk AND o.field='sale_price'
                                 AND o.value ~ '^[0-9.]+$') so ON TRUE
           LEFT JOIN LATERAL (SELECT s.title AS next_sched_title, s.on_date AS next_sched_on,
                                     s.at_time AS next_sched_at
                                FROM app.schedules s
                               WHERE s.team_id = $1 AND s.building_pk = p.building_pk
                                 AND s.state='예정' AND s.on_date >= current_date
                               ORDER BY s.on_date, s.at_time NULLS LAST LIMIT 1) ns ON TRUE
           -- 이 쌍에 걸린 일정(2026-08-19) — 창에서 만든 약속이 창에 그대로 보여야 한다.
           -- 매물의 일정 중 이 매수자가 참석자인 것 + 매물 전체 약속(참석자 없는 것)도 함께.
           LEFT JOIN LATERAL (
             SELECT jsonb_agg(jsonb_build_object('id', z.id, 'title', z.title, 'cat', z.category,
                                                 'on', z.on_date, 'at', z.at_time, 'state', z.state,
                                                 'method', z.method, 'amount', z.amount, 'id2', z.id)
                              ORDER BY z.on_date DESC) AS scheds
               FROM (SELECT s3.id, s3.title, s3.category, s3.on_date, s3.at_time, s3.state, s3.method, s3.amount
                       FROM app.schedules s3
                      WHERE s3.team_id = p.team_id AND s3.proposal_id = p.id
                      ORDER BY s3.on_date DESC LIMIT 8) z) sl2 ON TRUE
           -- 오간 값(2026-08-19) — 「저번에 얼마 불렀더라」가 다음 수를 정한다.
           -- 정본은 값 이력(app.field_events·0109)이다. 최근 6개만 본다.
           LEFT JOIN LATERAL (
             SELECT jsonb_agg(jsonb_build_object('side', t.side, 'price', t.price,
                                                 'on', t.created_at::date)
                              ORDER BY t.created_at, t.id) AS price_log
               FROM (SELECT e.id, e.created_at, e.value::bigint AS price,
                            CASE WHEN e.field='hope_price' THEN '매수' ELSE '합의' END AS side
                       FROM app.field_events e
                      WHERE e.target_type='proposal' AND e.target_id = p.id::text
                        AND e.field IN ('hope_price','deal_price') AND e.value ~ '^[0-9]+$'
                      ORDER BY e.id DESC LIMIT 6) t) plog ON TRUE
           -- 칸별 약속(2026-08-18) — 거래 칸은 **일정이 정본**이다: 잡았나(예정) · 했나(완료).
           -- 창이 제 날짜를 따로 갖던 것을 접는다 — 캘린더와 두 벌이 되면 반드시 어긋난다.
           LEFT JOIN LATERAL (
             SELECT jsonb_object_agg(k.cell, to_jsonb(k) - 'cell') AS cell_sched FROM (
               SELECT c3.cell,
                      max(s2.on_date) FILTER (WHERE s2.state='완료')             AS done_on,
                      min(s2.on_date) FILTER (WHERE s2.state='예정')             AS due_on,
                      (array_agg(s2.method ORDER BY s2.on_date DESC)
                        FILTER (WHERE s2.state='예정'))[1]                       AS due_how,
                      (array_agg(s2.id ORDER BY s2.on_date DESC)
                        FILTER (WHERE s2.state='예정'))[1]                       AS due_id
                 FROM (VALUES ('brief','브리핑'), ('visit','임장'),
                              ('sign','계약'), ('pay','잔금')) AS c3(cell, cat)
                 LEFT JOIN app.schedules s2
                        ON s2.team_id = p.team_id AND s2.category = c3.cat
                       AND (s2.proposal_id = p.id
                            OR (s2.proposal_id IS NULL AND s2.building_pk = p.building_pk))
                GROUP BY c3.cell) k) cs ON TRUE
           WHERE p.team_id = $1
             AND ($2::bigint IS NULL OR p.buyer_id = $2)
             AND ($3::text IS NULL OR p.building_pk = $3)
           ORDER BY p.updated_at DESC""",
        user.team_id, buyer_id, building_pk, user.account_id, user.role)
    return [dict(r) for r in rows]


@router.post("/proposals", status_code=201)
async def create_proposal(body: ProposalIn, user: CurrentUser = Depends(current_user)):
    """매수자에게 매물을 **담는다**. 같은 (매수자, 매물)이면 새 행을 만들지 않는다 —
    중복을 구조로 막는다(유니크). 담기는 사실 하나뿐이라 상태를 받지 않는다(0141)."""
    # 있는 건물만 담긴다(2026-08-19) — 없는 번호로 담기면 주소가 없어 화면에 **고유번호**가
    # 그대로 뜬다(짝 표엔 외래키가 없다). 담는 입구에서 막는다.
    if not await pool().fetchval(
            """SELECT 1 FROM master.buildings WHERE building_pk=$1
               UNION ALL
               SELECT 1 FROM master.vacant_parcels WHERE 'P' || pnu = $1""", body.building_pk):
        raise HTTPException(422, "없는 건물입니다")
    # 담긴 매물은 **내 목록에 있어야 한다**(2026-08-19). 검색에서 아무 건물이나 담을 수 있는데,
    # 목록에 없으면 매수자 쪽엔 붙어 있고 매물 탭엔 없는 유령이 된다.
    # 그래서 담는 순간 **관심**으로 들어온다(소유자를 붙이면 그때 매물로 승격 — 기존 규칙).
    await pool().execute(
        """INSERT INTO app.listings(building_pk, team_id) VALUES($1,$2)
           ON CONFLICT (building_pk, team_id) DO NOTHING""",
        body.building_pk, user.team_id)
    pid = await pool().fetchval(
        """INSERT INTO app.proposals(team_id, buyer_id, building_pk, report_id, note, created_by)
           VALUES($1,$2,$3,$4,$5,$6)
           ON CONFLICT (team_id, buyer_id, building_pk) DO UPDATE SET
             report_id = COALESCE(EXCLUDED.report_id, app.proposals.report_id),
             note = COALESCE(EXCLUDED.note, app.proposals.note),
             dropped_at = NULL,          -- 다시 담으면 살아난다
             updated_at = now()
           RETURNING id""",
        user.team_id, body.buyer_id, body.building_pk, body.report_id, body.note,
        user.account_id)
    # 담기만 한 것은 **장부에 안 쓴다**(0057 이후). 예전엔 담는 순간 「후보」 기록이 자동으로
    # 깔렸는데, 그 줄에는 아무 내용이 없었다 — 왜 이 사람에게 이 매물인지가 빠진 빈 줄이다.
    # 첫 줄은 사람이 직접 쓴다: 「역세권이고 예산에 맞아서」. 그게 담은 사유다.
    return {"id": pid}


class PersonIn(BaseModel):
    """이 약속에 오는 사람. 우리 장부에 있는 사람(buyer/owner)이거나, **이름만 아는 사람**(guest).
    이름을 안 밝히고 떠보는 전화도 고객이다 — 이름 석 자를 전제하면 아예 못 적는다."""
    kind: str                       # buyer · owner · guest
    ref_id: int | None = None
    label: str | None = None
    phone: str | None = None


class ScheduleIn(BaseModel):
    """파서가 커밋에서 읽은 약속(0070) — 「다음주 수에 브리핑 하기로함」.
    날짜가 하나로 떨어지는 것만 온다(0071) — 창만 있는 말은 파서가 아예 안 만든다."""
    title: str
    on: str
    at: str | None = None        # HH:MM — 안 말했으면 None(0073). 지어내지 않는다
    place: str | None = None     # 장소 — 「사무실에서」·「법무사에서」(0075)
    hint: str | None = None
    # 사람이 모달에서 정한 값(0075) — 안 주면 커밋이 난 자리의 상대가 자동으로 붙는다
    people: list[PersonIn] | None = None
    assignee_account_id: int | None = None
    # 일정 종류(0088) — 일반·브리핑·임장·계약·중도금·잔금. 모달 토글이 정본
    category: str | None = None
    # 브리핑 방식(0111) — 만나서·전화·자료 발송. 약속 카드에 적히고, 소화하면 브리핑 값이 된다
    method: str | None = None
    # 계약·중도금·잔금 금액(0112) — 계약 일정에 적은 금액은 **그 쌍의 확정가**가 된다(0115)
    amount: int | None = None
    # 창에서 붙인 매물(명시 닻) — 참석자 추론(resolve_anchor)보다 세다. 모달이 본 기능이다
    building_pk: str | None = None


class SchedOpIn(BaseModel):
    """커밋이 **있던 약속**을 손대는 말을 품었을 때(0072) — 「브리핑 다음주로 미룸」."""
    op: str                      # move · cancel · done
    title: str | None = None
    at: str | None = None        # HH:MM — 「브리핑 3시로」처럼 시각만 옮길 때


class ProposalPatch(BaseModel):
    """짝을 고친다. 칸은 **사실뿐**이다(0141) — 상태·제안·거절 칸은 없다.
    「이 사람은 이 매물 안 산다」는 보류(POST /stops · target_type='proposal')로 적는다."""
    note: str | None = None               # 메모 — 이 매수자의 장부에 한 줄로 선다
    cell: str | None = None               # 어느 칸에서 적었나(0104) — 그 칸의 줄로 선다
    hope_price: int | None = None         # 매수희망가(0064) — 「이 값이면 사겠다」
    deal_price: int | None = None         # 거래가(0069) — 합의된 값
    dropped: bool | None = None           # 죽이기/되살리기 — 옛 철회·계약파기 자리
    issued_on: str | None = None          # 언제 있었던 일인가(YYYY-MM-DD)
    schedule: ScheduleIn | None = None    # 문장에서 읽은 약속(0070)
    schedule_op: SchedOpIn | None = None  # 있던 약속 손대기(0072)


# 계약파기는 **한 사건의 양면**이다 — 매수자와의 계약이 깨지면 그 건물의 매도도 깨진다.
# 그래서 짝을 죽이면 매도 장부에도 같은 사실이 선다.
# 보류는 거울이 없다: 이 매수자가 이 매물을 접어도 매물이 사라지진 않는다.
BROKEN = "계약파기"
# 장부 줄이 말하는 **사건** 둘(contacts.status). 상태 칸이 아니다 — 매물에도 짝에도 없다(0141·0142).
# 이 둘만 두 장부 사이를 오간다: 매수자와 계약하면 그 매물도 계약된 것이고, 깨지면 같이 깨진다.
MIRRORED = ("계약", BROKEN)

# **이 매물은 끝났나** — 상태 칸을 없앤 뒤(0142) 판정하는 자리는 여기 하나다.
# 끝 = 살아 있는 짝 하나가 계약 상대로 정해졌다. 낱말이 아니라 사실을 본다.
# `{t}` 에 매물 별칭을 넣어 쓴다: SELLER_DONE.format(t="l")
SELLER_DONE = """EXISTS (SELECT 1 FROM app.proposals pz
                          WHERE pz.team_id = {t}.team_id AND pz.building_pk = {t}.building_pk
                            AND pz.picked_at IS NOT NULL AND pz.dropped_at IS NULL)"""

# **매물로 나와 있나** — 매도 의사를 들었거나, 누군가에게 이미 보여주고 있다(담긴 짝).
SELLER_LIVE = """({t}.intent = '원함'
                  OR EXISTS (SELECT 1 FROM app.proposals pl
                              WHERE pl.team_id = {t}.team_id AND pl.building_pk = {t}.building_pk
                                AND pl.dropped_at IS NULL))"""


@router.patch("/proposals/{pid}")
async def update_proposal(pid: int, body: ProposalPatch, user: CurrentUser = Depends(current_user)):
    """짝의 사실을 고친다 — 값 · 죽음 · 약속 · 메모. **상태를 받지 않는다**(0141).

    상태는 이 칸들에서 파생된다(app.nego_rank). 그래서 「제안했다」를 따로 적을 자리가 없고,
    적을 이유도 없다: 브리핑은 brief_how 가, 「사겠다」는 매수희망가가 이미 사실이다.
    """
    prev = await proposal_prices_prev(user.team_id, pid, body.hope_price, body.deal_price)
    # 값 이력(0109) — 매수희망가·합의가가 어떻게 움직였나(호가판이 이걸 그린다)
    if body.hope_price is not None or body.deal_price is not None:
        old_row = await pool().fetchrow(
            "SELECT hope_price, deal_price FROM app.proposals WHERE id=$1 AND team_id=$2",
            pid, user.team_id)
        for fld, new_v, old_v in (("hope_price", body.hope_price, old_row and old_row["hope_price"]),
                                  ("deal_price", body.deal_price, old_row and old_row["deal_price"])):
            if new_v is not None and new_v != old_v:
                await pool().execute(
                    """INSERT INTO app.field_events(team_id, target_type, target_id, field,
                                                    prev, value, created_by)
                       VALUES($1,'proposal',$2,$3,$4,$5,$6)""",
                    user.team_id, str(pid), fld,
                    str(old_v) if old_v is not None else None, str(new_v), user.account_id)
    row = await pool().fetchrow(
        """UPDATE app.proposals SET
             hope_price = COALESCE($3, hope_price),
             deal_price = COALESCE($4, deal_price),
             dropped_at = CASE WHEN $5::bool IS NULL THEN dropped_at
                               WHEN $5 THEN COALESCE(dropped_at, now()) ELSE NULL END,
             updated_at = now()
           WHERE id=$1 AND team_id=$2
           RETURNING building_pk, buyer_id, picked_at""",
        pid, user.team_id, body.hope_price, body.deal_price, body.dropped)
    if row is None:
        raise HTTPException(404, "짝을 찾을 수 없습니다")
    pk = row["building_pk"]

    at = None
    if body.issued_on:
        try:
            at = dt.datetime.fromisoformat(body.issued_on)
        except ValueError:
            raise HTTPException(422, "issued_on은 YYYY-MM-DD")

    # 메모는 **그 매수자의 장부**에 선다(0141) — 짝마다 장부를 따로 두지 않는다.
    cid = None
    if body.note:
        cid = await pool().fetchval(
            """INSERT INTO app.contacts(team_id, target_type, target_id, kind, note,
                                        occurred_on, created_by, prev, proposal_id)
               VALUES($1,'buyer',$2,'메모',$3, COALESCE($4, current_date),$5,$6,$7) RETURNING id""",
            user.team_id, str(row["buyer_id"]), body.note,
            at.date() if at else None, user.account_id, prev, pid)

    # 캘린더로 가는 것 둘(0070) — ① 문장이 품은 약속 ② 계약파기(일어난 날이 찾아볼 값이다)
    own_sid = evt_sid = None
    if pk and body.schedule_op:
        await apply_sched_op(user.team_id, pk, body.schedule_op,
                             _d(body.schedule.on) if body.schedule else None,
                             "buy", proposal_id=pid)
    elif pk and body.schedule:
        own_sid = await schedule_create(user.team_id, "buy", body.schedule, user.account_id,
                                        building_pk=pk, contact_id=cid, proposal_id=pid)
        # 계약 일정에 적은 금액 = 그 쌍의 **확정가**(2026-08-19). 값이 두 곳에 따로 살면
        # 어긋나므로 일정에서 받은 금액을 쌍에 그대로 물린다(거울).
        if body.schedule.category == "계약" and body.schedule.amount:
            await pool().execute(
                "UPDATE app.proposals SET deal_price=$3 WHERE id=$1 AND team_id=$2",
                pid, user.team_id, body.schedule.amount)

    # 계약까지 갔던 짝이 죽으면 그건 **계약파기**다 — 매도 장부에도 같은 사실이 선다(0067).
    if body.dropped and row["picked_at"] is not None and pk:
        evt_sid = await event_mark(
            user.team_id, "buy", BROKEN, at.date() if at else dt.date.today(),
            user.account_id, building_pk=pk, contact_id=cid, proposal_id=pid,
            own_sid=own_sid, explicit_day=at is not None)
        await mirror_to_listing(user.team_id, pid, BROKEN, user.account_id, evt_sid=evt_sid)
    return {"ok": True, "contact_id": cid}


@router.get("/buyers/{bid}/events")
async def buyer_events(bid: int, limit: int = 12, user: CurrentUser = Depends(current_user)):
    """이 **사람**의 최근 움직임 — 시간순. 장부는 하나다(app.contacts · 0141)."""
    rows = await pool().fetch(
        """SELECT c.id, c.status, c.note, c.occurred_on, c.created_at, c.kind,
                  a.name AS by_name
           FROM app.contacts c
           LEFT JOIN app.accounts a ON a.id = c.created_by
           WHERE c.team_id = $1 AND c.target_type = 'buyer' AND c.target_id = $2
           ORDER BY c.occurred_on DESC, c.id DESC
           LIMIT $3""", user.team_id, str(bid), min(limit, 50))
    return [dict(r) for r in rows]


@router.get("/sales/find")
async def find_target(q: str, user: CurrentUser = Depends(current_user)):
    """문장에서 **누구(어느 매물) 얘기인지**를 찾는다 — 하단 대화창의 대상 찾기.

    언어 이해가 아니라 목록 조회다. 팀의 사람·매물은 수십~수백이라 파이썬에서 맞춘다
    (SQL 한 방보다 규칙을 읽고 고치기 쉽다 — 이 규칙은 자주 다듬게 된다).

    맞추는 차례(숫자가 작을수록 세다):
      ① 이름 통째        「윤미경 내일 2시」
      ② 매물번호         「BT-1112 잔금」
      ③ 주소 조각        「49-9 자식들이 반대」 · 「삼성동 27-12」
      ④ 전화 뒷 4자리    「0000 통화함」
      ⑤ 성 + 호칭        「윤 사장님」

    같이 주는 것: 어느 길로 맞았는지(via)와 그 매물(building_pk·proposal_id) —
    「BT-1112 잔금」은 사람 장부가 아니라 **그 매물 장부**에 적혀야 한다.
    """
    t = (q or "").strip()
    if len(t) < 2:
        return []
    rows = await pool().fetch(
        """SELECT 'owner' AS kind, o.id, o.name, o.phone,
                  l.building_pk, l.listing_no, b.addr,
                  NULL::bigint AS proposal_id
             FROM app.owners o
             LEFT JOIN app.listings l ON l.owner_id = o.id AND l.team_id = o.team_id
             LEFT JOIN master.buildings b ON b.building_pk = l.building_pk
            WHERE o.team_id = $1 AND o.deleted_at IS NULL
           UNION ALL
           SELECT 'buyer', y.id, y.name, y.phone,
                  p.building_pk, l.listing_no, b.addr, p.id
             FROM app.buyers y
             LEFT JOIN app.proposals p ON p.buyer_id = y.id AND p.team_id = y.team_id
             LEFT JOIN app.listings l ON l.building_pk = p.building_pk AND l.team_id = y.team_id
             LEFT JOIN master.buildings b ON b.building_pk = p.building_pk
            WHERE y.team_id = $1 AND y.deleted_at IS NULL""", user.team_id)

    import re
    digits = re.sub(r"\D", "", t)
    jibuns = re.findall(r"\d+-\d+", t)
    up = t.upper()

    best: dict[tuple, dict] = {}
    for r in rows:
        name = r["name"] or ""
        rank = 0; via = None
        # 매물 언급은 순위와 **별개로** 본다 — 「문서희 BT-1112 …」는 이름이 순위를 갖지만
        # 매물을 명시했으니 그 매물 장부로 가야 한다(한 줄에 둘 다 있는 게 보통이다).
        hit_listing = bool(r["listing_no"] and r["listing_no"].upper() in up) or \
                      bool(r["addr"] and any(j in r["addr"] for j in jibuns))
        if len(name) >= 2 and name in t:
            rank, via = 1, "name"
        elif r["listing_no"] and r["listing_no"].upper() in up:
            rank, via = 2, "listing"
        elif r["addr"] and any(j in r["addr"] for j in jibuns):
            rank, via = 3, "addr"
        elif r["phone"]:
            tail = re.sub(r"\D", "", r["phone"])[-4:]
            if len(tail) == 4 and tail in digits:
                rank, via = 4, "phone"
        if rank == 0 and name and re.search(
                re.escape(name[0]) + r"\s*(사장|사모|대표|이사|씨|님)", t):
            rank, via = 5, "alias"
        if rank == 0:
            continue
        key = (r["kind"], r["id"])
        cur = best.get(key)
        # 매물 길(listing/addr)로 맞았으면 그 매물을 싣는다. 이름과 매물이 **같이** 있는
        # 문장(「문서희 BT-1112 …」)은 이름이 순위를 갖되 매물 정보는 합쳐 둔다 —
        # 안 합치면 매물을 명시했는데도 사람 장부로 가버린다.
        # 이름만 맞고 매물 언급이 없으면 매물은 비운다(매물이 하나라고 그리로 보내는 건 추측이다).
        via_b = via in ("listing", "addr") or hit_listing
        row_b = {
            "building_pk": r["building_pk"] if via_b else None,
            "addr": r["addr"] if via_b else None,
            "proposal_id": r["proposal_id"] if via_b else None,
        }
        if cur is None:
            # 전화번호는 맞추는 데만 쓰고 응답엔 안 싣는다 — 목록 API 의 마스킹 규칙
            # (담당자+대표만)을 이 길로 우회하면 안 된다
            best[key] = {"kind": r["kind"], "id": r["id"], "name": name,
                         "rank": rank, "via": via, **row_b}
        else:
            if rank < cur["rank"]:
                cur.update(rank=rank, via=via)
            if via_b and cur["building_pk"] is None:
                cur.update(row_b)
    out = sorted(best.values(), key=lambda x: (x["rank"], x["name"]))
    return out[:6]


@router.get("/sales/people")
async def building_people(building_pk: str | None = None,
                          user: CurrentUser = Depends(current_user)):
    """이 매물에 얽힌 사람 전부 — 약속 창에서 참석자로 고른다(0075).

    매도자 하나와 이 매물이 담긴 매수자들. 계약 자리엔 이 사람들이 같이 오고,
    동행 임장도 마찬가지다. 이름을 몰라 못 찾는 사람은 창에서 그대로 적어 넣는다.
    """
    if not building_pk:
        return []
    rows = await pool().fetch(
        """SELECT 'owner' AS kind, o.id AS ref_id, o.name AS label, NULL::text AS sub
             FROM app.listings l JOIN app.owners o ON o.id = l.owner_id AND o.deleted_at IS NULL
            WHERE l.building_pk=$1 AND l.team_id=$2
           UNION ALL
           SELECT 'buyer', y.id, y.name, app.nego_rank(p)::text
             FROM app.proposals p JOIN app.buyers y ON y.id = p.buyer_id AND y.deleted_at IS NULL
            WHERE p.building_pk=$1 AND p.team_id=$2 AND p.dropped_at IS NULL
           ORDER BY 1 DESC, 3""", building_pk, user.team_id)
    return [dict(r) for r in rows]


@router.get("/sales/person-timeline")
async def person_timeline(kind: str, person_id: int, user: CurrentUser = Depends(current_user)):
    """한 **사람**의 모든 기록을 시간순으로 — 매물을 가로질러(0076).

    장부는 하나다(app.contacts · 0141). 매수자는 자기 줄만, 매도자는 자기 줄 + 자기 매물들의 줄.
    짝 창에서 적은 줄은 proposal_id 를 들고 있어 어느 매물 얘기였는지가 남는다.
    읽기 전용 합본이다 — 쓰기는 각 자리에서.
    """
    if kind not in ("buyer", "owner"):
        raise HTTPException(422, "kind는 buyer 또는 owner")
    # 줄에 붙는 약속 — 그 줄이 낳은 것이거나 그 줄을 낳은 것
    SCH = """LEFT JOIN LATERAL (
               SELECT s.title AS sched_title, s.on_date AS sched_on, s.at_time AS sched_at,
                      oc.note AS sched_note
                 FROM app.schedules s
                 LEFT JOIN app.contacts oc ON oc.id = s.contact_id
                WHERE s.contact_id = c.id OR s.id = c.src_schedule_id
                ORDER BY s.id LIMIT 1) sch ON TRUE"""
    if kind == "buyer":
        rows = await pool().fetch(
            f"""SELECT c.id, p.building_pk, b.addr, c.status, c.note,
                       c.kind AS channel, c.auto, a.name AS by_name,
                       CASE WHEN c.occurred_on = c.created_at::date THEN c.created_at
                            ELSE c.occurred_on::timestamptz END AS at,
                       'contact'::text AS src, c.proposal_id, sch.*
                  FROM app.contacts c
                  LEFT JOIN app.accounts a ON a.id = c.created_by
                  LEFT JOIN app.proposals p ON p.id = c.proposal_id
                  LEFT JOIN master.buildings b ON b.building_pk = p.building_pk
                  {SCH}
                 WHERE c.team_id=$1 AND c.target_type='buyer' AND c.target_id = $2
                 ORDER BY at DESC, c.id DESC LIMIT 200""",
            user.team_id, str(person_id))
    else:
        rows = await pool().fetch(
            f"""SELECT * FROM (
                 SELECT c.id, NULL::text AS building_pk, NULL::text AS addr, c.status, c.note,
                        c.kind AS channel, c.auto, a.name AS by_name,
                        CASE WHEN c.occurred_on = c.created_at::date THEN c.created_at
                             ELSE c.occurred_on::timestamptz END AS at,
                        'contact'::text AS src, c.proposal_id, sch.*
                   FROM app.contacts c
                   LEFT JOIN app.accounts a ON a.id = c.created_by
                   {SCH}
                  WHERE c.team_id=$1 AND c.target_type='owner' AND c.target_id = $3
                 UNION ALL
                 -- 이 매도자가 가진 매물들의 기록
                 SELECT c.id, c.target_id, b.addr, c.status, c.note,
                        c.kind, c.auto, a.name,
                        CASE WHEN c.occurred_on = c.created_at::date THEN c.created_at
                             ELSE c.occurred_on::timestamptz END,
                        'contact', c.proposal_id, sch.*
                   FROM app.contacts c
                   JOIN app.listings l ON l.building_pk = c.target_id AND l.team_id = c.team_id
                   LEFT JOIN master.buildings b ON b.building_pk = c.target_id
                   LEFT JOIN app.accounts a ON a.id = c.created_by
                   {SCH}
                  WHERE c.team_id=$1 AND c.target_type='listing' AND l.owner_id = $2
               ) t ORDER BY at DESC, id DESC LIMIT 200""",
            user.team_id, person_id, str(person_id))
    return [dict(r) for r in rows]


@router.get("/sales/timeline")
async def building_timeline(building_pk: str, user: CurrentUser = Depends(current_user)):
    """한 건물에 얽힌 줄 전부를 시간순으로 — 매물 1 : 매도자 1 : 매수자 N 이라
    사람 단위 화면(매도·매수)만으로는 「이 매물에 지금 무슨 일이 벌어지고 있나」가 흩어진다.

    장부는 하나다(app.contacts · 0141). 여기 서는 줄은 둘 —
      · 매도(sell)  이 매물의 줄
      · 매수(buy)   이 매물의 짝에 달린 줄(contacts.proposal_id)
    읽기 전용이다. occurred_on 은 날짜뿐이라 같은 날 안에서는 기록 시각으로 어림한다.
    """
    rows = await pool().fetch(
        """SELECT * FROM (
             SELECT 'buy'::text AS side, y.name AS who, c.status, c.note,
                    CASE WHEN c.occurred_on = c.created_at::date THEN c.created_at
                         ELSE c.occurred_on::timestamptz END AS at,
                    c.auto, a.name AS by_name, c.kind AS channel,
                    c.proposal_id AS event_pid, c.id AS contact_id, sch.*
               FROM app.contacts c
               JOIN app.proposals p ON p.id = c.proposal_id AND p.team_id = $1
               JOIN app.buyers y ON y.id = p.buyer_id
               LEFT JOIN app.accounts a ON a.id = c.created_by
               LEFT JOIN LATERAL (
                 SELECT s.title AS sched_title, s.on_date AS sched_on, s.at_time AS sched_at,
                        oc.note AS sched_note
                   FROM app.schedules s
                   LEFT JOIN app.contacts oc ON oc.id = s.contact_id
                  WHERE s.contact_id = c.id OR s.id = c.src_schedule_id
                  ORDER BY s.id LIMIT 1) sch ON TRUE
              WHERE c.team_id = $1 AND p.building_pk = $2
             UNION ALL
             SELECT 'sell', o.name, c.status, c.note,
                    CASE WHEN c.occurred_on = c.created_at::date THEN c.created_at
                         ELSE c.occurred_on::timestamptz END,
                    c.auto, a.name, c.kind, NULL::bigint, c.id, sch.*
               FROM app.contacts c
               LEFT JOIN app.listings l ON l.building_pk = c.target_id AND l.team_id = c.team_id
               LEFT JOIN app.owners o ON o.id = l.owner_id
               LEFT JOIN app.accounts a ON a.id = c.created_by
               LEFT JOIN LATERAL (
                 SELECT s.title AS sched_title, s.on_date AS sched_on, s.at_time AS sched_at,
                        oc.note AS sched_note
                   FROM app.schedules s
                   LEFT JOIN app.contacts oc ON oc.id = s.contact_id
                  WHERE s.contact_id = c.id OR s.id = c.src_schedule_id
                  ORDER BY s.id LIMIT 1) sch ON TRUE
              WHERE c.team_id = $1 AND c.target_type = 'listing' AND c.target_id = $2
           ) t ORDER BY at, side DESC""",
        user.team_id, building_pk)
    return [dict(r) for r in rows]


class DealPatch(BaseModel):
    """③사다리의 단계 근거 필드(0093) — 브리핑·임장·계약금 일부·수수료·거래신고.
    부분 patch(COALESCE). 저장은 auto 장부줄 한 줄로 묶여 남는다(S04b §7.5)."""
    briefed_on: str | None = None
    visited_on: str | None = None
    visit_note: str | None = None
    pre_contract_on: str | None = None
    pre_contract_amount: int | None = None
    commission_amount: int | None = None
    commission_split: str | None = None    # 단독 · 공동 · 전속
    report_filed_on: str | None = None
    terms: str | None = None               # 조건 협의 — 특약 원문 그대로(0097)
    brief_how: list[str] | None = None     # 브리핑 **어디서**(0123 복수) — 현장·사무실·전화·자료 발송
    brief_note: str | None = None          # 브리핑 **무엇을**(0123) — 한 줄 기록. 이게 곧 「했다」다
    picked: bool | None = None             # 채택(0113) — 이 사람과 간다(가격도 같이 확정)
    pick_price: int | None = None          # 채택 가격 — 확정된 값
    vat_mode: str | None = None            # 부가세 조건(0128) — 별도·포함
    down_payment: int | None = None        # 계약금(0128) — 잔금은 저장 안 함(파생)
    # 되돌리기(2026-08-18) — 실수로 찍은 칸을 비운다. COALESCE 패치라 null 로는 못 지워서
    # 명시 목록으로 받는다. 허용 필드만(아래 _CLEARABLE).
    clear: list[str] | None = None


_CLEARABLE = {"briefed_on", "brief_how", "brief_note", "visited_on", "visit_note", "pre_contract_on",
              "pre_contract_amount", "commission_amount", "commission_split",
              "report_filed_on", "terms", "vat_mode", "down_payment"}
# 장부는 사람 낱말로 — 영문 컬럼명이 줄에 서면 안 읽힌다
_CLEAR_KO = {"briefed_on": "브리핑", "brief_how": "브리핑 방식", "brief_note": "브리핑 내용", "visited_on": "임장", "visit_note": "임장 결과",
             "pre_contract_on": "계약금 일부", "pre_contract_amount": "계약금",
             "commission_amount": "수수료", "commission_split": "배분",
             "report_filed_on": "거래신고", "terms": "조건"}


@router.patch("/proposals/{pid}/deal")
async def patch_deal(pid: int, body: DealPatch, user: CurrentUser = Depends(current_user)):
    # 채택(0113) — 「이 사람과 간다」. 가격 확정과 한 몸이라 같이 쓴다.
    if body.picked is not None:
        if body.picked:
            # 채택은 매물당 하나다 — 「이 사람과 간다」가 둘일 수 없다.
            # 갈아타면 앞사람 채택은 풀리되 그 사람의 매수희망가는 그대로 남는다.
            await pool().execute(
                """UPDATE app.proposals SET picked_at = NULL
                    WHERE team_id=$2 AND id <> $1
                      AND building_pk = (SELECT building_pk FROM app.proposals WHERE id=$1)""",
                pid, user.team_id)
            await pool().execute(
                """UPDATE app.proposals
                      SET picked_at = now(),
                          deal_price = COALESCE($3, deal_price, hope_price)
                    WHERE id=$1 AND team_id=$2""",
                pid, user.team_id, body.pick_price)
        else:
            # 되돌리기는 값 취소 하나 — 확정가는 채택이 만든 값이라 같이 비운다.
            # (매수희망가는 그 사람이 부른 값이라 남는다)
            await pool().execute(
                "UPDATE app.proposals SET picked_at = NULL, deal_price = NULL WHERE id=$1 AND team_id=$2",
                pid, user.team_id)
        return {"ok": True}

    if body.clear:
        bad = set(body.clear) - _CLEARABLE
        if bad:
            raise HTTPException(422, f"비울 수 없는 필드: {sorted(bad)}")
        sets = ", ".join(f"{c} = NULL" for c in body.clear)
        n = await pool().execute(
            f"UPDATE app.proposals SET {sets} WHERE id=$1 AND team_id=$2",
            pid, user.team_id)
        if n.endswith(" 0"):
            raise HTTPException(404, "제안을 찾을 수 없습니다")
        cell_of = {"briefed_on": "brief", "brief_how": "brief", "brief_note": "brief", "visited_on": "visit", "visit_note": "visit",
                   "pre_contract_on": "sign", "pre_contract_amount": "sign",
                   "commission_amount": "pay", "commission_split": "pay",
                   "report_filed_on": "pay", "terms": "nego"}
        return {"ok": True}
    n = await pool().execute(
        """UPDATE app.proposals SET
             -- 방식을 골랐다는 것이 곧 「브리핑했다」다(2026-08-29) — 그 날이 브리핑 날이다.
             -- 예전엔 캘린더에서 브리핑 **일정을 완료**할 때만 날짜가 붙어서, 창에서 방식만
             -- 고른 건은 날짜가 비어 있었다. 그러면 「브리핑 뒤 며칠」을 셀 수가 없다
             -- (실제로 그 시계가 updated_at 으로 떨어져 값 하나만 고쳐도 0으로 돌아갔다).
             briefed_on = COALESCE($3, briefed_on,
                                   CASE WHEN $12::text[] IS NOT NULL
                                         AND array_length($12::text[], 1) > 0
                                        THEN current_date END),
             visited_on = COALESCE($4, visited_on),
             visit_note = COALESCE($5, visit_note),
             pre_contract_on = COALESCE($6, pre_contract_on),
             pre_contract_amount = COALESCE($7, pre_contract_amount),
             commission_amount = COALESCE($8, commission_amount),
             commission_split = COALESCE($9, commission_split),
             report_filed_on = COALESCE($10, report_filed_on),
             terms = COALESCE($11, terms),
             brief_how = COALESCE($12::text[], brief_how),
             brief_note = CASE WHEN $13::text IS NULL THEN brief_note
                               WHEN $13::text = '' THEN NULL ELSE $13::text END,
             vat_mode = COALESCE($14, vat_mode),
             down_payment = COALESCE($15, down_payment)
           WHERE id=$1 AND team_id=$2""",
        pid, user.team_id,
        _d(body.briefed_on) if body.briefed_on else None,
        _d(body.visited_on) if body.visited_on else None,
        body.visit_note,
        _d(body.pre_contract_on) if body.pre_contract_on else None,
        body.pre_contract_amount, body.commission_amount, body.commission_split,
        _d(body.report_filed_on) if body.report_filed_on else None,
        body.terms, body.brief_how, body.brief_note,
        body.vat_mode, body.down_payment)
    if n.endswith(" 0"):
        raise HTTPException(404, "제안을 찾을 수 없습니다")
    # 창 저장 = 장부 한 줄(auto·접힘) — 무엇이 있었는지는 남되 사람 문장 사이에 안 끼게
    return {"ok": True}


# ── 서류 체크리스트(S04b §5.3) — 항목은 조합에서 서버가 만든다. 뼈대이지 법률 자문이 아니다 ──
# (시점, 주체, 개인/법인 조건, 코드, 라벨). corp=None 이면 조합 무관.
_DOCS: list[tuple[str, str, bool | None, str, str]] = [
    ("계약", "매도", None,  "s_id",      "매도자 신분증"),
    ("계약", "매도", False, "s_seal",    "인감도장"),
    ("계약", "매도", True,  "s_cseal",   "법인 인감도장(사용인감 불가)"),
    ("계약", "매도", None,  "s_deed",    "등기권리증"),
    ("계약", "매도", True,  "s_creg",    "법인 등기사항증명서"),
    ("계약", "매도", True,  "s_biz",     "사업자등록증"),
    ("계약", "매도", True,  "s_board",   "이사회의사록(중요 자산 처분 시)"),
    ("계약", "매도", None,  "s_lease",   "임대차계약서 원본·도면"),
    ("계약", "매수", None,  "b_id",      "매수자 신분증"),
    ("계약", "매수", False, "b_seal",    "도장"),
    ("계약", "매수", True,  "b_cseal",   "법인 인감"),
    ("계약", "매수", True,  "b_creg",    "법인 등기사항증명서"),
    ("계약", "매수", True,  "b_biz",     "사업자등록증"),
    ("계약", "매수", None,  "b_deposit", "계약금"),
    ("신고", "중개", None,  "r_file",    "부동산 거래신고(+30일 · 과태료 500만)"),
    ("신고", "매수", None,  "r_fund",    "자금조달계획서(해당 시 +30일)"),
    # 이행(S04b §6 「약속 이행」) — 잔금 전에 실제로 돼 있어야 하는 약속들.
    # 발동 조건은 개인/법인이 아니라 **매물 필드**다(list_docs 에서 거른다) — 약속이
    # 없던 항목이 서면 「빈 칸 나열」이 된다.
    ("이행", "매도", None,  "f_meongdo", "명도 완료"),
    ("이행", "매도", None,  "f_myeolsil","멸실 이행(잔금 전)"),
    ("이행", "매도", None,  "f_use",     "용도변경 이행"),
    ("잔금", "매도", None,  "p_seal",    "부동산 매도용 인감증명서(매수자 기재)"),
    ("잔금", "매도", False, "p_addr",    "주민등록초본(주소 변동 전부)"),
    ("잔금", "매도", True,  "p_creg",    "법인 등기사항증명서(초본 대신)"),
    ("잔금", "매도", None,  "p_key",     "등기권리증 · 열쇠"),
    ("잔금", "매수", False, "p_reg",     "주민등록등본"),
    ("잔금", "매수", None,  "p_pay",     "잔금"),
]


@router.post("/listings/{building_pk}/owner-to-buyer")
async def owner_to_buyer(building_pk: str, user: CurrentUser = Depends(current_user)):
    """매도자 → 매수자 명단(2026-08-18·아티팩트 ③「이 사람의 매수 의사」 복원).
    「살건없고팔건보내준다고함」의 반대 — 팔면서 살 생각도 있는 사람을 잃지 않는 길.
    판 사람이 매수자 확보의 최대 원천(엑셀 10.매각→3_1.매수로 1,046행)이라 같은 기계를
    잔금 뒤에도 쓴다. 전화번호(숫자만)로 중복을 막는다 — 이미 있으면 그 사람을 돌려준다."""
    row = await pool().fetchrow(
        """SELECT o.id, o.name, o.phone, o.owner_type FROM app.listings l
             JOIN app.owners o ON o.id = l.owner_id AND o.deleted_at IS NULL
            WHERE l.building_pk=$1 AND l.team_id=$2""", building_pk, user.team_id)
    if row is None or not row["name"]:
        raise HTTPException(422, "소유자가 확보되어 있어야 명단에 올릴 수 있습니다")
    digits = "".join(ch for ch in (row["phone"] or "") if ch.isdigit())
    bid = None
    if digits:
        # **되살린다**(2026-08-20) — 명단에서 내린 사람(소프트 삭제)을 다시 올리면
        # 예전에는 새 사람이 하나 더 생겼다. 전환·취소를 반복할수록 같은 사람이 여러 id로
        # 흩어지고, 그 사람의 제안·기록도 같이 갈라진다. 살아 있는 행이 먼저, 없으면 죽은 행을 깨운다.
        bid = await pool().fetchval(
            r"""SELECT id FROM app.buyers
                 WHERE team_id=$1
                   AND regexp_replace(COALESCE(phone,''),'\D','','g') = $2
                 ORDER BY (deleted_at IS NULL) DESC, id LIMIT 1""", user.team_id, digits)
        if bid is not None:
            await pool().execute(
                "UPDATE app.buyers SET deleted_at = NULL WHERE id=$1 AND team_id=$2 AND deleted_at IS NOT NULL",
                bid, user.team_id)
    created = bid is None
    if created:
        bid = await pool().fetchval(
            """INSERT INTO app.buyers(team_id, name, phone, is_corp, assignee_account_id)
               VALUES($1,$2,$3,$4,$5) RETURNING id""",
            user.team_id, row["name"], row["phone"], row["owner_type"] == "법인",
            user.account_id)
    return {"buyer_id": bid, "created": created}


@router.delete("/listings/{building_pk}/owner-to-buyer")
async def owner_from_buyer(building_pk: str, user: CurrentUser = Depends(current_user)):
    """전환 취소 — 명단에서 내린다(소프트 삭제 · 지우지 않는다). 칩을 끄는 길."""
    row = await pool().fetchrow(
        """SELECT o.name, o.phone FROM app.listings l
             JOIN app.owners o ON o.id = l.owner_id AND o.deleted_at IS NULL
            WHERE l.building_pk=$1 AND l.team_id=$2""", building_pk, user.team_id)
    if row is None or not (row["phone"] or "").strip():
        raise HTTPException(404, "내릴 사람을 찾을 수 없습니다")
    digits = "".join(ch for ch in row["phone"] if ch.isdigit())
    bid = await pool().fetchval(
        r"""UPDATE app.buyers SET deleted_at=now()
             WHERE team_id=$1 AND deleted_at IS NULL
               AND regexp_replace(COALESCE(phone,''),'\D','','g') = $2
             RETURNING id""", user.team_id, digits)
    if bid is None:
        raise HTTPException(404, "명단에 없습니다")
    return {"buyer_id": bid}


_PAPER_KINDS = ("계약서", "확인설명서", "영수증")
_RRN = _re.compile(r"\d{6}-?\d{7}")


def _mask_rrn(x):
    """주민등록번호가 실수로 body에 섞여 오면 마스킹 — 우리 서버엔 평문 주민번호가 없다(0128 확정)."""
    if isinstance(x, str):
        return _RRN.sub(lambda m: m.group(0).replace("-", "")[:6] + "-*******", x)
    if isinstance(x, list):
        return [_mask_rrn(i) for i in x]
    if isinstance(x, dict):
        return {k: _mask_rrn(v) for k, v in x.items()}
    return x


class PaperIn(BaseModel):
    kind: str
    body: dict


@router.get("/proposals/{pid}/papers")
async def get_papers(pid: int, user: CurrentUser = Depends(current_user)):
    """만든 문서 — 종류별 한 판(body에 서식 칸 전체)."""
    rows = await pool().fetch(
        """SELECT kind, body FROM app.contract_docs
            WHERE team_id=$1 AND proposal_id=$2 AND deleted_at IS NULL""",
        user.team_id, pid)
    return {r["kind"]: json.loads(r["body"]) if isinstance(r["body"], str) else r["body"] for r in rows}


@router.put("/proposals/{pid}/papers")
async def put_paper(pid: int, body: PaperIn, user: CurrentUser = Depends(current_user)):
    if body.kind not in _PAPER_KINDS:
        raise HTTPException(422, "문서 종류가 아닙니다")
    ok = await pool().fetchval(
        "SELECT 1 FROM app.proposals WHERE id=$1 AND team_id=$2", pid, user.team_id)
    if not ok:
        raise HTTPException(404, "제안을 찾을 수 없습니다")
    await pool().execute(
        """INSERT INTO app.contract_docs(team_id, proposal_id, kind, body, created_by)
           VALUES($1, $2, $3, $4::jsonb, $5)
           ON CONFLICT (team_id, proposal_id, kind)
           DO UPDATE SET body = EXCLUDED.body, updated_at = now(), deleted_at = NULL""",
        user.team_id, pid, body.kind, json.dumps(_mask_rrn(body.body)), user.account_id)
    return {"ok": True}


@router.get("/sales/offer-board")
async def offer_board(building_pk: str, user: CurrentUser = Depends(current_user)):
    """호가판(2026-08-19) — 값의 시간 흐름을 그린다.
    매도 쪽(매매가·매도희망가)과 매수자별 희망가가 같은 시간축 위에 선다.
    값은 `app.field_events`(append-only)에서 오고, 지금 값은 그 최신 행이다."""
    sell = await pool().fetch(
        """SELECT id, field, prev, value, created_at
             FROM app.field_events
            WHERE team_id=$1 AND target_type='listing' AND target_id=$2
              AND field IN ('sale_price','ask_price')
            ORDER BY created_at""", user.team_id, building_pk)
    buys = await pool().fetch(
        """SELECT p.id AS proposal_id, y.name AS buyer_name,
                  app.nego_rank(p)::text AS status,
                  f.id AS event_id, f.field, f.prev, f.value, f.created_at
             FROM app.proposals p
             JOIN app.buyers y ON y.id = p.buyer_id
             LEFT JOIN app.field_events f
                    ON f.team_id = p.team_id AND f.target_type='proposal'
                   AND f.target_id = p.id::text AND f.field IN ('hope_price','deal_price')
            WHERE p.team_id=$1 AND p.building_pk=$2
            ORDER BY p.id, f.created_at""", user.team_id, building_pk)
    # 값 이력의 정본은 하나다(app.field_events · 0141) — 커밋 장부에서 따로 긁어 올리지 않는다.
    return {"sell": [dict(r) for r in sell],
            "buys": [dict(r) for r in buys if r["field"]],
            "events": []}


@router.delete("/sales/offer-events/{src}/{eid}")
async def del_offer_event(src: str, eid: int, user: CurrentUser = Depends(current_user)):
    """호가 시계열에서 잘못 기록된 값 하나를 뺀다(2026-08-23). 값 이력은 field 하나다(0141)."""
    if src != "field":
        raise HTTPException(422, "src는 field")
    n = await pool().execute(
        "DELETE FROM app.field_events WHERE id=$1 AND team_id=$2", eid, user.team_id)
    if n.endswith(" 0"):
        raise HTTPException(404, "이력을 찾을 수 없습니다")
    return {"ok": True}


@router.get("/proposals/{pid}/docs")
async def list_docs(pid: int, user: CurrentUser = Depends(current_user)):
    """조합(매도 개인/법인 × 매수 개인/법인)에 맞는 체크리스트 + 체크 상태.
    조합을 가르는 두 필드는 이미 있다 — owners.owner_type · buyers.is_corp."""
    row = await pool().fetchrow(
        """SELECT y.is_corp AS buyer_corp, o.owner_type,
                  l.meongdo, l.myeolsil, l.use_change
             FROM app.proposals p
             JOIN app.buyers y ON y.id = p.buyer_id
             LEFT JOIN app.listings l ON l.building_pk = p.building_pk AND l.team_id = p.team_id
             LEFT JOIN app.owners o ON o.id = l.owner_id AND o.deleted_at IS NULL
            WHERE p.id=$1 AND p.team_id=$2""", pid, user.team_id)
    if row is None:
        raise HTTPException(404, "제안을 찾을 수 없습니다")
    seller_corp = row["owner_type"] == "법인"
    buyer_corp = bool(row["buyer_corp"])
    checked = {r["code"] for r in await pool().fetch(
        "SELECT code FROM app.deal_docs WHERE proposal_id=$1 AND team_id=$2", pid, user.team_id)}
    # 이행 항목의 발동 — 매물 필드가 「약속이 있다」고 말할 때만(없던 약속은 안 선다)
    fulfil = {
        "f_meongdo": (row["meongdo"] or "") in ("가능", "일부", "조건부", "확인중"),
        "f_myeolsil": (row["myeolsil"] or "") in ("잔금전멸실", "협조가능", "협의가능", "조건부"),
        "f_use": (row["use_change"] or "") in ("가능", "협의가능", "조건부"),
    }
    out = []
    for phase, actor, corp, code, label in _DOCS:
        if code in fulfil and not fulfil[code]:
            continue
        if corp is not None:
            if actor == "매도" and corp != seller_corp:
                continue
            if actor == "매수" and corp != buyer_corp:
                continue
        out.append({"phase": phase, "actor": actor, "code": code, "label": label,
                    "done": code in checked})
    return {"seller_corp": seller_corp, "buyer_corp": buyer_corp, "items": out}


class DocToggle(BaseModel):
    code: str
    done: bool


@router.put("/proposals/{pid}/docs")
async def toggle_doc(pid: int, body: DocToggle, user: CurrentUser = Depends(current_user)):
    if body.code not in {c for _, _, _, c, _ in _DOCS}:
        raise HTTPException(422, "모르는 항목입니다")
    if body.done:
        await pool().execute(
            """INSERT INTO app.deal_docs(team_id, proposal_id, code, done_by)
               VALUES($1,$2,$3,$4) ON CONFLICT (proposal_id, code) DO NOTHING""",
            user.team_id, pid, body.code, user.account_id)
    else:
        await pool().execute(
            "DELETE FROM app.deal_docs WHERE proposal_id=$1 AND team_id=$2 AND code=$3",
            pid, user.team_id, body.code)
    return {"ok": True}


@router.delete("/proposals/{pid}")
async def delete_proposal(pid: int, user: CurrentUser = Depends(current_user)):
    """짝을 지우면 그 짝이 낳은 것도 다 간다 — 일정·참석자 거울·보류(H4).
    캘린더에 유령 약속이 남으면 「이 약속 뭐지」를 아무도 답 못 한다.
    보류도 같다: 없어진 짝의 보류가 남으면 「왜 안 나갔나」 집계가 유령을 센다(0141)."""
    await schedule_retract(user.team_id, proposal_id=pid)
    await pool().execute(
        """DELETE FROM app.stops WHERE team_id=$1 AND target_type='proposal' AND target_id=$2""",
        user.team_id, str(pid))
    await pool().execute("DELETE FROM app.proposals WHERE id=$1 AND team_id=$2", pid, user.team_id)
    return {"ok": True}


# ── 활동 — 이 사람에게 언제 무엇을 했나 ──────────────────
# 장부는 하나다(app.contacts · 0141). 매물이 걸린 줄은 proposal_id 를 들고 있어
# 어느 매물 얘기였는지가 같이 선다.
@router.get("/buyers/{bid}/activity")
async def buyer_activity(bid: int, user: CurrentUser = Depends(current_user)):
    rows = await pool().fetch(
        """SELECT c.occurred_on::timestamptz AS at, c.kind, c.status, c.note,
                  b.addr, p.building_pk, a.name AS by_name
             FROM app.contacts c
             LEFT JOIN app.accounts a ON a.id = c.created_by
             LEFT JOIN app.proposals p ON p.id = c.proposal_id
             LEFT JOIN master.buildings b ON b.building_pk = p.building_pk
            WHERE c.team_id=$1 AND c.target_type='buyer' AND c.target_id=$2
            ORDER BY at DESC LIMIT 50""",
        user.team_id, str(bid))
    return [dict(r) for r in rows]


# ── 매수자 → 매물 추천 ─────────────────────────────────
# 반대 방향. "이 사람에게 뭘 보여줄까"를 조건 세트로 검색 엔진에 물어본다(같은 엔진 — 규칙 한 벌).
# 추천은 출발점일 뿐이다 — 마음에 안 들면 지도·상세에서 직접 골라 담는다(제안 리스트).
@router.get("/buyers/{bid}/matches")
async def buyer_matches(bid: int, limit: int = 6, user: CurrentUser = Depends(current_user)):
    from . import search as S   # 순환 임포트 방지

    conds = await pool().fetch(
        """SELECT c.id, c.name, c.conditions_json FROM app.buyer_conditions c
           JOIN app.buyers b ON b.id = c.buyer_id AND b.deleted_at IS NULL
           WHERE c.team_id=$1 AND c.buyer_id=$2 ORDER BY c.id""", user.team_id, bid)
    # 이미 리스트에 담긴 매물은 다시 추천하지 않는다(거절 포함 — 같은 걸 또 들이밀지 않는다)
    seen = {r["building_pk"] for r in await pool().fetch(
        "SELECT building_pk FROM app.proposals WHERE team_id=$1 AND buyer_id=$2", user.team_id, bid)}

    out: list[dict] = []
    for c in conds:
        cond = c["conditions_json"]
        if isinstance(cond, str):
            cond = json.loads(cond)
        filters = {k: v for k, v in ((cond or {}).get("filters") or {}).items()
                   if v is not None and v != [] and v != ""}
        regions = (cond or {}).get("regions") or []
        poly = (cond or {}).get("polygon") or None
        if not (filters or regions or poly):
            continue
        f = dict(filters)
        if poly:
            f.pop("bjd_code", None)
        elif not f.get("bjd_code") and regions:
            f["bjd_code"] = regions[0].get("bjd_code")
        try:
            base, args, outer = S._build_base(S.SearchIn(filters=S.Filters(**f), polygon=poly), user)
            rows = await pool().fetch(
                base + f"""SELECT building_pk, addr, price, roi, land_area, total_area
                           FROM classified WHERE TRUE {outer}
                           ORDER BY price DESC NULLS LAST LIMIT 20""", *args)
        except Exception:
            continue
        for r in rows:
            if r["building_pk"] in seen:
                continue
            seen.add(r["building_pk"])
            out.append({**dict(r), "cond_name": c["name"]})
            if len(out) >= limit:
                break
        if len(out) >= limit:
            break
    # 배치 활용유형을 붙인다 — 카드에서 판단 재료가 되게(매력도 등급은 2026-09-06 에 없앴다)
    if out:
        scs = {r["building_pk"]: dict(r) for r in await pool().fetch(
            """SELECT building_pk, use_type FROM master.building_score
               WHERE building_pk = ANY($1::text[])""", [o["building_pk"] for o in out])}
        for o in out:
            o["use_type"] = scs.get(o["building_pk"], {}).get("use_type")
    return out


# ── 조건 기반 추천(2026-08-20) ──────────────────────────
# 예전 매칭은 O/X 였다 — 조건을 1원이라도 벗어나면 없는 매물이 됐다. 현장에선 「예산 12억인데
# 12.5억짜리 좋은 게 있다」가 늘 있는 일이라, 그런 건을 화면이 감춰 버리면 사람이 검색으로
# 되돌아간다. 그래서 축마다 **얼마나 벗어났나**로 0~1 점을 주고 가중합한다.
#   · 점수는 **줄 세우는 데만** 쓴다. 화면엔 「87점」이 아니라 근거(가격 ○ · 수익률 △)를 낸다.
#   · 규칙이다 — LLM 없다. 값이 없으면 0.4(모른다고 벌주지도, 통과시키지도 않는다).
_RECO_AXES: list[tuple[str, str, str, str, float]] = [
    # 무게는 중개인이 매물을 고르는 순서다(2026-08-20): **지역과 값이 먼저**고,
    # 그 다음이 주차·엘리베이터·연식이다. 수익률·면적은 조건에 적혀 있으면 참고만 한다.
    ("price_min",         "price_max",         "가격",       "price",      3.0),
    ("parking_min",       "parking_max",       "주차",       "parking",    1.2),
    ("elevator_min",      "elevator_max",      "엘리베이터", "elevator",   1.2),
    ("age_min",           "age_max",           "연식",       "age",        1.2),
    ("remodel_years_min", "remodel_years_max", "대수선",     "remodel",    0.8),
    ("roi_min",           "roi_max",           "수익률",     "roi",        0.8),
    ("land_area_min",     "land_area_max",     "대지",       "land_area",  0.6),
    ("total_area_min",    "total_area_max",    "연면적",     "total_area", 0.6),
]
_W_REGION = 4.0        # 제일 무겁다 — 매물을 소개할 때 가장 먼저 걸리는 게 지역이다
# 이만큼 벗어나면 0점. 25% 넘게 틀리면 다른 물건이다.
_RECO_TOL = 0.25


def _axis_score(lo, hi, got) -> float | None:
    """한 축의 0~1 점. 조건이 없으면 None(가중치에서 빠진다)."""
    if lo is None and hi is None:
        return None
    if got is None:
        return 0.4
    g = float(got)
    if lo is not None and g < float(lo):
        off = (float(lo) - g) / max(abs(float(lo)), 1e-9)
    elif hi is not None and g > float(hi):
        off = (g - float(hi)) / max(abs(float(hi)), 1e-9)
    else:
        return 1.0
    return max(0.0, 1.0 - off / _RECO_TOL)


def _km(lng1, lat1, lng2, lat2) -> float | None:
    """대충 거리(km). 서울 안에서만 쓰므로 위도 보정 하나면 충분하다."""
    if None in (lng1, lat1, lng2, lat2):
        return None
    dx = (float(lng1) - float(lng2)) * 88.0     # 위도 37.5°에서 경도 1° ≈ 88km
    dy = (float(lat1) - float(lat2)) * 111.0
    return (dx * dx + dy * dy) ** 0.5


def _region_score(cond: dict, row: dict) -> float | None:
    """지역 — **일치할수록 좋다**(2026-08-20).

    「역삼동」을 짚었으면 역삼동이 1.0이고, 옆 동은 「생각해 볼 만한 정도」라 조금 낮다.
    가깝다/멀다는 동 중심점과의 거리로 본다(구 경계를 넘어도 붙어 있으면 가까운 것이다 —
    역삼동과 서초동은 구가 달라도 길 하나 차이다).

        동을 짚었을 때   그 동 1.0 · 1km 안 0.85 · 2km 안 0.75 · 4km 안 0.6 · 같은 구 0.5 · 그 밖 0.2
        구만 짚었을 때   그 구 1.0 · 그 밖 0.3
    """
    if (cond or {}).get("polygon"):
        return 1.0                       # 영역은 후보 뽑을 때 이미 하드로 걸렀다
    regions = (cond or {}).get("regions") or []
    if not regions:
        return None
    addr = row.get("addr") or ""
    best = 0.0
    for rg in regions:
        gu, dong = rg.get("gu"), rg.get("dong")
        same_gu = bool(gu and gu in addr)
        if not dong:                     # 구만 짚었다 — 그 구 안이면 만점
            best = max(best, 1.0 if same_gu else 0.3)
            continue
        if dong and dong in addr:
            return 1.0
        d = _km(rg.get("lng"), rg.get("lat"), row.get("lng"), row.get("lat"))
        if d is None:
            best = max(best, 0.5 if same_gu else 0.2)
        elif d <= 1.0:
            best = max(best, 0.85)
        elif d <= 2.0:
            best = max(best, 0.75)
        elif d <= 4.0:
            best = max(best, 0.6)
        else:
            best = max(best, 0.5 if same_gu else 0.2)
    return best


def _reco_score(cond: dict, filters: dict, row: dict) -> float:
    """0~100. 축마다 점수를 매겨 가중평균한다."""
    num = den = 0.0
    for kmin, kmax, _label, col, w in _RECO_AXES:
        sc = _axis_score(filters.get(kmin), filters.get(kmax), row.get(col))
        if sc is None:
            continue
        num += sc * w
        den += w
    if filters.get("use_zones"):
        num += (1.0 if row.get("use_zone") in filters["use_zones"] else 0.0) * 0.6
        den += 0.6
    # 지역 — 안 적었으면 **모른다**로 친다(0.5). 빼 버리면 「가격만 적은 조건」이 만점이 되어
    # 강남을 원하는 사람에게 구로 물건이 100점으로 올라온다(2026-08-20에 실제로 그랬다).
    rs = _region_score(cond, row)
    num += (rs if rs is not None else 0.5) * _W_REGION
    den += _W_REGION
    if den == 0:
        return 0.0
    return round(num / den * 100, 1)


def _clean_filters(cond: dict) -> dict:
    """조건 모달은 값 없는 키까지 전부 저장한다 — 그대로 두면 「조건 없음」이 통과한다."""
    return {k: v for k, v in ((cond or {}).get("filters") or {}).items()
            if v is not None and v != [] and v != ""}


def _relax(filters: dict) -> dict:
    """후보를 뽑을 때만 범위를 넓힌다(±40%) — 점수는 원래 조건으로 매긴다.
    안 넓히면 「조건 밖이지만 보여줄 만한 것」이 애초에 후보에 못 든다."""
    f = dict(filters)
    for kmin, kmax, _l, _c, _w in _RECO_AXES:
        if f.get(kmin) is not None:
            f[kmin] = type(f[kmin])(float(f[kmin]) * 0.6)
        if f.get(kmax) is not None:
            f[kmax] = type(f[kmax])(float(f[kmax]) * 1.4)
    return f


async def _resolve_regions(cond: dict) -> dict:
    """조건의 지역을 **이름과 좌표로** 푼다. 저장된 건 코드(11110)뿐이라 주소와 못 견준다."""
    regions = (cond or {}).get("regions") or []
    if not regions or all(r.get("gu") and (r.get("lng") or not r.get("dong")) for r in regions):
        return cond
    out = []
    for rg in regions:
        code = rg.get("bjd_code") or ""
        if not code or rg.get("lng"):
            out.append(rg); continue
        row = await pool().fetchrow(
            "SELECT gu, dong, lng, lat FROM master.region_index WHERE bjd_code LIKE $1 || '%' LIMIT 1",
            code)
        # 10자리면 동을 짚은 것, 5자리면 구 전체다 — 이 구분이 점수를 가른다
        out.append({**rg, "gu": row["gu"] if row else None,
                    "dong": (row["dong"] if row and len(code) >= 8 else None),
                    "lng": row["lng"] if row else None,
                    "lat": row["lat"] if row else None})
    return {**cond, "regions": out}


async def _attach_specs(rows: list[dict]) -> None:
    """주차·엘리베이터·연식 — 검색 엔진이 안 내주는 값이라 한 번에 붙인다(N+1 금지).
    연식은 「몇 년 됐나」로 바꾼다(조건이 그렇게 적혀 있다)."""
    pks = [r["building_pk"] for r in rows if r.get("building_pk")]
    if not pks:
        return
    spec = {r["building_pk"]: r for r in await pool().fetch(
        """SELECT building_pk, parking, elevator,
                  EXTRACT(YEAR FROM age(current_date, approval_ymd))::int AS age,
                  EXTRACT(YEAR FROM age(current_date, remodel_ymd))::int  AS remodel
             FROM master.buildings WHERE building_pk = ANY($1::text[])""", pks)}
    for r in rows:
        sp = spec.get(r.get("building_pk"))
        r["parking"] = sp["parking"] if sp else None
        r["elevator"] = sp["elevator"] if sp else None
        r["age"] = sp["age"] if sp else None
        r["remodel"] = sp["remodel"] if sp else None


@router.get("/buyers/{bid}/recommend")
async def buyer_recommend(bid: int, limit: int = 20, user: CurrentUser = Depends(current_user)):
    """이 매수자에게 보여줄 만한 매물 — **전 서울이 대상**이고, 내 매물이면 표식이 붙는다.

    조건이 없으면 추천하지 않는다(2026-08-20 결정). 근거 없는 추천은 한 번 틀리면
    그 뒤로 아무도 안 본다 — 「조건을 먼저 채우세요」가 정직한 답이다.
    """
    from . import search as S   # 순환 임포트 방지

    conds = await pool().fetch(
        """SELECT c.id, c.name, c.conditions_json FROM app.buyer_conditions c
           JOIN app.buyers b ON b.id = c.buyer_id AND b.deleted_at IS NULL
           WHERE c.team_id=$1 AND c.buyer_id=$2 ORDER BY c.id""", user.team_id, bid)
    taken = {r["building_pk"] for r in await pool().fetch(
        "SELECT building_pk FROM app.proposals WHERE team_id=$1 AND buyer_id=$2", user.team_id, bid)}
    # 팔린 매물은 추천하지 않는다(2026-08-20) — 이미 남의 것이 된 물건을 들이미는 일이 없게.
    sold = {r["building_pk"] for r in await pool().fetch(
        """SELECT DISTINCT p.building_pk FROM app.proposals p
             JOIN app.schedules s ON s.proposal_id = p.id
                                 AND s.category = '계약' AND s.state = '완료'
            WHERE p.team_id=$1 AND p.picked_at IS NOT NULL AND p.dropped_at IS NULL""",
        user.team_id)}

    best: dict[str, dict] = {}
    used_cond = False
    for c in conds:
        cond = c["conditions_json"]
        if isinstance(cond, str):
            cond = json.loads(cond)
        cond = cond or {}
        filters = _clean_filters(cond)
        regions = cond.get("regions") or []
        poly = cond.get("polygon") or None
        if not (filters or regions or poly):
            continue
        used_cond = True
        # 지역 근거 — 조건은 코드만 들고 있다. 이름을 안 풀면 지역 점수가 통째로 빠져
        # 「종로구 조건인데 강남 물건이 100점」이 된다.
        if not regions and filters.get("bjd_code"):
            cond = {**cond, "regions": [{"bjd_code": filters["bjd_code"]}]}
        cond = await _resolve_regions(cond)
        f = _relax(filters)
        if poly:
            f.pop("bjd_code", None)
        elif regions:
            # 동이 아니라 **구**로 넓혀 뽑는다 — 옆 동의 물건이 후보에도 못 들면 추천이 아니다
            code = f.get("bjd_code") or (regions[0].get("bjd_code") or "")
            f["bjd_code"] = code[:5] if code else None
            if not f["bjd_code"]:
                f.pop("bjd_code")
        try:
            base, args, outer = S._build_base(
                S.SearchIn(filters=S.Filters(**f), polygon=poly), user)
            # 후보는 **조건 한가운데에 가까운 순**으로 뽑는다(2026-08-20).
            # 비싼 순으로 150개만 뜨면 넓힌 상한(+40%) 근처 물건만 후보가 되어,
            # 정작 조건 안에 드는 물건이 추천에 못 든다(80~120억 조건에 137억이 1위였다).
            lo, hi = filters.get("price_min"), filters.get("price_max")
            mid = (int(lo) + int(hi)) // 2 if lo and hi else (int(lo or 0) or int(hi or 0))
            order = (f"abs(COALESCE(price, 0) - {int(mid)}) ASC" if mid
                     else "price DESC NULLS LAST")
            rows = await pool().fetch(
                base + f"""SELECT building_pk, addr, price, roi, land_area, total_area,
                                  use_zone, lng, lat, col
                             FROM classified WHERE TRUE {outer}
                            ORDER BY (col = 'mine') DESC, {order}
                            LIMIT 150""", *args)
        except Exception:
            continue                      # 조건 한 벌이 깨져도 나머지는 낸다
        cands = [dict(r) for r in rows]
        await _attach_specs(cands)         # 주차·엘리베이터·연식은 검색 엔진 밖의 값
        for row in cands:
            pk = row["building_pk"]
            if pk in sold:
                continue
            mine = row.get("col") == "mine"
            score = _reco_score(cond, filters, row)
            # 내 매물이면 살짝 올린다 — 남의 물건보다 굴리기 쉬운 게 사실이다(가산은 이 한 줄뿐)
            if mine:
                score = min(100.0, score + 5)
            cur = best.get(pk)
            if cur and cur["score"] >= score:
                continue
            best[pk] = {
                "building_pk": pk, "addr": row["addr"], "price": row["price"],
                "roi": float(row["roi"]) if row["roi"] is not None else None,
                "land_area": row["land_area"], "total_area": row["total_area"],
                "mine": mine, "score": score, "cond_name": c["name"],
                "taken": pk in taken,
                "checks": _explain(filters, row),
            }
    # 동점이 흔하다(점수는 축 몇 개의 평균이다) — 같은 값이면 내 매물, 그다음 수익률 높은 순.
    out = sorted(best.values(),
                 key=lambda x: (x["taken"], -x["score"], not x["mine"],
                                -(x["roi"] or 0)))[:limit]
    return {"needs_condition": not used_cond, "items": out}


@router.get("/buildings/{building_pk}/recommend-buyers")
async def listing_recommend_buyers(building_pk: str, limit: int = 20,
                                   user: CurrentUser = Depends(current_user)):
    """이 매물을 돌릴 만한 매수자 — 조건 있는 사람은 점수로, 없는 사람은 뒤에 그대로 둔다.

    조건 없는 사람을 목록에서 지우진 않는다. 「조건은 안 적었지만 이 사람 생각난다」가
    현장에서 늘 있는 일이라, 추천은 순서로만 말하고 명단은 다 보여준다.
    """
    from . import search as S

    base, args, _outer = S._build_base(
        S.SearchIn(filters=S.Filters(building_pk=building_pk)), user)
    subject = await pool().fetchrow(base + "SELECT * FROM classified LIMIT 1", *args)
    subj = dict(subject) if subject else None
    if subj:
        await _attach_specs([subj])

    taken = {r["buyer_id"] for r in await pool().fetch(
        "SELECT buyer_id FROM app.proposals WHERE team_id=$1 AND building_pk=$2",
        user.team_id, building_pk)}

    # 이미 계약을 마친 사람은 명단에서 뺀다(2026-08-20) — 그 사람은 「계약」 갈래로 갔다
    rows = await pool().fetch(
        """SELECT b.id, b.name, b.phone, b.grade, b.assignee_account_id,
                  c.name AS cond_name, c.conditions_json
             FROM app.buyers b
             LEFT JOIN app.buyer_conditions c ON c.buyer_id = b.id
            WHERE b.team_id=$1 AND b.deleted_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM app.proposals pd
                               JOIN app.schedules sd ON sd.proposal_id = pd.id
                                                    AND sd.category = '계약' AND sd.state = '완료'
                              WHERE pd.buyer_id = b.id AND pd.picked_at IS NOT NULL
                                AND pd.dropped_at IS NULL)
            ORDER BY b.name""", user.team_id)

    best: dict[int, dict] = {}
    for r in rows:
        cond = r["conditions_json"]
        if isinstance(cond, str):
            cond = json.loads(cond)
        cond = await _resolve_regions(cond or {})
        filters = _clean_filters(cond)
        has_cond = bool(filters or cond.get("regions") or cond.get("polygon"))
        score = _reco_score(cond, filters, subj) if (has_cond and subj) else 0.0
        cur = best.get(r["id"])
        if cur and cur["score"] >= score:
            continue
        best[r["id"]] = {
            "id": r["id"], "name": r["name"], "grade": r["grade"],
            "phone": r["phone"] if _can_see(user, r["assignee_account_id"]) else _mask(r["phone"]),
            "score": score, "has_condition": has_cond,
            "cond_name": r["cond_name"] if has_cond else None,
            "taken": r["id"] in taken,
            "checks": _explain(filters, subj) if has_cond else [],
        }
    out = sorted(best.values(), key=lambda x: (x["taken"], not x["has_condition"], -x["score"]))
    return {"items": out[:limit]}


# ── 매물 → 매수자 추천 ─────────────────────────────────
# "이 매물, 누구에게?" — 매물을 받으면 중개인이 제일 먼저 하는 생각이다.
# 조건에 걸리는지만 O/X로 내면 그건 필터지 추천이 아니다. **왜 맞는지와 무엇이 걸리는지**를
# 우리 데이터로 같이 낸다. 최종 판단은 사람이 지도·실거래·수익률을 보고 한다.

# 조건 키 → (라벨, 매물 값 컬럼, 비교 방향). 의미 있는 것만 고른다 —
# 60개 필터를 전부 늘어놓으면 근거가 아니라 소음이 된다.
_CHECKS: list[tuple[str, str, str, str]] = [
    ("price_min", "price_max", "매매가", "price"),
    ("roi_min", "roi_max", "수익률", "roi"),
    ("land_area_min", "land_area_max", "대지면적", "land_area"),
    ("total_area_min", "total_area_max", "연면적", "total_area"),
    ("far_slack_min", "far_slack_max", "용적률 여유", "far_slack"),
    ("gongsi_ratio_min", "gongsi_ratio_max", "공시가율", "gongsi_ratio"),
]


def _fmt(col: str, v) -> str:
    if v is None:
        return "—"
    if col == "price":
        return f"{round(float(v) / 1e8, 1)}억"
    if col in ("land_area", "total_area"):
        return f"{round(float(v) / 3.305785)}평"
    if col in ("roi", "far_slack", "gongsi_ratio"):
        return f"{round(float(v), 2)}%"
    return str(v)


def _explain(filters: dict, row: dict | None) -> list[dict]:
    """조건 항목별 충족표. 점수 하나로 뭉개지 않는다 —
    '수익률만 0.5%p 모자란다'가 보여야 "그래도 보여줄까"를 판단한다."""
    if not row:
        return []
    out = []
    for kmin, kmax, label, col in _CHECKS:
        lo, hi = filters.get(kmin), filters.get(kmax)
        if lo is None and hi is None:
            continue
        got = row.get(col)
        ok = got is not None and (lo is None or float(got) >= float(lo)) and (hi is None or float(got) <= float(hi))
        want = " ~ ".join(x for x in [_fmt(col, lo) if lo is not None else "",
                                      _fmt(col, hi) if hi is not None else ""] if x)
        out.append({"label": label, "ok": bool(ok), "want": want.strip(" ~"), "got": _fmt(col, got)})
    if filters.get("use_zones"):
        z = row.get("use_zone")
        out.append({"label": "용도지역", "ok": z in filters["use_zones"],
                    "want": " · ".join(filters["use_zones"][:3]), "got": z or "—"})
    return out


@router.get("/buildings/{building_pk}/matching-buyers")
async def matching_buyers(building_pk: str, user: CurrentUser = Depends(current_user)):
    """이 매물을 돌릴 만한 매수자 + 그 근거.

    매칭용 쿼리를 새로 만들지 않는다 — 검색 엔진(_build_base)을 **이 매물 한 행으로 좁혀** 돌린다.
    따로 만들면 '검색 결과'와 '매칭 결과'가 언젠가 어긋난다.
    조건에 안 걸린 매수자도 함께 낸다(out_of_condition) — 조건은 참고지 규칙이 아니고,
    "조건엔 없지만 이건 보여줄 만하다"가 현장에서 자주 일어난다.
    """
    from . import search as S   # 순환 임포트 방지 — 호출 시점에

    rows = await pool().fetch(
        """SELECT b.id, b.name, b.grade, b.phone, b.assignee_account_id,
                  c.id AS cond_id, c.name AS cond_name, c.conditions_json
           FROM app.buyers b LEFT JOIN app.buyer_conditions c ON c.buyer_id = b.id
           WHERE b.team_id=$1 AND b.deleted_at IS NULL
           ORDER BY b.name""", user.team_id)

    # 이미 담아 둔 사람 — 상태 칸은 없앴다(0142). 담겼나만 본다(살아 있는 짝).
    held = {r["buyer_id"] for r in await pool().fetch(
        """SELECT buyer_id FROM app.proposals
            WHERE team_id=$1 AND building_pk=$2 AND dropped_at IS NULL""",
        user.team_id, building_pk)}

    # 과거에 접은 패턴 — 우리만 가진 재료다. "이 사람은 가격에서 자주 막힌다"가 보이면
    # 같은 가격대를 또 들이밀지 않는다. 매물 탓이 아닌 '상대사정'은 뺀다(0141: 보류가 정본).
    rej: dict[int, list] = {}
    for r in await pool().fetch(
            """SELECT p.buyer_id, st.reason, count(*) n
               FROM app.stops st JOIN app.proposals p ON p.id = st.target_id::bigint
               WHERE st.team_id=$1 AND st.target_type='proposal' AND st.stage='deal'
                 AND p.team_id=$1 AND st.reason IS NOT NULL AND st.reason <> '상대사정'
               GROUP BY 1,2 ORDER BY 3 DESC""", user.team_id):
        rej.setdefault(r["buyer_id"], []).append({"reason": r["reason"], "n": r["n"]})

    # 이 매물의 계산값 한 줄(수익률·평단가·여유분 등) — 항목별 충족 판정의 기준
    base, args, outer = S._build_base(S.SearchIn(filters=S.Filters(building_pk=building_pk)), user)
    subject = await pool().fetchrow(base + "SELECT * FROM classified LIMIT 1", *args)
    subj = dict(subject) if subject else None

    best: dict[int, dict] = {}
    for r in rows:
        bid = r["id"]
        cond = r["conditions_json"]
        if isinstance(cond, str):
            cond = json.loads(cond)
        # 모달이 저장하는 filters는 값 없는 키까지 전부 담는다(null 범벅).
        # 그대로 두면 "조건 없음"이 truthy로 통과해 그 매수자가 모든 매물에 걸린다.
        filters = {k: v for k, v in ((cond or {}).get("filters") or {}).items()
                   if v is not None and v != [] and v != ""}
        regions = (cond or {}).get("regions") or []
        # 지도에서 그린 영역도 조건이다. 빼먹으면 "영역만 그린 조건"은 영원히 안 걸린다.
        poly = (cond or {}).get("polygon") or None

        hit = False
        if filters or regions or poly:
            f = dict(filters)
            f["building_pk"] = building_pk
            # 영역이 있으면 지역코드는 안 건다 — 영역이 더 좁고, 둘을 AND로 걸면
            # 영역이 그 동 밖으로 조금만 나가도 아무것도 안 걸린다(검색 화면과 같은 규칙).
            if poly:
                f.pop("bjd_code", None)
            elif not f.get("bjd_code") and regions:
                f["bjd_code"] = regions[0].get("bjd_code")
            try:
                b2, a2, o2 = S._build_base(
                    S.SearchIn(filters=S.Filters(**f), polygon=poly), user)
                hit = bool(await pool().fetchval(
                    b2 + f"SELECT count(*) FROM classified WHERE TRUE {o2}", *a2))
            except Exception:
                hit = False               # 조건이 깨졌으면 조용히 넘어간다(한 명 때문에 화면이 죽으면 안 된다)

        cur = best.get(bid)
        # 매수자당 한 줄. 조건 세트가 여럿이면 걸린 세트를 우선 보여준다.
        if cur and (cur["matched"] or not hit):
            continue
        best[bid] = {
            "id": bid, "name": r["name"], "grade": r["grade"],
            # 연락처는 담당자 본인+대표만(S0M §3.4 경계를 매수자에도 적용)
            "phone": r["phone"] if _can_see(user, r["assignee_account_id"]) else _mask(r["phone"]),
            "matched": hit,
            "matched_condition": r["cond_name"] if hit else None,
            "checks": _explain(filters, subj) if hit or filters else [],
            "rejects": rej.get(bid, [])[:3],
            "held": bid in held,
        }

    out = list(best.values())
    # 조건에 걸린 사람 먼저 · 이미 담은 사람은 뒤로(앞에 오는 건 아직 안 돌린 사람이어야 한다)
    out.sort(key=lambda x: (not x["matched"], x["held"], x["name"]))
    return out


# ── 매물 쪽에서 읽는 영업 데이터 ─────────────────────────
@router.get("/buildings/{building_pk}/reject-summary")
async def reject_summary(building_pk: str, user: CurrentUser = Depends(current_user)):
    """이 매물이 왜 안 나갔는지. 매수자에게 보여주면 저절로 쌓이는 답인데 영업 탭 안에만 갇혀 있었다.
    매물 상세 금액정보 옆에 두면 "호가를 내릴 때가 됐다"가 숫자로 보인다.

    정본은 짝 보류다(app.stops · target_type='proposal' · 0141) — 거절 칸은 없앴다.
    매수자 사정('상대사정')은 매물 탓이 아니라 집계에서 뺀다.
    「부른 값」은 그 사람의 매수희망가가 이미 들고 있다 — 따로 적던 거절가는 없앴다."""
    # 지운 매수자의 짝은 빼고 센다 — 보드에서 사라진 건이 집계에만 남으면 숫자가 안 맞는다.
    rows = await pool().fetch(
        """SELECT st.reason, count(*) AS n,
                  percentile_cont(0.5) WITHIN GROUP (ORDER BY p.hope_price)
                    FILTER (WHERE p.hope_price IS NOT NULL) AS med_price
           FROM app.stops st
           JOIN app.proposals p ON p.id = st.target_id::bigint AND p.team_id = st.team_id
           JOIN app.buyers y ON y.id = p.buyer_id AND y.deleted_at IS NULL
           WHERE st.team_id=$1 AND st.target_type='proposal' AND st.stage='deal'
             AND p.building_pk=$2 AND st.reason IS NOT NULL AND st.reason <> '상대사정'
           GROUP BY 1 ORDER BY 2 DESC""", user.team_id, building_pk)
    tot = await pool().fetchrow(
        """SELECT count(*) FILTER (WHERE COALESCE(array_length(p.brief_how,1),0) > 0) AS proposed,
                  count(*) FILTER (WHERE EXISTS (
                    SELECT 1 FROM app.stops st2
                     WHERE st2.team_id = p.team_id AND st2.target_type='proposal'
                       AND st2.target_id = p.id::text AND st2.stage='deal')) AS rejected,
                  percentile_cont(0.5) WITHIN GROUP (ORDER BY p.hope_price)
                    FILTER (WHERE p.hope_price IS NOT NULL) AS want_price
           FROM app.proposals p
           JOIN app.buyers y ON y.id = p.buyer_id AND y.deleted_at IS NULL
           -- 담아만 둔 것은 뺀다 — 보여준 적 없는 매물이 「안 나갔다」로 세어지면 안 된다
           WHERE p.team_id=$1 AND p.building_pk=$2""",
        user.team_id, building_pk)
    return {**dict(tot), "reasons": [dict(r) for r in rows]}


# ── 매도자(소유자) — 영업의 반대쪽 절반 ──────────────────
# 별도 저장소가 없다. 업무탭이 쓰는 app.listings의 같은 행을 사람 관점으로 다시 편 것 —
# 영업에서 고치면 업무탭에도 바뀌어 있다(수정 = 기존 PATCH /listings/biz 재사용).
#
# **단계를 발명하지 않는다**(2026-08-10 감사에서 확정). 매물에는 상태 칸이 없다(0142) —
# 있던 다섯 낱말(후보·제안·계약·철회·계약파기)은 전부 사실로 옮겼다:
#   계약·계약파기 → 짝의 picked_at · dropped_at
#   철회          → 보류(app.stops · listing · intent · '안판다')
#   후보·제안     → 사다리(app.v_listing_stage)
# 매수 쪽에서 같은 모양의 값이 「10일째 답 없음」을 만들었다(0141). 값이 둘이면 갈라진다.


@router.get("/sales/owners")
async def list_owners(mine: bool = False, user: CurrentUser = Depends(current_user)):
    """매도자 = **사람 하나**. 그 사람이 들고 있는 매물을 함께 낸다(0058).

    매수(app.buyers → 담긴 매물)와 같은 모양이라 화면도 같은 부품을 쓴다.
    다른 것은 관계의 성질뿐이다 — 매수는 M:N(제안), 매도는 1:N(소유).
    """
    rows = await pool().fetch(
        """SELECT o.id, o.name, o.phone, o.owner_type, o.relation, o.cooperation,
                  o.kindness, o.age_band, o.gender, o.note, o.updated_at,
                  (SELECT count(*) FROM app.listings x WHERE x.owner_id = o.id) AS n_listings,
                  (SELECT max(a.assignee_account_id) FROM app.listings a WHERE a.owner_id = o.id)
                    AS assignee_account_id
           FROM app.owners o
           WHERE o.team_id = $1 AND o.deleted_at IS NULL
             AND ($2::bigint IS NULL OR EXISTS (
                   SELECT 1 FROM app.listings a WHERE a.owner_id = o.id AND a.assignee_account_id = $2))
           ORDER BY o.updated_at DESC""",
        user.team_id, user.account_id if mine else None)
    out = []
    for r in rows:
        d = dict(r)
        if not _can_see(user, d.get("assignee_account_id")):
            d["phone"] = _mask(d.get("phone"))
            d["phone_masked"] = True
        out.append(d)
    return out


class OwnerIn(BaseModel):
    name: str
    phone: str | None = None
    owner_type: str | None = None
    relation: str | None = None
    cooperation: str | None = None
    kindness: str | None = None
    age_band: str | None = None
    gender: str | None = None
    note: str | None = None


@router.post("/owners", status_code=201)
async def create_owner(body: OwnerIn, user: CurrentUser = Depends(current_user)):
    """매도자를 **먼저** 만든다 — 매물보다 사람을 먼저 아는 경우가 흔하다(소개·전화).
    매물은 나중에 붙인다(PUT /owners/{id}/listings)."""
    if not body.name.strip():
        raise HTTPException(422, "이름이 필요합니다")
    oid = await pool().fetchval(
        """INSERT INTO app.owners(team_id, name, phone, owner_type, relation,
                                  cooperation, kindness, age_band, gender, note, created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id""",
        user.team_id, body.name.strip(), body.phone, body.owner_type, body.relation,
        body.cooperation, body.kindness, body.age_band, body.gender, body.note, user.account_id)
    return {"id": oid}


class OwnerListingIn(BaseModel):
    building_pk: str


@router.put("/owners/{oid}/listings")
async def attach_listing(oid: int, body: OwnerListingIn, user: CurrentUser = Depends(current_user)):
    """이 매도자에게 매물을 붙인다. 매물의 주인은 하나뿐이라(0058) 그냥 갈아 끼운다 —
    다른 사람 것이었다면 주인이 바뀐 것이고, 그건 기록이 아니라 사실의 정정이다."""
    ok = await pool().fetchval(
        "SELECT 1 FROM app.owners WHERE id=$1 AND team_id=$2 AND deleted_at IS NULL", oid, user.team_id)
    if not ok:
        raise HTTPException(404, "매도자를 찾을 수 없습니다")
    # 붙이는 사람이 담당자가 된다 — 담당자가 없으면 매물번호도 접수일도 안 나온다(0068 트리거).
    # 예전엔 owner_id 만 넣어서 「매도자 등록 → 매물 붙이기」로 만든 매물이 번호 없이 남았다.
    # 이미 담당자가 있으면 건드리지 않는다(남의 매물을 가로채면 안 된다 · claim 규칙).
    await pool().execute(
        """INSERT INTO app.listings(building_pk, team_id, owner_id, assignee_account_id)
           VALUES($1,$2,$3,$4)
           ON CONFLICT (building_pk, team_id) DO UPDATE
             SET owner_id = EXCLUDED.owner_id,
                 assignee_account_id = COALESCE(app.listings.assignee_account_id, EXCLUDED.assignee_account_id),
                 updated_at = now()""",
        body.building_pk, user.team_id, oid, user.account_id)
    return {"ok": True}


@router.get("/sales/sellers", openapi_extra={"x-ai": "read"})   # AI 가 부를 수 있다(10-AI §3-3)
async def list_sellers(mine: bool = False, owner_id: int | None = None,
                       user: CurrentUser = Depends(current_user)):
    """매물 단위 — 흐름 보드와 「이 매도자의 매물들」이 읽는다."""
    rows = await pool().fetch(
        """SELECT l.building_pk, l.owner_id, ns.*,
                  o.name AS owner_name, o.phone AS owner_phone, o.owner_type, o.relation,
                  o.cooperation, o.kindness, o.age_band AS owner_age_band,
                  o.gender AS owner_gender, o.note AS owner_note,
                  o.addr AS owner_addr, o.rep_name AS owner_rep_name,
                  o.corp_no AS owner_corp_no, o.nationality AS owner_nationality,
                  -- 관심 ↔ 매물(2026-08-16): 소유자를 잡았는가. 「연락처 따봐야겠다」로 찍어 둔
                  -- 건물(관심)과 실제로 굴리는 물건(매물)은 하는 일이 다르다.
                  (o.id IS NOT NULL) AS has_owner,
                  l.intent, l.urgency, l.call_result,
                  l.assignee_account_id, l.updated_at,
                  -- 나대지(2026-08-27): building_pk 가 'P'+pnu 인 매물은 건물이 아니라 빈 땅이다.
                  -- 주소·대지면적은 vacant_parcels 가 준다. 연면적은 없다 — 없는 것은 비워 둔다.
                  COALESCE(b.addr, vp.addr) AS addr,
                  COALESCE(b.land_area, vp.area) AS land_area, b.total_area,
                  (b.building_pk IS NULL AND vp.pnu IS NOT NULL) AS is_vacant,
                  -- 매매가는 **사람이 넣은 값만**(2026-08-18) — 마스터(추정가)로 미리 채우지
                  -- 않는다. 채워 두면 다들 호가인 줄 알아 오해가 선다. 추정가는 보조지표.
                  so.v::numeric AS price,
                  so.v::numeric AS list_price, se.sale_est AS est_price,
                  l.listing_no, l.received_on,
                  dp.deal_price,
                  ap.v::numeric AS ask_price,   -- 매도희망가 — S02 가격 협의와 같은 오버레이
                  -- 수익률 = 연임대(마스터 추정) ÷ 매매가 — 매매가가 비면 수익률도 빈다(미지정은 null)
                  CASE WHEN re.annual_rent > 0 AND so.v::numeric > 0
                       THEN round(re.annual_rent / so.v::numeric * 100, 2) END AS roi,
                  sc.sell_score, sc.use_type, ph.id AS photo_id,
                  -- 자료 창의 파생 상태(2026-08-18) — 정본은 건물 상세. 여기선 읽기만.
                  (SELECT count(*) FROM app.photos f
                    WHERE f.building_pk = l.building_pk AND f.team_id = l.team_id
                      AND f.deleted_at IS NULL) AS photo_n,
                  -- 종류별(외관·내부·건축물대장·토지이용계획…) — 자료 창이 「뭐가 빠졌나」를 센다
                  (SELECT COALESCE(jsonb_object_agg(t.kind, t.n), '{}'::jsonb)
                     FROM (SELECT f.kind, count(*) AS n FROM app.photos f
                            WHERE f.building_pk = l.building_pk AND f.team_id = l.team_id
                              AND f.deleted_at IS NULL GROUP BY f.kind) t) AS photo_kinds,
                  -- 산출물별 매칭(2026-08-18) — 분석보고서와 브리핑자료는 딴 물건이다.
                  -- 브리핑 생성은 폐지 상태(kind=analysis만)라 당분간 늘 false — 되살릴지는 역할 확정 후.
                  EXISTS (SELECT 1 FROM app.reports rp
                           JOIN app.team_members tm2 ON tm2.account_id = rp.account_id
                          WHERE rp.building_pk = l.building_pk AND tm2.team_id = l.team_id
                            AND rp.status = 'done' AND rp.kind = 'analysis') AS has_report,
                  EXISTS (SELECT 1 FROM app.reports rp
                           JOIN app.team_members tm2 ON tm2.account_id = rp.account_id
                          WHERE rp.building_pk = l.building_pk AND tm2.team_id = l.team_id
                            AND rp.status = 'done' AND rp.kind = 'briefing') AS has_briefing,
                  l.meongdo, l.use_change, l.myeolsil, l.nohudo, l.ipji,
                  l.ad_status, l.ad_off, l.co_sent_on,
                  l.sell_on, l.sell_vague, l.rent_check,
                  fr.rent_n, fr.rent_vac,
                  ob.id AS owner_buyer_id,
                  c.last_on, c.last_kind, c.last_note, sl.cell_last_on,
                  -- 사다리 단계는 **파생**이다(0091 뷰) — 목록·상세·대시보드가 같은 계산을 본다
                  vs.stage, vs.passed, vs.info_filled,
                  -- 칸별 플래그 — 사다리는 순서 강제가 아니라 지도다. 칸은 **각자 근거로** 판정되고
                  -- 병렬로 진행된다(의사도 모르는 매물에 광고가 올라가 있는 게 실무다).
                  vs.s1_owner, vs.s2_touch, vs.s3_intent, vs.s4_info, vs.s5_asset, vs.s6_match, vs.s6_open,
                  vs.cells, ldc.cells AS deal_cells, COALESCE(ng.nego, 0) AS nego,
                  -- 열린 보류 — 「지금은 안 본다」와 그 사유(0090·0140)
                  st.id AS stop_id, st.stage AS stop_stage, st.reason AS stop_reason
           FROM app.listings l
           LEFT JOIN app.owners o ON o.id = l.owner_id AND o.deleted_at IS NULL   -- 0058
           LEFT JOIN master.buildings b ON b.building_pk = l.building_pk
           LEFT JOIN master.vacant_parcels vp ON l.building_pk = 'P' || vp.pnu
           LEFT JOIN master.building_score sc ON sc.building_pk = l.building_pk
           LEFT JOIN master.building_sale_est se ON se.building_pk = l.building_pk
           LEFT JOIN master.building_rent_est re ON re.building_pk = l.building_pk
           LEFT JOIN app.v_listing_stage vs
                  ON vs.building_pk = l.building_pk AND vs.team_id = l.team_id
           LEFT JOIN app.stops st
                  ON st.team_id = l.team_id AND st.target_type='listing'
                 AND st.target_id = l.building_pk AND st.resolved_at IS NULL
           -- 대표 사진 — 외관 먼저(서류가 표지로 올라오지 않게). 제안 목록과 같은 규칙.
           LEFT JOIN LATERAL (SELECT id FROM app.photos f
                               WHERE f.building_pk = l.building_pk AND f.team_id = l.team_id
                                 AND f.deleted_at IS NULL
                               ORDER BY (f.kind = 'exterior') DESC, f.sort_order, f.id
                               LIMIT 1) ph ON TRUE
           LEFT JOIN LATERAL (SELECT value AS v FROM app.overlays ov
                               WHERE ov.team_id = l.team_id AND ov.target_type='building'
                                 AND ov.target_id = l.building_pk AND ov.field='sale_price'
                                 AND ov.value ~ '^[0-9.]+$') so ON TRUE
           LEFT JOIN LATERAL (SELECT value AS v FROM app.overlays ov
                               WHERE ov.team_id = l.team_id AND ov.target_type='building'
                                 AND ov.target_id = l.building_pk AND ov.field='ask_price'
                                 AND ov.value ~ '^[0-9.]+$') ap ON TRUE
           -- 다음 일정 — 머리의 「상태 + 다음 일정」 재료(2026-08-15). 예정만, 오늘 이후만.
           LEFT JOIN LATERAL (SELECT s.title AS next_sched_title, s.on_date AS next_sched_on,
                                     s.at_time AS next_sched_at
                                FROM app.schedules s
                               WHERE s.team_id = l.team_id AND s.building_pk = l.building_pk
                                 AND s.state='예정' AND s.on_date >= current_date
                               ORDER BY s.on_date, s.at_time NULLS LAST LIMIT 1) ns ON TRUE
           -- 매물의 계약가 = **계약 상대**의 합의값(2026-08-20). 예전엔 status IN ('계약',…)
           -- 만 봤는데, 계약은 이제 picked_at + deal_price 로 선다 — 그래서 레일은 계약·잔금·
           -- 신고까지 초록인데 프로필 값은 매매가로 남는 어긋남이 났다(삼성동 147-4).
           LEFT JOIN LATERAL (SELECT p2.deal_price FROM app.proposals p2
                               WHERE p2.team_id = l.team_id AND p2.building_pk = l.building_pk
                                 AND p2.deal_price IS NOT NULL
                                 AND p2.picked_at IS NOT NULL
                               ORDER BY (p2.picked_at IS NOT NULL) DESC, p2.updated_at DESC
                               LIMIT 1) dp ON TRUE
           -- 협의 단계(0127) — 짝들 중 **가장 앞선 것**이 이 매물의 협의 상태다
           LEFT JOIN LATERAL (SELECT max(app.nego_rank(p5)) AS nego
                                FROM app.proposals p5
                               WHERE p5.team_id = l.team_id
                                 AND p5.building_pk = l.building_pk) ng ON TRUE
           -- 대표 제안의 **거래 칸**(2026-08-20) — 이게 없으면 목록의 점이 「잔금」에 멈춘 채
           -- 레일만 초록이 된다(두 화면이 다른 말을 한다). 대표는 계약 상대가 1순위.
           LEFT JOIN LATERAL (
               SELECT vp.cells
                 FROM app.proposals p4
                 JOIN app.v_proposal_stage vp ON vp.id = p4.id
                WHERE p4.team_id = l.team_id AND p4.building_pk = l.building_pk
                  AND p4.dropped_at IS NULL
                ORDER BY (p4.picked_at IS NOT NULL) DESC, p4.id DESC
                LIMIT 1) ldc ON TRUE
           -- 「소유자 찾기 시작 전」 표식(2026-08-18) — 손으로 회색에 되돌린 지점.
           -- 움직임(last_on)은 표식 **이후**만 센다(표식 줄 자신은 id> 로 저절로 빠진다)
           -- 임대내역 요약(정보 창 「밖에서 아는 것」) — 정본은 건물 상세의 임대차 표
           LEFT JOIN LATERAL (SELECT count(*) AS rent_n,
                                     count(*) FILTER (WHERE is_vacant) AS rent_vac
                                FROM app.floor_rents f2
                               WHERE f2.building_pk = l.building_pk AND f2.team_id = l.team_id
                                 AND f2.deleted_at IS NULL) fr ON TRUE
           -- 소유자가 매수자 명단에도 있나(전화 숫자 일치) — 의사 창 「매수도 원함」 칩의 근거
           LEFT JOIN LATERAL (SELECT b2.id FROM app.buyers b2
                               WHERE b2.team_id = l.team_id AND b2.deleted_at IS NULL
                                 AND o.phone IS NOT NULL
                                 AND regexp_replace(COALESCE(b2.phone,''),'\D','','g')
                                     = regexp_replace(o.phone,'\D','','g')
                               ORDER BY b2.id LIMIT 1) ob ON TRUE
           LEFT JOIN LATERAL (SELECT COALESCE(max(id), 0) AS mid FROM app.contacts m
                               WHERE m.team_id = l.team_id AND m.target_type='listing'
                                 AND m.target_id = l.building_pk
                                 AND m.note = '소유자 찾기 시작 전') mk ON TRUE
           -- 칸별 움직임(2026-08-18) — **판정 근거는 한 곳**이다: 목록·레일·창이 같은 값을 본다.
           -- 칸마다 「그 칸의 줄」만 세고(창의 장부 규칙과 동일), 「시작 전」 표식 이후만 본다.
           -- 지움·되돌림·표식 줄은 움직임이 아니다(되돌린 게 도로 진행중이 되면 안 된다).
           LEFT JOIN LATERAL (
             SELECT jsonb_object_agg(k.cell, k.last_on) AS cell_last_on FROM (
               SELECT c2.cell,
                      max(x.occurred_on) FILTER (
                        WHERE x.id > COALESCE((SELECT max(m.id) FROM app.contacts m
                                                WHERE m.team_id = l.team_id AND m.target_type='listing'
                                                  AND m.target_id = l.building_pk
                                                  AND m.note = c2.cell_ko || ' 시작 전'), 0)
                          AND x.note NOT LIKE '%지움%' AND x.note NOT LIKE '되돌림%'
                          AND x.note NOT LIKE '%시작 전'
                          AND (CASE c2.cell
                                 WHEN 'owner'  THEN ((NOT x.auto AND x.kind IS NULL)
                                                     OR (x.auto AND x.note LIKE '소유자%'))
                                 WHEN 'touch'  THEN (x.kind IN ('통화','접촉')
                                                     OR (x.auto AND x.note LIKE '접촉%'))
                                 WHEN 'intent' THEN (x.kind = '의사' OR (x.auto AND x.note LIKE '의사%'))
                                 WHEN 'info'   THEN (x.kind = '정보' OR (x.auto AND x.note LIKE '정보%'))
                                 ELSE (x.kind = '매칭' OR (x.auto AND x.note LIKE '매칭%'))
                               END)) AS last_on
                 FROM (VALUES ('owner','소유자 찾기'), ('touch','접촉'), ('intent','의사 확인'),
                              ('info','정보'), ('match','매칭')) AS c2(cell, cell_ko)
                 LEFT JOIN app.contacts x
                        ON x.team_id = l.team_id AND x.target_type='listing'
                       AND x.target_id = l.building_pk
                GROUP BY c2.cell) k) sl ON TRUE
           LEFT JOIN LATERAL (SELECT max(occurred_on) FILTER (WHERE ct.id > mk.mid) AS last_on,
                                     (array_agg(kind ORDER BY occurred_on DESC, id DESC))[1] AS last_kind,
                                     (array_agg(note ORDER BY occurred_on DESC, id DESC))[1] AS last_note
                                FROM app.contacts ct
                               WHERE ct.team_id = l.team_id AND ct.target_type='listing'
                                 AND ct.target_id = l.building_pk) c ON TRUE
           WHERE l.team_id = $1
             AND ($2::bigint IS NULL OR l.assignee_account_id = $2)
             AND ($3::bigint IS NULL OR l.owner_id = $3)
           ORDER BY l.updated_at DESC""",
        user.team_id, user.account_id if mine else None, owner_id)
    out = []
    for r in rows:
        d = dict(r)
        # 소유자 연락처 = 매수자와 같은 경계(담당자 본인·대표만) — 어느 화면에서 보든 같은 규칙
        if not _can_see(user, d.get("assignee_account_id")):
            d["owner_phone"] = _mask(d.get("owner_phone"))
            d["phone_masked"] = True
        out.append(d)
    return out


@router.delete("/contacts/{cid}")
async def delete_contact(cid: int, user: CurrentUser = Depends(current_user)):
    """기록 삭제 — 지우면 남은 마지막 기록이 만든 단계로 되돌아간다(매물 상태는 장부의 파생값).
    삭제는 **담당자 본인 또는 대표만**(매수 쪽과 같은 경계) — 열람은 팀 공유지만
    남의 매물 기록을 지우는 건 다른 문제다(권한 점검 2026-08-13)."""
    row = await pool().fetchrow(
        """SELECT target_type, target_id, status, auto, prev, occurred_on
             FROM app.contacts WHERE id=$1 AND team_id=$2""",
        cid, user.team_id)
    if not row:
        raise HTTPException(404, "기록을 찾을 수 없습니다")
    if row["target_type"] == "listing":
        assignee = await pool().fetchval(
            "SELECT assignee_account_id FROM app.listings WHERE building_pk=$1 AND team_id=$2",
            row["target_id"], user.team_id)
        if assignee is not None and not _can_see(user, assignee):
            raise HTTPException(403, "기록 삭제는 담당자 본인 또는 대표만 할 수 있습니다")
    await pool().execute("DELETE FROM app.contacts WHERE id=$1 AND team_id=$2", cid, user.team_id)
    await schedule_retract(user.team_id, contact_id=cid)   # 일정 + 참석자 거울 + 상태 로그(H1)
    # 이 커밋이 덮었던 가격을 되돌린다(0078)
    if row["prev"]:
        await overlays_restore(user.team_id, row["target_id"], row["prev"], user.account_id)
    if row["target_type"] == "listing":
        # 거울 거두기(0067) — 사람이 쓴 계약·계약파기를 지웠으면 반대편 짝의 사실도 거짓이 된다.
        if not row["auto"] and row["status"] in MIRRORED:
            await pool().execute(
                """UPDATE app.proposals SET
                     picked_at  = CASE WHEN $3='계약'     THEN NULL ELSE picked_at  END,
                     dropped_at = CASE WHEN $3='계약파기' THEN NULL ELSE dropped_at END,
                     updated_at = now()
                   WHERE team_id=$1 AND building_pk=$2""",
                user.team_id, row["target_id"], row["status"])
            # 이 줄이 완료시킨 일정은 예정으로(직접 낳은 표는 위 retract 가 지웠다)
            await event_unmark(user.team_id, contact_id=cid)
    return {"ok": True}


# ── 개인화 프로필(F-23 1단계) ───────────────────────────
# "시작해볼 곳"의 조준을 본인이 말한 방식으로. 행동 학습(2단계)은 베타 데이터 쌓인 뒤.
class ProfileIn(BaseModel):
    regions: list[str] | None = None      # 시군구코드 5자리
    style: int | None = None              # 1=급매·회전 / 3=중간 / 5=관계·장기
    price_min: int | None = None
    price_max: int | None = None
    use_types: list[str] | None = None


async def _sched_guard(sch, user: CurrentUser) -> None:
    """일정을 **손대는** 것은 담당자 본인만 — **대표도 못 한다**.

    기록 삭제는 대표에게 열어 뒀다(팀 장부가 정확해야 하니까). 약속은 다르다:
    그 사람이 상대와 잡은 시간이라, 옮기려면 상대와 다시 통화해야 한다. 대표가 캘린더에서
    끌어 옮겨 봐야 상대는 모른다 — 앱에서만 참인 약속이 생긴다. 보는 건 팀 전체 공유다.
    담당 = 일정 자기 담당, 없으면 매물 담당(화면의 COALESCE와 같은 규칙).
    """
    assignee = sch["assignee_account_id"]
    if assignee is None and sch["building_pk"]:
        assignee = await pool().fetchval(
            "SELECT assignee_account_id FROM app.listings WHERE building_pk=$1 AND team_id=$2",
            sch["building_pk"], user.team_id)
    if assignee is not None and assignee != user.account_id:
        raise HTTPException(403, "일정은 담당자 본인만 고칠 수 있습니다")


class SchedulePatch(BaseModel):
    on_date: str | None = None      # 끌어서 옮김
    at_time: str | None = None      # HH:MM · 빈 문자열이면 「미정으로 되돌리기」
    title: str | None = None        # 용무
    place: str | None = None        # 장소
    assignee_account_id: int | None = None
    people: list[PersonIn] | None = None   # 주면 통째로 갈아 끼운다
    state: str | None = None        # 예정 · 완료 · 취소
    category: str | None = None      # 일정 종류(0088) — 일반·계약·중도금·잔금
    amount: int | None = None        # 돈이 오가는 약속의 금액(0128) — 중도금·잔금


SCHED_STATES = ("예정", "완료")   # 취소는 없앴다(0074) — 깨진 약속은 지운다


@router.patch("/schedules/{sid}")
async def patch_schedule(sid: int, body: SchedulePatch, user: CurrentUser = Depends(current_user)):
    sch = await pool().fetchrow(
        "SELECT * FROM app.schedules WHERE id=$1 AND team_id=$2", sid, user.team_id)
    if sch is None:
        raise HTTPException(404, "일정을 찾을 수 없습니다")
    # 일정은 한 종류다(0089) — 계약이든 잔금이든 옮기고 지우는 규칙이 같다.
    # 장부와의 아귀는 거울이 맞춘다(체크를 풀면 그 ✓가 낳은 계약 커밋이 걷힌다).
    await _sched_guard(sch, user)
    if body.state and body.state not in SCHED_STATES:
        raise HTTPException(422, f"일정 상태는 {'/'.join(SCHED_STATES)} 중 하나")

    if body.on_date:
        new = _d(body.on_date)
        old = sch["on_date"]
        if new != old:
            # 제자리로 되돌아왔으면 미뤄진 표를 지운다 — 안 지우면 「원래 8/18」이라고
            # 적힌 채 8/18에 서 있는 거짓말이 남는다. 옮긴 사정은 장부가 들고 있다.
            back = new == sch["moved_from"]
            await pool().execute(
                """UPDATE app.schedules
                      SET on_date=$3,
                          moved_from = CASE WHEN $5 THEN NULL ELSE COALESCE(moved_from, $4) END,
                          state='예정'
                    WHERE id=$1 AND team_id=$2""", sid, user.team_id, new, old, back)
            await schedule_log(user.team_id, sch, user.account_id,
                                f"{sch['title']} {old:%-m/%-d} → {new:%-m/%-d} 로 미룸")
    # 용무·장소·담당·시각 — 약속의 살. 값이 오면 그것만 고친다.
    for col, val in (("title", body.title), ("place", body.place)):
        if val is not None:
            await pool().execute(
                f"UPDATE app.schedules SET {col}=$3 WHERE id=$1 AND team_id=$2",
                sid, user.team_id, val.strip() or None)
    if body.at_time is not None:
        await pool().execute(
            "UPDATE app.schedules SET at_time=$3 WHERE id=$1 AND team_id=$2",
            sid, user.team_id, _t(body.at_time) if body.at_time else None)
    if body.amount is not None:
        await pool().execute(
            "UPDATE app.schedules SET amount=$3 WHERE id=$1 AND team_id=$2",
            sid, user.team_id, body.amount)
    if body.category is not None:
        if body.category not in SCHED_CATEGORIES:
            raise HTTPException(422, f"일정 종류는 {'/'.join(SCHED_CATEGORIES)} 중 하나")
        await pool().execute(
            "UPDATE app.schedules SET category=$3, contract=($3='계약') WHERE id=$1 AND team_id=$2",
            sid, user.team_id, body.category)
    if body.assignee_account_id is not None:
        ok = await pool().fetchval(
            """SELECT 1 FROM app.team_members WHERE team_id=$1 AND account_id=$2 AND left_at IS NULL""",
            user.team_id, body.assignee_account_id)
        if not ok:
            raise HTTPException(422, "같은 팀 사람만 담당으로 둘 수 있습니다")
        await pool().execute(
            "UPDATE app.schedules SET assignee_account_id=$3 WHERE id=$1 AND team_id=$2",
            sid, user.team_id, body.assignee_account_id)
    if body.people is not None:
        for pn in body.people:
            if pn.kind not in ("buyer", "owner", "guest"):
                raise HTTPException(422, "참석자 종류는 buyer/owner/guest")
            if pn.kind == "guest" and not (pn.label or pn.phone):
                raise HTTPException(422, "이름이나 번호 중 하나는 있어야 합니다")
        # 명단 교체 = 생성과 **같은 함수** — 새로 부른 사람의 장부에도 거울이 서고,
        # 뺀 사람의 거울은 걷힌다(H5: 편집만 거울이 없던 비대칭을 없앤다)
        origin = None       # 사람 장부에서 난 일정이면 그 사람 자신은 거울 밖(생성 때와 같은 규칙)
        if sch["contact_id"] and not sch["building_pk"] and not sch["proposal_id"]:
            oc = await pool().fetchrow(
                "SELECT target_type, target_id FROM app.contacts WHERE id=$1 AND team_id=$2",
                sch["contact_id"], user.team_id)
            if oc and oc["target_type"] in ("buyer", "owner"):
                origin = (oc["target_type"], int(oc["target_id"]))
        skip_buyer, skip_owner = mirror_skips(
            building_pk=sch["building_pk"], proposal_id=sch["proposal_id"], person=origin)
        await attendees_sync(
            user.team_id, sid, user.account_id, body.people,
            on=_d(body.on_date) if body.on_date else sch["on_date"],
            at=(body.at_time or (sch["at_time"].strftime("%H:%M") if sch["at_time"] else None)),
            title=body.title or sch["title"], place=body.place if body.place is not None else sch["place"],
            skip_buyer_side=skip_buyer, skip_owner_side=skip_owner, skip_person=origin,
            building_pk=sch["building_pk"])
    # 브리핑 약속을 완료하면 **그 방식이 브리핑 값이 된다**(0111) — 캘린더에서 찍어도 같다.
    # 창에서만 옮기면 「캘린더로 끝냈더니 브리핑이 비어 있다」가 된다.
    if body.state == "완료" and sch["category"] == "브리핑" and sch["proposal_id"]:
        # 소화 = 「했다」 — 브리핑 날짜가 자동으로 기입된다(2026-08-24). 방식은 있을 때만 병합
        await pool().execute(
            """UPDATE app.proposals
                  SET briefed_on = COALESCE(briefed_on, $3),
                      brief_how = CASE WHEN $4::text IS NULL THEN brief_how
                                       ELSE (SELECT array_agg(DISTINCT e)
                                               FROM unnest(COALESCE(brief_how, '{}') || ARRAY[$4::text]) e) END
                WHERE team_id=$1 AND id=$2""",
            user.team_id, sch["proposal_id"], sch["on_date"], sch["method"])

    if body.state and body.state != sch["state"]:
        # 완료 ↔ 예정 — 예정으로 되돌리면 「완료」 로그도 걷힌다(H2). 한 길: mirror.schedule_set_state
        await schedule_set_state(user.team_id, sch, user.account_id, body.state)   # 「8/21 방문 완료」
    return {"ok": True}


class ScheduleNew(BaseModel):
    """맨손으로 만드는 일정(2026-08-25) — 캘린더 앱처럼 날짜에서 바로 만든다.
    매물도 사람도 안 붙을 수 있다. 「사무실 청소」 같은 일에 붙일 장부가 없다."""
    title: str
    on: str
    at: str | None = None
    place: str | None = None
    hint: str | None = None
    category: str | None = None
    method: str | None = None
    building_pk: str | None = None
    people: list[PersonIn] | None = None
    assignee_account_id: int | None = None


@router.post("/schedules", status_code=201)
async def create_schedule(body: ScheduleNew, user: CurrentUser = Depends(current_user)):
    if body.category and body.category not in SCHED_CATEGORIES:
        raise HTTPException(422, f"일정 종류는 {'/'.join(SCHED_CATEGORIES)} 중 하나")
    if body.building_pk:
        own = await pool().fetchval(
            "SELECT 1 FROM app.listings WHERE team_id=$1 AND building_pk=$2",
            user.team_id, body.building_pk)
        if not own:
            raise HTTPException(404, "우리 매물이 아닙니다")
    # 만드는 동사는 거울 한 곳뿐이다 — 참석자·장부 줄이 여기서 같이 선다
    sid = await schedule_create(
        user.team_id, "sell", body, user.account_id,
        building_pk=body.building_pk, category=body.category)
    return {"id": sid}


@router.delete("/schedules/{sid}")
async def delete_schedule(sid: int, user: CurrentUser = Depends(current_user)):
    """일정을 지우면 **그 일정을 만든 커밋도 같이 지운다**(0072·거울).

    캘린더는 커밋의 파생물이다. 일정만 지우고 커밋이 남으면 장부엔 「다음주 화 브리핑」이
    적혀 있는데 캘린더엔 없는, 서로 다른 두 진실이 생긴다. 한쪽을 지우면 다른 쪽도 간다 —
    커밋을 지웠을 때 일정이 걷히는 것과 같은 규칙의 반대 방향이다.
    (화면에서 「기록도 같이 지웁니다」라고 묻고 나서 부른다.)
    """
    sch = await pool().fetchrow(
        "SELECT * FROM app.schedules WHERE id=$1 AND team_id=$2", sid, user.team_id)
    if sch is None:
        raise HTTPException(404, "일정을 찾을 수 없습니다")
    await _sched_guard(sch, user)
    # **지운 일정이 실어 나르던 사실도 함께 걷는다**(2026-08-19).
    #   계약 일정의 ✓ 는 곧 계약 체결이다. 지운다는 건 시험 삼아 만들었거나 잘못 만들었다는
    #   뜻인데, 그게 「계약된 매물」로 남으면 그 뒤 화면이 전부 거짓말을 한다.
    #   되돌리기(✓ 해제)가 이미 그 회수를 안다 — 지우기는 그 위에 얹는다(길은 하나).
    if sch["state"] == "완료":
        await schedule_set_state(user.team_id, sch, user.account_id, "예정")
    await schedule_retract(user.team_id, schedule_id=sid)   # 일정 + 참석자 거울 + 상태 로그

    # 근거 커밋도 같이 지운다 — **다만 그 문장이 약속만 담고 있을 때만**.
    # 실제 문장은 둘을 같이 담는다: 「148억으로 낮추고 다음주 화에 보기로」.
    # 여기서 커밋째 지우면 가격을 낮춘 근거까지 사라진다 — 캘린더를 정리하다 장부가 상한다.
    # 그래서 단계를 옮겼거나 금액이 실린 커밋은 **문장을 남기고 일정만 걷는다**.
    if sch["contact_id"]:
        c = await pool().fetchrow(
            "SELECT status, note FROM app.contacts WHERE id=$1 AND team_id=$2",
            sch["contact_id"], user.team_id)
        bare = c is not None and c["status"] is None and not _has_money(c["note"])
        if bare:
            await pool().execute("DELETE FROM app.contacts WHERE id=$1 AND team_id=$2",
                                 sch["contact_id"], user.team_id)
    return {"ok": True}


@router.get("/sales/schedule", openapi_extra={"x-ai": "read"})   # AI 가 부를 수 있다(10-AI §3-3)
async def sales_schedule(start: str, end: str, mine: bool = False,
                         user: CurrentUser = Depends(current_user)):
    """캘린더 한 화면치 — 그 달에 잡힌 약속들.

    **열람은 팀 공유**(R7) — 팀원이 어디에 가 있는지 서로 보여야 일정이 겹치지 않는다.
    대신 대시보드와 같은 「내 담당 / 팀 전체」 자를 둔다. 담당자는 매물에서 온다
    (매수 약속도 결국 그 매물의 담당이 누구냐로 갈린다).
    """
    rows = await pool().fetch(
        """SELECT s.id, s.side, s.title, s.on_date, s.at_time, s.hint, s.state, s.kind, s.moved_from,
                  s.place, s.building_pk, s.proposal_id, p.buyer_id, b.addr,
                  (s.promoted_by_contact_id IS NOT NULL) AS promoted, s.contract, s.category,
                  -- 일정 담당은 일정 자체에 있다(0075) — 매물 담당과 다를 수 있다(대신 가기도 한다)
                  COALESCE(s.assignee_account_id, l.assignee_account_id) AS assignee_account_id,
                  COALESCE(sa.name, ac.name) AS assignee_name,
                  -- 오는 사람들 — 계약 날엔 매도자와 매수자가 같이 온다
                  COALESCE((SELECT json_agg(json_build_object(
                              'id', sp.id, 'kind', sp.ref_kind, 'ref_id', sp.ref_id,
                              'label', COALESCE(sp.label, y2.name, o2.name), 'phone', sp.phone)
                              ORDER BY sp.id)
                            FROM app.schedule_people sp
                            LEFT JOIN app.buyers y2 ON y2.id = sp.ref_id AND sp.ref_kind='buyer'
                            LEFT JOIN app.owners o2 ON o2.id = sp.ref_id AND sp.ref_kind='owner'
                            WHERE sp.schedule_id = s.id), '[]'::json) AS people,
                  -- 이 일정을 만든 **장부 원문**. 날짜만 보면 「무슨 얘기 끝에 잡힌 약속인지」를
                  -- 모른다 — 캘린더에서 장부로 건너뛰지 않고 바로 읽히게 같이 싣는다.
                  COALESCE(y.name, o.name) AS who,
                  ct.note AS src_note, ct.occurred_on AS src_on, ca.name AS src_by
           FROM app.schedules s
           LEFT JOIN app.proposals p ON p.id = s.proposal_id AND p.team_id = s.team_id
           LEFT JOIN app.buyers y ON y.id = p.buyer_id
           LEFT JOIN app.listings l ON l.building_pk = s.building_pk AND l.team_id = s.team_id
           LEFT JOIN app.owners o ON o.id = l.owner_id
           LEFT JOIN master.buildings b ON b.building_pk = s.building_pk
           LEFT JOIN app.accounts ac ON ac.id = l.assignee_account_id
           LEFT JOIN app.accounts sa ON sa.id = s.assignee_account_id
           LEFT JOIN app.contacts ct ON ct.id = s.contact_id
           LEFT JOIN app.accounts ca ON ca.id = ct.created_by
           WHERE s.team_id = $1
             AND s.on_date BETWEEN $2::date AND $3::date
             AND ($4::bigint IS NULL
                  OR COALESCE(s.assignee_account_id, l.assignee_account_id) = $4)
           ORDER BY s.on_date, s.at_time NULLS LAST, s.id""",
        user.team_id, dt.date.fromisoformat(start[:10]), dt.date.fromisoformat(end[:10]),
        user.account_id if mine else None)
    # asyncpg 는 json 을 문자열로 준다 — 화면이 배열로 받게 여기서 푼다
    out = []
    for r in rows:
        d = dict(r)
        if isinstance(d.get("people"), str):
            d["people"] = json.loads(d["people"])
        out.append(d)
    return out


@router.get("/sales/profile")
async def get_profile(user: CurrentUser = Depends(current_user)):
    row = await pool().fetchrow(
        "SELECT regions, style, price_min, price_max, use_types FROM app.broker_profile WHERE account_id=$1",
        user.account_id)
    return dict(row) if row else {"regions": None, "style": None, "price_min": None,
                                  "price_max": None, "use_types": None}


@router.put("/sales/profile")
async def put_profile(body: ProfileIn, user: CurrentUser = Depends(current_user)):
    if body.style is not None and body.style not in (1, 3, 5):
        raise HTTPException(422, "style은 1(급매)·3(중간)·5(관계)")
    await pool().execute(
        """INSERT INTO app.broker_profile(account_id, team_id, regions, style, price_min, price_max, use_types)
           VALUES($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (account_id) DO UPDATE SET
             regions=EXCLUDED.regions, style=EXCLUDED.style,
             price_min=EXCLUDED.price_min, price_max=EXCLUDED.price_max,
             use_types=EXCLUDED.use_types, updated_at=now()""",
        user.account_id, user.team_id, body.regions, body.style,
        body.price_min, body.price_max, body.use_types)
    return {"ok": True}


# 일하는 방식 → 매도 신호 축의 가중치. 급매·회전형은 실현이 임박한 신호(정비구역·지가·여유 용적)를,
# 관계·장기형은 시간이 만든 신호(보유·노후 — 길게 접근할 소유자)를 무겁게 본다.
# 근거 없는 정밀함을 피하려고 배율은 굵게(±40~60%) 두 단만 둔다. 검증은 행동 로그가 쌓인 뒤.
_STYLE_W = {
    1: {"hold": 0.6, "age": 0.8, "gongsi_up5": 1.4, "headroom": 1.2, "redevel": 1.6},
    3: {"hold": 1.0, "age": 1.0, "gongsi_up5": 1.0, "headroom": 1.0, "redevel": 1.0},
    5: {"hold": 1.5, "age": 1.3, "gongsi_up5": 0.8, "headroom": 1.0, "redevel": 0.6},
}


# ── 오늘 — 공이 누구에게 있나(턴) ───────────────────────
# 유형별로 흩지 않고 차례 하나로 가른다. 모든 건은 셋 중 하나다:
#   내 차례      — 지금 움직일 것. 기다리다 기한이 지난 건도 스스로 여기로 올라온다.
#   기다리는 중  — 상대 차례(브리핑 직후 · 답을 기다리는 중)
#   시작해볼 곳  — 아직 아무도 안 움직임(매도 신호)
# 경계값(2026-08-10 구조 QA로 확정):
BRIEF_DAYS = 3        # 브리핑하고 살 건지 못 들으면 승격(2026-08-25) — 자료를 보여준 뒤의 침묵은
                      # 그냥 안 돌린 것과 다르다. 사흘이면 매수자가 식기 시작한다
CAND_DAYS = 14        # 담아만 두면 승격 — 골라놓고 잊은 것이 조용히 사라지면 안 된다(T6)
COLD_DAYS = 30        # 활성 매수자 무접촉 → 식음. 신규 등록자는 등록일부터 유예(T1)
RECALL_DAYS = 7       # 진행 중 소유자 무접촉 → 재통화


@router.get("/sales/today", openapi_extra={"x-ai": "read"})   # AI 가 부를 수 있다(10-AI §3-3)
async def sales_today(mine: bool = True, user: CurrentUser = Depends(current_user)):
    me = user.account_id if mine else None
    my_turn: list[dict] = []
    waiting: list[dict] = []
    starters: list[dict] = []

    # 대시보드 요약 — "지금 판이 어떤 상태인가"를 숫자 네 개로. 행보다 먼저 읽힌다.
    stats = dict(await pool().fetchrow(
        f"""SELECT
             (SELECT count(*) FROM app.proposals p JOIN app.buyers y ON y.id=p.buyer_id AND y.deleted_at IS NULL
               WHERE p.team_id=$1 AND p.dropped_at IS NULL AND p.picked_at IS NULL) AS open_props,
             (SELECT count(*) FROM app.listings l WHERE l.team_id=$1
               AND {SELLER_LIVE.format(t="l")} AND NOT {SELLER_DONE.format(t="l")}) AS active_sellers,
             (SELECT count(*) FROM app.buyers y WHERE y.team_id=$1 AND y.deleted_at IS NULL
                AND (EXISTS (SELECT 1 FROM app.proposals p9 WHERE p9.buyer_id=y.id
                               AND p9.dropped_at IS NULL)
                     OR y.created_at >= current_date - 30)) AS buyers,
             (SELECT count(*) FROM app.contacts c WHERE c.team_id=$1
               AND c.occurred_on >= current_date - 6) AS week_contacts""", user.team_id))

    # ── 오늘·다가오는 일정(0070~0072) ─────────────────────────
    # 대시보드의 첫 질문은 「오늘 뭐 하지」다. 캘린더를 열지 않아도 답이 여기 있어야 한다.
    # 지난 예정은 **밀린 것**이다 — 끝냈으면 끝냈다고 찍혔을 테니, 안 찍힌 건 처리가 남았다.
    sched = await pool().fetch(
        """SELECT s.id, s.side, s.title, s.on_date, s.at_time, s.state, s.kind, s.category,
                  s.building_pk, s.place, s.proposal_id, p.buyer_id, b.addr,
                  COALESCE(s.assignee_account_id, l.assignee_account_id) AS assignee_account_id,
                  COALESCE(sa.name, ac.name) AS assignee_name,
                  s.on_date - current_date AS in_days,
                  -- 누가 오는가 — 여럿이면 화면이 「외 N」으로 접는다(한 명만 쓰면 거짓말이 된다)
                  COALESCE((SELECT json_agg(COALESCE(sp.label, y2.name, o2.name, sp.phone) ORDER BY sp.id)
                              FROM app.schedule_people sp
                              LEFT JOIN app.buyers y2 ON y2.id = sp.ref_id AND sp.ref_kind='buyer'
                              LEFT JOIN app.owners o2 ON o2.id = sp.ref_id AND sp.ref_kind='owner'
                             WHERE sp.schedule_id = s.id), '[]'::json) AS people
           FROM app.schedules s
           LEFT JOIN app.proposals p ON p.id = s.proposal_id AND p.team_id = s.team_id
           LEFT JOIN app.buyers y ON y.id = p.buyer_id
           LEFT JOIN app.listings l ON l.building_pk = s.building_pk AND l.team_id = s.team_id
           LEFT JOIN app.owners o ON o.id = l.owner_id
           LEFT JOIN app.accounts ac ON ac.id = l.assignee_account_id
           LEFT JOIN app.accounts sa ON sa.id = s.assignee_account_id
           LEFT JOIN master.buildings b ON b.building_pk = s.building_pk
           WHERE s.team_id = $1 AND s.state = '예정'
             AND s.on_date <= current_date + 7
             AND ($2::bigint IS NULL
                  OR COALESCE(s.assignee_account_id, l.assignee_account_id) = $2)
           ORDER BY s.on_date, s.at_time NULLS LAST, s.id""", user.team_id, me)
    def _s(r):
        d = dict(r)
        if isinstance(d.get("people"), str):
            d["people"] = json.loads(d["people"])
        return d
    today_sched = [_s(r) for r in sched if r["in_days"] == 0]
    overdue = [_s(r) for r in sched if r["in_days"] < 0]
    upcoming = [_s(r) for r in sched if r["in_days"] > 0]

    # ── 돈이 어떻게 흐르는가 ────────────────────────────────
    # 세 층으로 본다: **손에 든 것**(계약된 거래가) · **협의 중**(제안 걸린 매물의 값) ·
    # **들고 있는 것**(매물 호가 총액). 한 줄로 합치면 「얼마짜리 일을 하고 있나」가 안 보인다.
    money = dict(await pool().fetchrow(
        f"""SELECT
             -- 계약 = 상대 확정(picked_at) + 거래가. 상태 칸은 없앴다(0141).
             (SELECT COALESCE(sum(p.deal_price),0) FROM app.proposals p
               JOIN app.listings l2 ON l2.building_pk=p.building_pk AND l2.team_id=p.team_id
               WHERE p.team_id=$1 AND p.deal_price IS NOT NULL
                 AND p.picked_at IS NOT NULL AND p.dropped_at IS NULL
                 AND ($2::bigint IS NULL OR l2.assignee_account_id=$2)) AS contracted,
             (SELECT count(*) FROM app.proposals p
               JOIN app.listings l2 ON l2.building_pk=p.building_pk AND l2.team_id=p.team_id
               WHERE p.team_id=$1
                 AND p.picked_at IS NOT NULL AND p.dropped_at IS NULL
                 AND ($2::bigint IS NULL OR l2.assignee_account_id=$2)) AS contracted_n,
             (SELECT COALESCE(sum(GREATEST(p.hope_price, 0)),0) FROM app.proposals p
               JOIN app.listings l2 ON l2.building_pk=p.building_pk AND l2.team_id=p.team_id
               WHERE p.team_id=$1 AND p.hope_price IS NOT NULL AND p.dropped_at IS NULL
                 AND ($2::bigint IS NULL OR l2.assignee_account_id=$2)) AS negotiating,
             (SELECT count(*) FROM app.proposals p
               JOIN app.listings l2 ON l2.building_pk=p.building_pk AND l2.team_id=p.team_id
               WHERE p.team_id=$1 AND p.hope_price IS NOT NULL AND p.dropped_at IS NULL
                 AND ($2::bigint IS NULL OR l2.assignee_account_id=$2)) AS negotiating_n,
             (SELECT COALESCE(sum(ov.value::numeric),0) FROM app.listings l3
               LEFT JOIN app.overlays ov ON ov.team_id=l3.team_id AND ov.target_type='building'
                    AND ov.target_id=l3.building_pk AND ov.field='sale_price' AND ov.value ~ '^[0-9.]+$'
               WHERE l3.team_id=$1 AND NOT {SELLER_DONE.format(t="l3")}
                 AND ($2::bigint IS NULL OR l3.assignee_account_id=$2)) AS listed,
             (SELECT count(*) FROM app.listings l4 WHERE l4.team_id=$1
                 AND NOT {SELLER_DONE.format(t="l4")}
                 AND ($2::bigint IS NULL OR l4.assignee_account_id=$2)) AS listed_n""",
        user.team_id, me))

    # 「어떻게 흐르는가」 열은 뺐다(0142) — 매도 쪽 축이 상태 낱말이었는데 그 낱말이 없어졌고,
    # 애초에 이 값을 그리는 화면이 하나도 없었다.
    # 이번 달에 실제로 일어난 일 — **완료된 계약 일정**을 센다(0089: 일정은 한 종류)
    month = dict(await pool().fetchrow(
        """SELECT
             count(*) FILTER (WHERE s.category='계약') AS signed,
             count(*) FILTER (WHERE s.title='계약파기') AS broken
           FROM app.schedules s
           LEFT JOIN app.listings l ON l.building_pk=s.building_pk AND l.team_id=s.team_id
           WHERE s.team_id=$1 AND s.state='완료'
             AND s.on_date >= date_trunc('month', current_date)
             AND ($2::bigint IS NULL OR l.assignee_account_id=$2)""", user.team_id, me))

    # 매수 — 담긴 짝들. 재촉의 기준은 **매수희망가**다(0141).
    #
    # 희망가가 있다는 것은 「이 값이면 사겠다」를 들었다는 뜻이다 — 그럼 다음 수는
    # 사람 판단(값 조율·채택)이지 재촉이 아니다. 그래서 카드가 필요 없다.
    # 브리핑은 했는데 희망가가 없다면 **아직 답을 못 들은 것**이다: 「살 건지 물어보기」.
    # 브리핑도 안 했으면 그 앞이다: 「브리핑하기」.
    #
    # 예전엔 status='제안' + 날짜로 판단해서, 값을 조율하는 내내 「10일째 답 없음」이 떴다.
    # 이제 사실 하나(희망가)를 보므로 화면과 카드가 갈라질 자리가 없다.
    props = await pool().fetch(
        """SELECT p.id, p.buyer_id, p.building_pk,
                  -- 시계는 **사람이 남긴 사실**부터 센다(2026-08-29).
                  -- 브리핑했으면 브리핑한 날, 아직이면 **담은 날**(created_at).
                  -- updated_at 은 트리거가 매 UPDATE 마다 갱신해서, 값 하나만 고쳐도
                  -- 「담고 14일」이 0으로 돌아갔다.
                  COALESCE(p.briefed_on, p.created_at::date) AS since,
                  current_date - COALESCE(p.briefed_on, p.created_at::date) AS days,
                  (COALESCE(array_length(p.brief_how, 1), 0) > 0
                   OR p.briefed_on IS NOT NULL) AS briefed,
                  (p.hope_price IS NOT NULL) AS has_hope,
                  y.name AS buyer_name, b.addr,
                  COALESCE(so.v::numeric, se.sale_est) AS price
           FROM app.proposals p
           JOIN app.buyers y ON y.id = p.buyer_id AND y.deleted_at IS NULL
           LEFT JOIN master.buildings b ON b.building_pk = p.building_pk
           LEFT JOIN master.building_sale_est se ON se.building_pk = p.building_pk
           LEFT JOIN LATERAL (SELECT value AS v FROM app.overlays ov
                               WHERE ov.team_id=p.team_id AND ov.target_type='building'
                                 AND ov.target_id=p.building_pk AND ov.field='sale_price'
                                 AND ov.value ~ '^[0-9.]+$') so ON TRUE
           WHERE p.team_id=$1 AND p.dropped_at IS NULL AND p.picked_at IS NULL
             AND ($2::bigint IS NULL OR y.assignee_account_id = $2)
             -- 보류 중인 짝은 재촉하지 않는다 — 공이 아무에게도 없다
             AND NOT EXISTS (SELECT 1 FROM app.stops st
                              WHERE st.team_id=p.team_id AND st.target_type='proposal'
                                AND st.target_id=p.id::text AND st.resolved_at IS NULL)
           ORDER BY 4""", user.team_id, me)
    for r in props:
        d = dict(r); days = d["days"] or 0
        has_hope = d.pop("has_hope", False)
        if has_hope:
            # 「이 값이면 사겠다」를 들었다 — 공은 우리 판단에 있지 재촉에 있지 않다
            continue
        if d.get("briefed"):
            if days >= BRIEF_DAYS:
                my_turn.append({**d, "kind": "살건지묻기", "side": "매수",
                                "why": f"브리핑 뒤 {days}일째 살 건지 못 들음"})
            else:
                waiting.append({**d, "kind": "검토중", "side": "매수", "why": f"브리핑 · {days}일"})
        elif days >= CAND_DAYS:   # 담아만 두고 잊은 것
            my_turn.append({**d, "kind": "브리핑하기", "side": "매수",
                            "why": f"담고 {days}일째 안 보여줌"})

    # 매도 — 진행 중(종결 제외)인데 공이 우리에게 온 소유자.
    #   접촉 전 = 첫 전화(T2) · 접촉 후 RECALL_DAYS 무접촉 = 재통화(T3) · 계약된 것 제외(T4)
    sellers = await pool().fetch(
        f"""SELECT l.building_pk, l.owner_id, o.name AS owner_name, l.intent, b.addr,
                  c.last_on, current_date - c.last_on AS days,
                  sc.sell_score, se.sale_est AS price
           FROM app.listings l
           LEFT JOIN app.owners o ON o.id = l.owner_id AND o.deleted_at IS NULL   -- 0058
           LEFT JOIN master.buildings b ON b.building_pk = l.building_pk
           LEFT JOIN master.building_score sc ON sc.building_pk = l.building_pk
           LEFT JOIN master.building_sale_est se ON se.building_pk = l.building_pk
           -- **사람이 남긴 줄만** 접촉으로 센다(2026-08-29). 일정을 만들면 매물 장부에
           -- 자동 거울 줄이 한 줄 서는데, 통화를 안 했는데도 그게 재통화 시계를 되돌렸다.
           LEFT JOIN LATERAL (SELECT max(occurred_on) AS last_on FROM app.contacts ct
                               WHERE ct.team_id=l.team_id AND ct.target_type='listing'
                                 AND ct.target_id=l.building_pk AND NOT ct.auto) c ON TRUE
           WHERE l.team_id=$1
             AND NOT {SELLER_DONE.format(t="l")} AND {SELLER_LIVE.format(t="l")}
             -- 보류 중이면 재촉이 무의미하다(S04b §2.4) — 사람이 보류를 풀면 다시 뜬다.
             -- 이게 없으면 「26년 봄에 매각예정」인 건에 매일 「연락할 차례」가 뜬다.
             AND NOT EXISTS (SELECT 1 FROM app.stops st
                              WHERE st.team_id=l.team_id AND st.target_type='listing'
                                AND st.target_id=l.building_pk AND st.resolved_at IS NULL)
             AND (c.last_on IS NULL OR c.last_on <= current_date - $2::int)
             -- 담당 미지정 리드는 팀 공동 — '내 담당'에서도 보인다(안 보이면 아무도 안 챙긴다)
             AND ($3::bigint IS NULL OR l.assignee_account_id = $3 OR l.assignee_account_id IS NULL)
           ORDER BY c.last_on NULLS FIRST LIMIT 20""", user.team_id, RECALL_DAYS, me)
    for r in sellers:
        d = dict(r)
        if r["last_on"] is None:
            my_turn.append({**d, "kind": "첫전화", "side": "매도",
                            "why": "담아두고 아직 접촉 전"})
        else:
            my_turn.append({**d, "kind": "재통화", "side": "매도",
                            "why": f"마지막 통화 {r['days']}일 전"})

    # 매수 — 오래 못 만난 활성 매수자. 방금 등록한 사람은 식은 게 아니다(T1) — 등록일부터 센다.
    cold = await pool().fetch(
        """SELECT y.id AS buyer_id, y.name AS buyer_name, y.grade, c.last_on,
                  current_date - COALESCE(c.last_on, y.created_at::date) AS days
           FROM app.buyers y
           -- 매도 쪽과 같은 규칙 — 사람이 남긴 줄만(자동 거울 줄은 접촉이 아니다)
           LEFT JOIN LATERAL (SELECT max(occurred_on) AS last_on FROM app.contacts ct
                               WHERE ct.team_id=y.team_id AND ct.target_type='buyer'
                                 AND ct.target_id = y.id::text AND NOT ct.auto) c ON TRUE
           WHERE y.team_id=$1 AND y.deleted_at IS NULL
             -- 살아있는 손님만(파생·0087): 살아있는 짝이 있거나 90일 내 움직임 — 휴면 고인물은 소음
             AND (EXISTS (SELECT 1 FROM app.proposals p2 WHERE p2.buyer_id=y.id
                            AND p2.dropped_at IS NULL)
                  OR COALESCE(c.last_on, y.created_at::date) >= current_date - 90)
             AND COALESCE(c.last_on, y.created_at::date) <= current_date - $2::int
             AND ($3::bigint IS NULL OR y.assignee_account_id = $3)
             AND NOT EXISTS (SELECT 1 FROM app.stops st
                              WHERE st.team_id=y.team_id AND st.target_type='buyer'
                                AND st.target_id=y.id::text AND st.resolved_at IS NULL)
           ORDER BY 4 NULLS FIRST LIMIT 10""", user.team_id, COLD_DAYS, me)
    for r in cold:
        my_turn.append({**dict(r), "kind": "식은매수자", "side": "매수",
                        "why": f"{r['days']}일째 접촉 없음"})

    # 시작해볼 곳 — 매도 신호 × 개인화 프로필(F-23 1단계).
    # 지역 = 내가 말한 주 활동 구(없으면 팀 최다 구 폴백) · 가격대·유형 = 주력 매물 ·
    # 정렬 = 일하는 방식별 축 가중(급매=실현 임박 신호 / 관계=시간이 만든 신호).
    prof = await pool().fetchrow(
        "SELECT regions, style, price_min, price_max, use_types FROM app.broker_profile WHERE account_id=$1",
        user.account_id)
    regions = list(prof["regions"]) if prof and prof["regions"] else []
    personalized = bool(regions)
    if not regions:
        fb = await pool().fetchval(
            """SELECT substr(b.bjd_code,1,5) FROM app.listings l
               JOIN master.buildings b ON b.building_pk=l.building_pk
               WHERE l.team_id=$1 GROUP BY 1 ORDER BY count(*) DESC LIMIT 1""", user.team_id)
        if fb:
            regions = [fb]
    if regions:
        w = _STYLE_W.get((prof and prof["style"]) or 3, _STYLE_W[3])
        leads = await pool().fetch(
            """SELECT b.building_pk, b.addr, sc.sell_score, sc.sell_axes, sc.use_type, se.sale_est,
                      COALESCE((sc.sell_axes->'hold'->>'pt')::numeric,0)*$4
                    + COALESCE((sc.sell_axes->'age'->>'pt')::numeric,0)*$5
                    + COALESCE((sc.sell_axes->'gongsi_up5'->>'pt')::numeric,0)*$6
                    + COALESCE((sc.sell_axes->'headroom'->>'pt')::numeric,0)*$7
                    + COALESCE((sc.sell_axes->'redevel'->>'pt')::numeric,0)*$8 AS pscore
               FROM master.building_score sc
               JOIN master.buildings b ON b.building_pk = sc.building_pk
               LEFT JOIN master.building_sale_est se ON se.building_pk = sc.building_pk
               WHERE sc.sell_score >= 50 AND substr(b.bjd_code,1,5) = ANY($2::text[])
                 AND ($9::bigint IS NULL OR se.sale_est >= $9)
                 AND ($10::bigint IS NULL OR se.sale_est <= $10)
                 AND ($3::text[] IS NULL OR sc.use_type = ANY($3::text[]))
                 AND NOT EXISTS (SELECT 1 FROM app.listings l
                                  WHERE l.team_id=$1 AND l.building_pk = sc.building_pk)
               ORDER BY pscore DESC LIMIT 5""",
            user.team_id, regions,
            (prof["use_types"] if prof and prof["use_types"] else None),
            w["hold"], w["age"], w["gongsi_up5"], w["headroom"], w["redevel"],
            prof["price_min"] if prof else None, prof["price_max"] if prof else None)
        base_why = "주 활동 지역" if personalized else "팀 활동 구 기준"
        for r in leads:
            d = dict(r); d.pop("pscore", None)
            if isinstance(d.get("sell_axes"), str):
                d["sell_axes"] = json.loads(d["sell_axes"])
            starters.append({**d, "kind": "매도신호", "side": "매도",
                             "why": f"{base_why} · 신호 {round(d['sell_score'])}점"})

    # 내 차례는 급한 순 — 오래 밀린 것부터. 첫전화(기록 없음)는 맨 위.
    my_turn.sort(key=lambda x: -(999 if x["kind"] == "첫전화" else (x.get("days") or 0)))
    return {"today_sched": today_sched, "overdue": overdue, "upcoming": upcoming,
            "money": money, "month": month, "stats": stats, "my_turn": my_turn, "waiting": waiting, "starters": starters}


# ── 접촉 이력 ───────────────────────────────────────────
class ContactIn(BaseModel):
    target_type: str      # buyer | listing
    target_id: str
    kind: str | None = None
    occurred_on: str | None = None
    note: str | None = None
    status: str | None = None    # 이 접촉으로 단계가 무엇이 됐나(0059) — 없으면 단계 그대로
    deal_price: int | None = None  # 거래가(0069) — 매도 쪽에서 계약 금액을 말했을 때
    # 문장에서 읽은 매매가·매도희망가(0078) — 서버가 오버레이에 쓰고, 덮인 값을 커밋에
    # 스냅샷으로 남긴다. 프론트가 오버레이를 직접 쓰면 삭제가 되돌릴 방법이 없다.
    list_price: int | None = None
    hope_price: int | None = None
    schedule: ScheduleIn | None = None  # 문장에서 읽은 약속(0070)
    schedule_op: SchedOpIn | None = None  # 있던 약속 손대기(0072)


@router.get("/contacts")
async def list_contacts(target_type: str, target_id: str,
                        user: CurrentUser = Depends(current_user)):
    rows = await pool().fetch(
        """SELECT c.*, a.name AS by_name, sch.* FROM app.contacts c
           LEFT JOIN app.accounts a ON a.id = c.created_by
           LEFT JOIN LATERAL (
             SELECT s.title AS sched_title, s.on_date AS sched_on, s.at_time AS sched_at,
                    oc.note AS sched_note
               FROM app.schedules s
               LEFT JOIN app.contacts oc ON oc.id = s.contact_id
              WHERE s.contact_id = c.id OR s.id = c.src_schedule_id
              ORDER BY s.id LIMIT 1) sch ON TRUE
           WHERE c.team_id=$1 AND c.target_type=$2 AND c.target_id=$3
           ORDER BY c.occurred_on DESC, c.id DESC LIMIT 100""",
        user.team_id, target_type, target_id)
    return [dict(r) for r in rows]


@router.post("/contacts", status_code=201)
async def create_contact(body: ContactIn, user: CurrentUser = Depends(current_user)):
    # 장부 셋(0076): 사람(buyer·owner) · 매물(listing).
    # 사람 장부는 매물에 안 매달리는 기록을 받는다 — 첫 통화·조건 상담·안부.
    if body.target_type not in ("buyer", "owner", "listing"):
        raise HTTPException(422, "target_type은 buyer · owner · listing 중 하나")
    # asyncpg는 date 컬럼에 문자열을 못 받는다(str에 toordinal이 없다며 500).
    # 파이썬 date로 바꿔서 넘긴다 — listings.patch_biz의 received_on과 같은 처리.
    day: dt.date | None = None
    if body.occurred_on:
        try:
            day = dt.date.fromisoformat(body.occurred_on[:10])
        except ValueError:
            raise HTTPException(422, "occurred_on은 YYYY-MM-DD")
    # 장부 줄이 실을 수 있는 **사건**은 둘뿐이다(0142) — 계약 · 계약파기.
    # 「안 판다고 함」 같은 말은 사건이 아니라 보류다(POST /stops · listing · intent).
    if body.status and body.status not in MIRRORED:
        raise HTTPException(422, f"장부에 실리는 사건은 {'/'.join(MIRRORED)} 중 하나")
    # 이미 계약된 매물인가 — 옛 prev_status 자리. 낱말이 아니라 사실을 본다.
    was_done = await pool().fetchval(
        f"""SELECT {SELLER_DONE.format(t="l")} FROM app.listings l
             WHERE l.building_pk=$1 AND l.team_id=$2""",
        body.target_id, user.team_id) if body.target_type == "listing" else None
    # 가격을 덮기 전에 이전 값을 뜬다 — 이 커밋을 지우면 이 값으로 돌아간다(0078)
    prev: str | None = None
    if body.target_type == "listing" and (body.list_price is not None or body.hope_price is not None):
        prev = await overlays_write(
            user.team_id, body.target_id,
            {"sale_price": body.list_price, "ask_price": body.hope_price}, user.account_id)
    cid = await pool().fetchval(
        """INSERT INTO app.contacts(team_id, target_type, target_id, kind, occurred_on,
                                    note, status, created_by, prev)
           VALUES($1,$2,$3,$4,COALESCE($5::date, current_date),$6,$7,$8,$9) RETURNING id""",
        user.team_id, body.target_type, body.target_id, body.kind,
        day, body.note, body.status, user.account_id, prev)
    # 단계를 말했으면 매물의 진행상태도 같이 옮긴다 — 화면이 두 번 부르지 않게 여기서 한다.
    # 매물의 현재 단계 = 마지막 접촉이 만든 단계. 접촉 이력이 곧 장부다(0059).
    if body.target_type in ("buyer", "owner") and (body.schedule or body.schedule_op):
        # 매물 없는 약속 — 누가 오는지는 이 사람이다(0075·0076)
        if body.schedule_op:
            await apply_sched_op(user.team_id, None, body.schedule_op,
                                  _d(body.schedule.on) if body.schedule else None,
                                  "buy" if body.target_type == "buyer" else "sell")
        elif body.schedule:
            # 사람 장부의 약속 — 인라인 복제 금지, 매물 경로와 **같은 함수**를 탄다(H1의 교훈).
            # 참석자(+당사자)가 매물을 하나로 가리키면 그 매물이 약속의 자리다 —
            # 매수자·매도자가 같이 오는 「계약서 쓰기로」가 매물에 안 뜨면 아무도 못 찾는다.
            buyers = {int(body.target_id)} if body.target_type == "buyer" else set()
            owners = {int(body.target_id)} if body.target_type == "owner" else set()
            for pn in body.schedule.people or []:
                if pn.kind == "buyer" and pn.ref_id:
                    buyers.add(int(pn.ref_id))
                elif pn.kind == "owner" and pn.ref_id:
                    owners.add(int(pn.ref_id))
            if body.schedule.building_pk:
                # 창에서 붙인 매물 — 추론 없이 그 매물이다. 제안은 참석 매수자와 유일할 때만
                bld = body.schedule.building_pk
                pids = [r["id"] for r in await pool().fetch(
                    """SELECT id FROM app.proposals
                        WHERE team_id=$1 AND building_pk=$2 AND buyer_id = ANY($3::bigint[])""",
                    user.team_id, bld, list(buyers))] if buyers else []
                ppid = pids[0] if len(pids) == 1 else None
            else:
                bld, ppid = await resolve_anchor(user.team_id, buyers, owners)
            await schedule_create(
                user.team_id, "buy" if body.target_type == "buyer" else "sell",
                body.schedule, user.account_id, contact_id=cid,
                building_pk=bld, proposal_id=ppid,
                person=(body.target_type, int(body.target_id)))
    evt_sid = None
    if body.target_type == "listing":
        own_sid = None
        if body.schedule_op:
            await apply_sched_op(user.team_id, body.target_id, body.schedule_op,
                                  _d(body.schedule.on) if body.schedule else None, "sell")
        elif body.schedule:
            own_sid = await schedule_create(user.team_id, "sell", body.schedule, user.account_id,
                                            building_pk=body.target_id, contact_id=cid)
        # 계약·계약파기는 일어난 날에 캘린더로(매수와 같은 규칙) — **한 사건 = 한 표**.
        # 잡아 둔 「계약」 일정이 있으면 그것을 완료로 세운다(이름 유지). 없으면 새로 선다.
        # 이미 계약된 건엔 또 안 박는다 — 잔금을 적을 때마다 계약이 두 번 서면 안 된다.
        if body.status in MIRRORED and not (body.status == "계약" and was_done):
            evt_sid = await event_mark(
                user.team_id, "sell", body.status, day or dt.date.today(), user.account_id,
                building_pk=body.target_id, contact_id=cid, own_sid=own_sid,
                explicit_day=day is not None)
    linked = None
    if body.status and body.target_type == "listing":
        # 매물엔 낱말을 안 적는다(0142) — 사실은 짝이 들고 간다(picked_at · dropped_at).
        # 매수자는 같은 표에 앉는다: 한 사건에 일정은 하나다.
        linked = await mirror_to_proposal(user.team_id, body.target_id, body.status,
                                          user.account_id, body.deal_price, evt_sid=evt_sid)
    return {"id": cid, "linked": linked}
