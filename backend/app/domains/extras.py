"""부가 도메인: 즐겨찾기·저장검색·위키·메모·광고가. specs S01·S02·S0M."""
import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from ..core.db import pool
from ..core.deps import current_user, CurrentUser

router = APIRouter(tags=["extras"])


# ── 즐겨찾기(개인 전용) ──────────────────────────────
@router.put("/favorites/{building_pk}")
async def fav_toggle(building_pk: str, user: CurrentUser = Depends(current_user)):
    deleted = await pool().fetchval(
        "DELETE FROM app.favorites WHERE account_id=$1 AND building_pk=$2 RETURNING 1",
        user.account_id, building_pk,
    )
    if deleted:
        return {"favorited": False}
    await pool().execute(
        "INSERT INTO app.favorites(account_id,building_pk) VALUES($1,$2)",
        user.account_id, building_pk,
    )
    return {"favorited": True}


@router.get("/favorites")
async def fav_list(user: CurrentUser = Depends(current_user)):
    rows = await pool().fetch(
        """SELECT f.building_pk, b.addr FROM app.favorites f
           JOIN master.buildings b ON b.building_pk=f.building_pk
           WHERE f.account_id=$1 ORDER BY f.created_at DESC""",
        user.account_id,
    )
    return [dict(r) for r in rows]


# ── 저장한 검색조건(폴리곤 포함) ─────────────────────
class SavedSearchIn(BaseModel):
    name: str
    conditions: dict


@router.post("/saved-searches")
async def save_search(body: SavedSearchIn, user: CurrentUser = Depends(current_user)):
    if not body.name.strip() or not body.conditions:
        raise HTTPException(422, "이름과 조건이 필요합니다")
    sid = await pool().fetchval(
        """INSERT INTO app.saved_searches(account_id,name,conditions_json)
           VALUES($1,$2,$3) RETURNING id""",
        user.account_id, body.name.strip(), json.dumps(body.conditions),
    )
    return {"id": sid}


@router.get("/saved-searches")
async def list_searches(user: CurrentUser = Depends(current_user)):
    rows = await pool().fetch(
        "SELECT id,name,conditions_json,created_at FROM app.saved_searches WHERE account_id=$1 ORDER BY created_at DESC",
        user.account_id,
    )
    return [
        {**dict(r), "conditions_json": json.loads(r["conditions_json"])} for r in rows
    ]


@router.delete("/saved-searches/{sid}")
async def delete_search(sid: int, user: CurrentUser = Depends(current_user)):
    await pool().execute(
        "DELETE FROM app.saved_searches WHERE id=$1 AND account_id=$2", sid, user.account_id
    )
    return {"ok": True}


# ── 위키(전체 공유·MVP: 작성+동의) ───────────────────
class WikiIn(BaseModel):
    category: str | None = None
    body: str


@router.post("/buildings/{building_pk}/wiki")
async def wiki_post(building_pk: str, body: WikiIn, user: CurrentUser = Depends(current_user)):
    pid = await pool().fetchval(
        """INSERT INTO app.wiki_posts(building_pk,author_account_id,category,body)
           VALUES($1,$2,$3,$4) RETURNING id""",
        building_pk, user.account_id, body.category, body.body,
    )
    return {"id": pid}


@router.get("/buildings/{building_pk}/wiki")
async def wiki_list(building_pk: str, _: CurrentUser = Depends(current_user)):
    rows = await pool().fetch(
        """SELECT w.id, w.category, w.body, w.created_at,
                  COALESCE(a.name,'탈퇴한 사용자') AS author,
                  (SELECT count(*) FROM app.wiki_votes v WHERE v.post_id=w.id) AS votes
           FROM app.wiki_posts w LEFT JOIN app.accounts a ON a.id=w.author_account_id
           WHERE w.building_pk=$1 AND w.deleted_at IS NULL
           ORDER BY votes DESC, w.created_at DESC""",
        building_pk,
    )
    return [dict(r) for r in rows]


@router.put("/wiki/{post_id}/vote")
async def wiki_vote(post_id: int, user: CurrentUser = Depends(current_user)):
    deleted = await pool().fetchval(
        "DELETE FROM app.wiki_votes WHERE post_id=$1 AND account_id=$2 RETURNING 1",
        post_id, user.account_id,
    )
    if deleted:
        return {"voted": False}
    await pool().execute(
        "INSERT INTO app.wiki_votes(post_id,account_id) VALUES($1,$2)", post_id, user.account_id
    )
    return {"voted": True}


# ── 메모(팀/비밀 2종) ────────────────────────────────
class MemoIn(BaseModel):
    kind: str = "team"     # team|secret
    body: str


@router.put("/buildings/{building_pk}/memos")
async def memo_upsert(building_pk: str, body: MemoIn, user: CurrentUser = Depends(current_user)):
    if body.kind not in ("team", "secret"):
        raise HTTPException(422, "kind는 team|secret")
    await pool().execute(
        """INSERT INTO app.memos(building_pk,team_id,kind,body,author_account_id)
           VALUES($1,$2,$3::app.memo_kind,$4,$5)""",
        building_pk, user.team_id, body.kind, body.body, user.account_id,
    )
    return {"ok": True}


@router.get("/buildings/{building_pk}/memos")
async def memo_list(building_pk: str, user: CurrentUser = Depends(current_user)):
    """비밀메모 = 담당자 본인 + 대표만(예외 2곳 중 하나)."""
    assignee = await pool().fetchval(
        "SELECT assignee_account_id FROM app.listings WHERE building_pk=$1 AND team_id=$2",
        building_pk, user.team_id,
    )
    can_secret = user.role == "owner" or user.account_id == assignee
    rows = await pool().fetch(
        """SELECT id, kind, body, created_at FROM app.memos
           WHERE building_pk=$1 AND team_id=$2 AND deleted_at IS NULL
             AND (kind='team' OR $3)
           ORDER BY created_at DESC""",
        building_pk, user.team_id, can_secret,
    )
    return [dict(r) for r in rows]


# ── 광고가(집단지성·공용 시계열) ─────────────────────
class AdPriceIn(BaseModel):
    observed_on: str        # YYYY-MM-DD
    price: int | None       # NULL='광고없음' 관측
    is_mine: bool = False


@router.post("/buildings/{building_pk}/ad-prices")
async def ad_price_add(building_pk: str, body: AdPriceIn, user: CurrentUser = Depends(current_user)):
    import datetime as dt
    try:
        observed = dt.date.fromisoformat(body.observed_on)
    except ValueError:
        raise HTTPException(422, "observed_on은 YYYY-MM-DD")
    await pool().execute(
        """INSERT INTO app.ad_prices(building_pk,observed_on,price,is_mine,reporter_account_id)
           VALUES($1,$2,$3,$4,$5)""",
        building_pk, observed, body.price, body.is_mine, user.account_id,
    )
    return {"ok": True}


@router.get("/buildings/{building_pk}/ad-prices")
async def ad_price_list(building_pk: str, _: CurrentUser = Depends(current_user)):
    rows = await pool().fetch(
        """SELECT observed_on, price, is_mine,
                  count(*) OVER (PARTITION BY observed_on, price) AS confirms
           FROM app.ad_prices
           WHERE building_pk=$1 AND deleted_at IS NULL
           ORDER BY observed_on DESC""",
        building_pk,
    )
    return [dict(r) for r in rows]
