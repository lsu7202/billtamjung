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
    status: str = "활성"
    memo: str | None = None
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
             (team_id, assignee_account_id, name, phone, grade, source, is_corp, status, memo)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id""",
        user.team_id, body.assignee_account_id or user.account_id, body.name.strip(),
        body.phone, body.grade, body.source, body.is_corp, body.status, body.memo)
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
    assignee_account_id: int | None = None


@router.patch("/buyers/{bid}")
async def update_buyer(bid: int, body: BuyerPatch, user: CurrentUser = Depends(current_user)):
    # 연락처는 읽기와 같은 경계로 쓰기도 막는다 — 마스킹된 값을 그대로 저장해 원본을 덮는 사고를 막는다.
    if body.phone is not None:
        cur = await pool().fetchval(
            "SELECT assignee_account_id FROM app.buyers WHERE id=$1 AND team_id=$2", bid, user.team_id)
        if not _can_see(user, cur):
            raise HTTPException(403, "연락처는 담당자 본인 또는 대표만 수정할 수 있습니다")
    n = await pool().execute(
        """UPDATE app.buyers SET
             name = COALESCE($3, name), phone = COALESCE($4, phone),
             grade = COALESCE($5, grade), source = COALESCE($6, source),
             is_corp = COALESCE($7, is_corp), status = COALESCE($8, status),
             memo = COALESCE($9, memo),
             assignee_account_id = COALESCE($10, assignee_account_id)
           WHERE id=$1 AND team_id=$2 AND deleted_at IS NULL""",
        bid, user.team_id, body.name, body.phone, body.grade, body.source, body.is_corp,
        body.status, body.memo, body.assignee_account_id)
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
           WHERE b.team_id=$1 AND b.deleted_at IS NULL AND b.status='활성'
           ORDER BY b.name""", user.team_id)

    sent = {r["buyer_id"]: r["status"] for r in await pool().fetch(
        "SELECT buyer_id, status FROM app.proposals WHERE team_id=$1 AND building_pk=$2",
        user.team_id, building_pk)}

    # 과거 거절 패턴 — 우리만 가진 재료다. "이 사람은 가격에서 자주 막힌다"가 보이면
    # 같은 가격대를 또 들이밀지 않는다. 매물 탓이 아닌 buyer_side는 뺀다.
    rej: dict[int, list] = {}
    for r in await pool().fetch(
            """SELECT buyer_id, reject_reason, count(*) n FROM app.proposals
               WHERE team_id=$1 AND status='거절' AND reject_reason IS NOT NULL
                 AND reject_reason <> 'buyer_side'
               GROUP BY 1,2 ORDER BY 3 DESC""", user.team_id):
        rej.setdefault(r["buyer_id"], []).append({"reason": r["reject_reason"], "n": r["n"]})

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
            "proposal_status": sent.get(bid),
        }

    out = list(best.values())
    # 조건에 걸린 사람 먼저 · 이미 제안한 사람은 뒤로(앞에 오는 건 아직 안 돌린 사람이어야 한다)
    out.sort(key=lambda x: (not x["matched"], x["proposal_status"] is not None, x["name"]))
    return out


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
