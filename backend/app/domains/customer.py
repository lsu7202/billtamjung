"""고객 쪽(S05 §5 · §6, 3묶음 2026-09-29) — 프로필 · 관심 저장 · 알림 · 신고. 전부 누구나(any_user).

알림은 **읽을 때 센다**(배치 없음, 0198).
  · 저장한 건물 — 저장한 날 뒤로 그 건물에 새 광고가 오르면
  · 조건 — 알림을 켠 조건(saved_searches.notify)에 맞는 새 광고가 오르면. 조건에 실린 검색 요청(request)으로
    /search/pins 를 그대로 다시 불러 맞는 건물을 얻고, 켠 날 뒤로 오른 광고를 want_alerts 에 쌓는다
  · 「새 것」은 accounts.alerts_seen_at 뒤에 생긴 것. 알림 목록을 열면 그때로 옮긴다
우리 팀 광고는 알림에서 뺀다.
"""
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core.db import pool
from ..core.deps import any_user, CurrentUser
from . import search as search_mod

router = APIRouter(tags=["customer"])

_LIVE = "a.state = '노출' AND a.expires_on >= current_date"


# ── 프로필(§5-1) ──────────────────────────────────────────────
LITERACY = ("처음", "관심", "공부해봄")
INTENT = ("A", "B", "C")                  # 매수자 등급 사전(buyer_grade) 그대로 — 확실 · 보통 · 관망
PURPOSES = ("실사용", "투자용", "신축용")  # 매수자 사전(building_use) 그대로


class ProfileIn(BaseModel):
    intent: str | None = None
    literacy: str | None = None
    purposes: list[str] = []
    regions: list[str] = []
    budget_min: int | None = None
    budget_max: int | None = None
    note: str | None = None


@router.get("/customer/profile")
async def get_profile(user: CurrentUser = Depends(any_user)):
    r = await pool().fetchrow(
        "SELECT intent, literacy, purposes, regions, budget_min, budget_max, note FROM app.customer_profile "
        "WHERE account_id=$1", user.account_id)
    return dict(r) if r else {"intent": None, "literacy": None, "purposes": [], "regions": [],
                              "budget_min": None, "budget_max": None, "note": None}


@router.put("/customer/profile")
async def put_profile(body: ProfileIn, user: CurrentUser = Depends(any_user)):
    """모든 칸은 고객이 직접 적는다. 모르면 비운다(null)."""
    if body.intent not in (None, *INTENT):
        raise HTTPException(422, "의사는 확실 · 보통 · 관망")
    if body.literacy not in (None, *LITERACY):
        raise HTTPException(422, "이해도는 처음 · 관심 · 공부해봄")
    if any(p not in PURPOSES for p in body.purposes):
        raise HTTPException(422, "목적은 실사용 · 투자용 · 신축용")
    await pool().execute(
        """INSERT INTO app.customer_profile(account_id, intent, literacy, purposes, regions, budget_min, budget_max, note, updated_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())
           ON CONFLICT (account_id) DO UPDATE SET intent=$2, literacy=$3, purposes=$4, regions=$5,
             budget_min=$6, budget_max=$7, note=$8, updated_at=now()""",
        user.account_id, body.intent, body.literacy, body.purposes or None, body.regions or None,
        body.budget_min, body.budget_max, (body.note or "").strip() or None)
    return {"ok": True}


# ── 관심 저장(§5-2) ───────────────────────────────────────────
class SaveIn(BaseModel):
    building_pk: str
    ad_id: int | None = None


@router.get("/saves")
async def list_saves(user: CurrentUser = Depends(any_user)):
    """저장한 건물 · 광고 — 최근 저장이 위. 광고가 내려가도 건물 저장은 남는다(ad_state 로 보인다)."""
    rows = await pool().fetch(
        """SELECT s.id, s.building_pk, s.ad_id, s.memo, s.created_at, COALESCE(b.addr, '') AS addr,
                  a.title AS ad_title, a.state AS ad_state, CASE WHEN a.price_open THEN a.price END AS ad_price,
                  (SELECT count(*) FROM app.ads x WHERE x.building_pk = s.building_pk
                     AND x.state = '노출' AND x.expires_on >= current_date) AS live_ads
             FROM app.saves s
             LEFT JOIN master.buildings b ON b.building_pk = s.building_pk
             LEFT JOIN app.ads a ON a.id = s.ad_id
            WHERE s.account_id = $1 ORDER BY s.created_at DESC""", user.account_id)
    return [dict(r) for r in rows]


@router.get("/saves/building/{building_pk}")
async def saves_of(building_pk: str, user: CurrentUser = Depends(any_user)):
    rows = await pool().fetch("SELECT id, ad_id FROM app.saves WHERE account_id=$1 AND building_pk=$2",
                              user.account_id, building_pk)
    return [dict(r) for r in rows]


@router.post("/saves", status_code=201)
async def add_save(body: SaveIn, user: CurrentUser = Depends(any_user)):
    sid = await pool().fetchval(
        """INSERT INTO app.saves(account_id, building_pk, ad_id) VALUES($1,$2,$3)
           ON CONFLICT (account_id, building_pk, COALESCE(ad_id, 0)) DO NOTHING RETURNING id""",
        user.account_id, body.building_pk, body.ad_id)
    return {"id": sid}


class MemoIn(BaseModel):
    memo: str | None = None


@router.patch("/saves/{sid}")
async def save_memo(sid: int, body: MemoIn, user: CurrentUser = Depends(any_user)):
    await pool().execute("UPDATE app.saves SET memo=$3 WHERE id=$1 AND account_id=$2",
                         sid, user.account_id, (body.memo or "").strip() or None)
    return {"ok": True}


@router.delete("/saves/{sid}")
async def del_save(sid: int, user: CurrentUser = Depends(any_user)):
    await pool().execute("DELETE FROM app.saves WHERE id=$1 AND account_id=$2", sid, user.account_id)
    return {"ok": True}


# ── 알림(§5-2 · §5-3) ────────────────────────────────────────
_last_match: dict[int, float] = {}        # 계정마다 마지막으로 조건을 맞춰 본 때 — 2분에 한 번만 다시 센다


async def _match_searches(user: CurrentUser) -> None:
    now = time.monotonic()
    if now - _last_match.get(user.account_id, 0) < 120:
        return
    _last_match[user.account_id] = now
    rows = await pool().fetch(
        """SELECT id, conditions_json, notify_since FROM app.saved_searches
            WHERE account_id=$1 AND notify AND closed_at IS NULL AND notify_since IS NOT NULL""", user.account_id)
    import json
    for r in rows:
        cond = r["conditions_json"]
        cond = json.loads(cond) if isinstance(cond, str) else cond
        req = (cond or {}).get("request")
        if not isinstance(req, dict):
            continue
        keep = {k: v for k, v in req.items() if k in search_mod.SearchIn.model_fields}
        keep.update(tab="ad", chip="ads", bbox=None)
        try:
            pins = await search_mod.pins(search_mod.SearchIn(**keep), user)
        except Exception:                                           # noqa: BLE001 — 옛 조건 하나가 알림 전체를 막지 않게
            continue
        pks = [p["building_pk"] for p in pins]
        if not pks:
            continue
        await pool().execute(
            f"""INSERT INTO app.want_alerts(saved_search_id, ad_id, matched_at)
                SELECT $1, a.id, now() FROM app.ads a
                 WHERE a.building_pk = ANY($2::text[]) AND {_LIVE}
                   AND a.posted_on >= $3::date AND a.team_id IS DISTINCT FROM $4
                ON CONFLICT DO NOTHING""",
            r["id"], pks, r["notify_since"], user.team_id)


async def _alerts(user: CurrentUser):
    await _match_searches(user)
    return await pool().fetch(
        f"""WITH seen AS (SELECT alerts_seen_at AS t FROM app.accounts WHERE id = $1),
           s AS (   -- 저장한 건물에 저장 뒤 새 광고
             SELECT DISTINCT ON (a.id) '저장한 건물'::text AS kind, NULL::text AS label, a.id AS ad_id,
                    GREATEST(a.created_at, a.posted_on::timestamptz) AS at
               FROM app.saves v JOIN app.ads a ON a.building_pk = v.building_pk
              WHERE v.account_id = $1 AND {_LIVE} AND a.posted_on >= v.created_at::date
                AND a.id IS DISTINCT FROM v.ad_id AND a.team_id IS DISTINCT FROM $2),
           w AS (   -- 알림을 켠 조건에 맞은 새 광고
             SELECT '조건'::text, q.name, w.ad_id, w.matched_at
               FROM app.want_alerts w JOIN app.saved_searches q ON q.id = w.saved_search_id
               JOIN app.ads a ON a.id = w.ad_id
              WHERE q.account_id = $1 AND q.closed_at IS NULL AND {_LIVE})
           SELECT x.kind, x.label, x.ad_id, x.at, a.building_pk, a.title,
                  CASE WHEN a.price_open THEN a.price END AS price, COALESCE(b.addr, '') AS addr,
                  (x.at > COALESCE((SELECT t FROM seen), '-infinity')) AS new
             FROM (SELECT * FROM s UNION ALL SELECT * FROM w) x
             JOIN app.ads a ON a.id = x.ad_id
             LEFT JOIN master.buildings b ON b.building_pk = a.building_pk
            ORDER BY x.at DESC LIMIT 100""", user.account_id, user.team_id)


@router.get("/alerts")
async def list_alerts(user: CurrentUser = Depends(any_user)):
    return [dict(r) for r in await _alerts(user)]


@router.get("/alerts/count")
async def count_alerts(user: CurrentUser = Depends(any_user)):
    """아바타의 빨간 점 — 아직 안 본 알림 수."""
    return {"unread": sum(1 for r in await _alerts(user) if r["new"])}


@router.post("/alerts/seen")
async def seen_alerts(user: CurrentUser = Depends(any_user)):
    await pool().execute("UPDATE app.accounts SET alerts_seen_at = now() WHERE id=$1", user.account_id)
    return {"ok": True}


# ── 신고(§6) ─────────────────────────────────────────────────
class ReportIn(BaseModel):
    reason: str               # 거래완료 · 표시정보 다름
    body: str | None = None   # 표시정보 다름이면 무엇이 다른지(필수)


@router.post("/ads/{ad_id}/report", status_code=201)
async def report_ad(ad_id: int, body: ReportIn, user: CurrentUser = Depends(any_user)):
    """들어오면 광고 review 가 검수중이 된다. 한 계정이 한 광고에 확인중인 신고는 하나."""
    if body.reason not in ("거래완료", "표시정보 다름"):
        raise HTTPException(422, "사유는 거래완료 · 표시정보 다름")
    text = (body.body or "").strip()
    if body.reason == "표시정보 다름" and not text:
        raise HTTPException(422, "무엇이 다른지 적으세요")
    ad = await pool().fetchrow("SELECT team_id FROM app.ads WHERE id=$1 AND state IN ('노출','거래완료')", ad_id)
    if not ad:
        raise HTTPException(404, "광고가 없습니다")
    if user.team_id is not None and ad["team_id"] == user.team_id:
        raise HTTPException(409, "우리 팀 광고는 신고할 수 없습니다")
    rid = await pool().fetchval(
        """INSERT INTO app.ad_reports(ad_id, account_id, reason, body, status) VALUES($1,$2,$3,$4,'확인중')
           ON CONFLICT (ad_id, account_id) WHERE status = '확인중' DO NOTHING RETURNING id""",
        ad_id, user.account_id, body.reason, text or None)
    if rid is None:
        raise HTTPException(409, "이미 신고한 광고입니다")
    await pool().execute("UPDATE app.ads SET review='검수중', updated_at=now() WHERE id=$1", ad_id)
    return {"id": rid}
