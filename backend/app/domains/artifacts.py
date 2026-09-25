"""자료(아티팩트) — 말로 만드는 시각자료. 정본 10-AI-어시스턴트 §11.

**어디에도 안 묶인다**(2026-09-24 대표). 한 건물을 설명하는 자료가 아닐 수 있다.
`account_id` 로만 잠그고 팀 공유는 없다.

**원본과 구운 것을 나눈다.** `src_html` 은 모델이 쓴 것이고, 여는 순간 `bake` 가 `<bt-*>` 를
값으로 바꾼다. 굽기를 열 때로 미뤄야 데이터가 살아 있다. 굳히는 건 내보낸 판 하나뿐이고
「데이터 변경됨」 판정은 안 만든다(분석보고서의 stale 은 폐지됐다).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from ..core.db import pool
from ..core.deps import CurrentUser, current_user
from ..render import bake as baker

router = APIRouter(prefix="/artifacts", tags=["artifacts"])


class CreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    html: str = Field(min_length=1)
    kind: str = "slides"
    chat_id: int | None = None


class EditIn(BaseModel):
    """부분 수정. **통째로 갈아엎지 않는다** — 안 건드린 데가 바뀌면 안 되고 토큰도 크다."""
    old: str = Field(min_length=1)
    new: str


async def _own(artifact_id: int, user: CurrentUser) -> dict:
    row = await pool().fetchrow(
        "SELECT * FROM app.artifact WHERE id=$1 AND account_id=$2 AND archived_at IS NULL",
        artifact_id, user.account_id)
    if not row:
        raise HTTPException(404, "그런 자료가 없습니다")
    return dict(row)


async def _last(artifact_id: int) -> dict | None:
    row = await pool().fetchrow(
        "SELECT * FROM app.artifact_ver WHERE artifact_id=$1 ORDER BY ver DESC LIMIT 1", artifact_id)
    return dict(row) if row else None


async def create(body: CreateIn, account_id: int) -> dict:
    """서비스 함수 — 라우트와 AI 도구가 같이 쓴다. 두 길이 갈리면 언젠가 어긋난다."""
    if body.kind not in ("slides", "doc"):
        raise HTTPException(422, "kind 는 slides 또는 doc 입니다")
    aid = await pool().fetchval(
        "INSERT INTO app.artifact(account_id,chat_id,title,kind) VALUES($1,$2,$3,$4) RETURNING id",
        account_id, body.chat_id, body.title.strip(), body.kind)
    await pool().execute(
        "INSERT INTO app.artifact_ver(artifact_id,ver,src_html) VALUES($1,1,$2)", aid, body.html)
    return {"id": aid, "ver": 1, "제목": body.title.strip(), "부품": baker.tags_used(body.html)}


async def edit(artifact_id: int, body: EditIn, user: CurrentUser) -> dict:
    """마지막 판의 `src_html` 에서 문자열 치환. **못 찾으면 실패를 말한다**(§11-1).
    조용히 전체를 갈아엎으면 모델이 틀린 줄 모르고 다음 수정을 쌓는다."""
    art = await _own(artifact_id, user)
    last = await _last(artifact_id)
    if not last:
        raise HTTPException(404, "판이 없습니다")
    src = last["src_html"]
    n = src.count(body.old)
    if n == 0:
        raise HTTPException(422, "고칠 글을 못 찾았습니다. 지금 글을 다시 읽고 그대로 옮겨 주세요")
    if n > 1:
        raise HTTPException(422, f"고칠 글이 {n}군데 있습니다. 앞뒤를 더 붙여 한 군데만 집어 주세요")
    nxt = last["ver"] + 1
    await pool().execute(
        "INSERT INTO app.artifact_ver(artifact_id,ver,src_html) VALUES($1,$2,$3)",
        artifact_id, nxt, src.replace(body.old, body.new, 1))
    await pool().execute("UPDATE app.artifact SET updated_at=now() WHERE id=$1", artifact_id)
    return {"id": artifact_id, "ver": nxt, "제목": art["title"]}


@router.get("")
async def list_mine(user: CurrentUser = Depends(current_user), limit: int = 30):
    rows = await pool().fetch(
        """SELECT a.id, a.title, a.kind, a.updated_at,
                  (SELECT max(ver) FROM app.artifact_ver v WHERE v.artifact_id=a.id) AS ver
             FROM app.artifact a
            WHERE a.account_id=$1 AND a.archived_at IS NULL
            ORDER BY a.updated_at DESC LIMIT $2""", user.account_id, limit)
    return [dict(r) for r in rows]


@router.post("", status_code=201)
async def create_route(body: CreateIn, user: CurrentUser = Depends(current_user)):
    return await create(body, user.account_id)


@router.get("/{artifact_id}")
async def get_one(artifact_id: int, user: CurrentUser = Depends(current_user)):
    art = await _own(artifact_id, user)
    last = await _last(artifact_id) or {}
    return {**art, "ver": last.get("ver"), "src_html": last.get("src_html")}


@router.patch("/{artifact_id}")
async def edit_route(artifact_id: int, body: EditIn, user: CurrentUser = Depends(current_user)):
    return await edit(artifact_id, body, user)


@router.delete("/{artifact_id}", status_code=204)
async def remove(artifact_id: int, user: CurrentUser = Depends(current_user)):
    await _own(artifact_id, user)
    await pool().execute("UPDATE app.artifact SET archived_at=now() WHERE id=$1", artifact_id)
    return Response(status_code=204)


@router.get("/{artifact_id}/view", response_class=Response)
async def view(artifact_id: int, ver: int | None = None, user: CurrentUser = Depends(current_user)):
    """구운 HTML 을 그대로 낸다. 링크가 곧 자료다.
    굳힌 판(`baked_html`)이 있으면 그걸 내고, 없으면 **열 때 굽는다**."""
    await _own(artifact_id, user)
    row = await pool().fetchrow(
        "SELECT * FROM app.artifact_ver WHERE artifact_id=$1 AND ($2::int IS NULL OR ver=$2)"
        " ORDER BY ver DESC LIMIT 1", artifact_id, ver)
    if not row:
        raise HTTPException(404, "판이 없습니다")
    art = await _own(artifact_id, user)
    html = row["baked_html"] or await baker.bake(
        row["src_html"], kind=art["kind"], title=art["title"])
    return Response(content=html, media_type="text/html; charset=utf-8")
