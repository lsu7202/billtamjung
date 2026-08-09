"""부가 도메인: 즐겨찾기·저장검색·위키·메모. specs S01·S02·S0M."""
import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from ..core.db import pool
from ..core.deps import current_user, CurrentUser

router = APIRouter(tags=["extras"])


_enum_cache: dict | None = None


@router.get("/enums")
async def enums(_: CurrentUser = Depends(current_user)):
    """전 enum 그룹 {enum_key: [{code,label,tier}]} — 드롭다운·코드↔라벨 매핑(레지스트리)."""
    global _enum_cache
    if _enum_cache is None:
        rows = await pool().fetch(
            "SELECT enum_key, code, label, tier FROM ref.enums WHERE active ORDER BY enum_key, sort_order"
        )
        out: dict[str, list] = {}
        for r in rows:
            out.setdefault(r["enum_key"], []).append(
                {"code": r["code"], "label": r["label"], "tier": r["tier"]}
            )
        _enum_cache = out
    return _enum_cache


@router.get("/fields")
async def fields(_: CurrentUser = Depends(current_user)):
    """필드 레지스트리 {field_key: {label,unit,data_type,enum_key,editable,display_group}}."""
    rows = await pool().fetch(
        """SELECT field_key, label, unit, data_type::text, layer::text, enum_key,
                  editable, masked, display_group, display_order
           FROM ref.fields WHERE active ORDER BY display_group, display_order"""
    )
    return {r["field_key"]: dict(r) for r in rows}


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


class SavedSearchPatch(BaseModel):
    """부분 수정 — 이름만 바꾸거나(rename) 조건만 덮어쓴다(현재 조건으로 갱신)."""
    name: str | None = None
    conditions: dict | None = None


@router.patch("/saved-searches/{sid}")
async def update_search(sid: int, body: SavedSearchPatch, user: CurrentUser = Depends(current_user)):
    if body.name is None and body.conditions is None:
        raise HTTPException(422, "바꿀 항목이 없습니다")
    if body.name is not None and not body.name.strip():
        raise HTTPException(422, "이름은 비울 수 없습니다")
    # COALESCE로 넘어온 것만 갱신 — 이름만 바꿀 때 조건이 날아가면 안 된다
    n = await pool().execute(
        """UPDATE app.saved_searches
              SET name = COALESCE($3, name),
                  conditions_json = COALESCE($4, conditions_json)
            WHERE id=$1 AND account_id=$2""",
        sid, user.account_id,
        body.name.strip() if body.name is not None else None,
        json.dumps(body.conditions) if body.conditions is not None else None,
    )
    if n.endswith(" 0"):
        raise HTTPException(404, "저장된 조건을 찾을 수 없습니다")
    return {"ok": True}


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
async def wiki_list(building_pk: str, user: CurrentUser = Depends(current_user)):
    rows = await pool().fetch(
        """SELECT w.id, w.category, w.body, w.created_at,
                  COALESCE(a.name,'탈퇴한 사용자') AS author,
                  (w.author_account_id = $2) AS mine,
                  (SELECT count(*) FROM app.wiki_votes v WHERE v.post_id=w.id) AS votes,
                  (SELECT count(*) FROM app.wiki_comments c WHERE c.post_id=w.id AND c.deleted_at IS NULL) AS comments
           FROM app.wiki_posts w LEFT JOIN app.accounts a ON a.id=w.author_account_id
           WHERE w.building_pk=$1 AND w.deleted_at IS NULL
           ORDER BY votes DESC, w.created_at DESC""",
        building_pk, user.account_id,
    )
    return [dict(r) for r in rows]


@router.delete("/wiki/{post_id}")
async def wiki_delete(post_id: int, user: CurrentUser = Depends(current_user)):
    """내가 쓴 위키만 삭제(soft)."""
    await pool().execute(
        "UPDATE app.wiki_posts SET deleted_at=now() WHERE id=$1 AND author_account_id=$2",
        post_id, user.account_id,
    )
    return {"ok": True}


class WikiReportIn(BaseModel):
    reason: str | None = None


@router.post("/wiki/{post_id}/report")
async def wiki_report(post_id: int, body: WikiReportIn, user: CurrentUser = Depends(current_user)):
    """위키글 신고(기본 플래그). 같은 유저의 중복 대기건은 무시. 모더레이션 처리는 정식."""
    dup = await pool().fetchval(
        "SELECT 1 FROM app.wiki_reports WHERE post_id=$1 AND reporter_account_id=$2 AND status='pending'",
        post_id, user.account_id,
    )
    if not dup:
        await pool().execute(
            "INSERT INTO app.wiki_reports(post_id,reporter_account_id,reason) VALUES($1,$2,$3)",
            post_id, user.account_id, body.reason or None,
        )
    return {"ok": True}


class CommentIn(BaseModel):
    body: str


@router.get("/wiki/{post_id}/comments")
async def wiki_comments(post_id: int, user: CurrentUser = Depends(current_user)):
    rows = await pool().fetch(
        """SELECT c.id, c.body, c.created_at,
                  COALESCE(a.name,'탈퇴한 사용자') AS author,
                  (c.author_account_id = $2) AS mine
           FROM app.wiki_comments c LEFT JOIN app.accounts a ON a.id=c.author_account_id
           WHERE c.post_id=$1 AND c.deleted_at IS NULL
           ORDER BY c.created_at""",
        post_id, user.account_id,
    )
    return [dict(r) for r in rows]


@router.post("/wiki/{post_id}/comments")
async def wiki_comment_add(post_id: int, body: CommentIn, user: CurrentUser = Depends(current_user)):
    if not body.body.strip():
        raise HTTPException(422, "댓글 내용을 입력하세요")
    cid = await pool().fetchval(
        "INSERT INTO app.wiki_comments(post_id,author_account_id,body) VALUES($1,$2,$3) RETURNING id",
        post_id, user.account_id, body.body.strip(),
    )
    return {"id": cid}


@router.delete("/wiki/comments/{comment_id}")
async def wiki_comment_del(comment_id: int, user: CurrentUser = Depends(current_user)):
    """내가 쓴 댓글만 삭제(soft)."""
    await pool().execute(
        "UPDATE app.wiki_comments SET deleted_at=now() WHERE id=$1 AND author_account_id=$2",
        comment_id, user.account_id,
    )
    return {"ok": True}


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
    if body.kind == "secret":
        # 비밀메모 작성도 담당자 본인+대표만(열람 제한과 동일 경계). specs S0M §3.4
        assignee = await pool().fetchval(
            "SELECT assignee_account_id FROM app.listings WHERE building_pk=$1 AND team_id=$2",
            building_pk, user.team_id,
        )
        if not (user.role == "owner" or user.account_id == assignee):
            raise HTTPException(403, "비밀메모는 담당자 본인 또는 대표만 작성할 수 있습니다")
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
        """SELECT id, kind, body, created_at, (author_account_id = $4) AS mine FROM app.memos
           WHERE building_pk=$1 AND team_id=$2 AND deleted_at IS NULL
             AND (kind='team' OR $3)
           ORDER BY created_at DESC""",
        building_pk, user.team_id, can_secret, user.account_id,
    )
    return [dict(r) for r in rows]


@router.delete("/buildings/{building_pk}/memos/{memo_id}")
async def memo_delete(building_pk: str, memo_id: int, user: CurrentUser = Depends(current_user)):
    """내가 쓴 메모만 삭제(soft)."""
    await pool().execute(
        "UPDATE app.memos SET deleted_at=now() WHERE id=$1 AND author_account_id=$2",
        memo_id, user.account_id,
    )
    return {"ok": True}
