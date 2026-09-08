"""AI 어시스턴트 — 대화 CRUD 와 스트림. 정본 specs/07-architecture/10-AI-어시스턴트.md

## 2단계 (도구)

1단계는 도구 없이 그냥 대화였다. 2단계에서 고리(`ai/loop.py`)가 붙어 모델이 우리 데이터를
읽는다. 읽기 API(`call_api`) · SQL(`query`) · 되묻기(`ask`). **여기가 「그냥 챗봇」과
「우리 것」이 갈리는 지점이다.**

## 개인이다

대화는 `account_id` 로 잠긴다. 이 앱의 다른 업무 데이터는 전부 `team_id` 로 잠기는데
(가입하면 1인 팀이 자동으로 생긴다) 대화·기억·문서만 개인이다. **팀원의 대화는 안 보인다.**
AI 가 보는 업무 데이터는 여전히 팀 것이다 — `call_api` 가 사용자 토큰으로 부른다.

## 저장은 우리가 한다

Messages API 는 상태가 없다. 매 호출에 지난 대화를 통째로 다시 보낸다.
우리가 저장 안 하면 아무 데도 안 남는다.

## 조각

답 한 통은 조각 목록이다(`content` jsonb). 글·부품(`ui`)·되물음(`ask`)이 섞인다.
다시 열면 부품은 **지금 값**으로 그리고 글자는 그때 그대로 남는다.

## 나가는 문 (§3 ②)

사용자 말은 **원문 그대로 저장**하고(그 사람 것이다), 모델로 나갈 때만 `scrub` 한다.
도구 결과는 고리 안에서 지운다. 두 문이 다 잠겨야 한다.
"""
from __future__ import annotations

import asyncio
import json
import logging

import anthropic

log = logging.getLogger(__name__)
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..ai import client as ai
from ..ai import loop
from ..ai.prompt import limits, system
from ..ai.scrub import scrub
from ..ai.tools import Ctx, brief, load_all
from ..ai.tools.api import endpoints_brief
from ..core.config import settings
from ..core.db import pool
from ..core.deps import CurrentUser, current_user

router = APIRouter(prefix="/ai", tags=["assistant"])

TITLE_MAX = 60


# ── 오류 ────────────────────────────────────────────────────────────
async def err(code: str) -> dict:
    """문구는 ref.error_msg 에서 온다. 서버가 문장을 짓지 않는다 —
    그래야 문구를 고칠 때 배포를 안 한다."""
    row = await pool().fetchrow(
        "SELECT code, title, body, action, level FROM ref.error_msg WHERE code = $1", code)
    if row:
        return {"t": "error", **dict(row)}
    return {"t": "error", "code": code, "title": "문제가 생겼습니다",
            "body": None, "action": "retry", "level": "warn"}


# ── 소유 확인 ───────────────────────────────────────────────────────
async def _own(chat_id: int, account_id: int) -> None:
    ok = await pool().fetchval(
        "SELECT 1 FROM app.ai_chat WHERE id=$1 AND account_id=$2 AND archived_at IS NULL",
        chat_id, account_id)
    if not ok:
        raise HTTPException(404, "없는 대화입니다")


def _plain(content) -> str:
    """조각 목록에서 모델에 되보낼 글. 부품은 글이 아니라 빼고,
    되물음은 모델이 자기가 뭘 물었는지 알아야 다음 답을 이해하므로 글로 남긴다."""
    if isinstance(content, str):
        content = json.loads(content)
    out = []
    for p in content:
        if p.get("t") == "text":
            out.append(p.get("v", ""))
        elif p.get("t") == "ask":
            out.append(f"[되물음] {p.get('question','')} ({' / '.join(p.get('options', []))})")
    return "\n".join(out).strip()


# ── 대화 ────────────────────────────────────────────────────────────
@router.get("/chats")
async def list_chats(user: CurrentUser = Depends(current_user)):
    rows = await pool().fetch(
        """SELECT id, title, updated_at FROM app.ai_chat
            WHERE account_id=$1 AND archived_at IS NULL
            ORDER BY updated_at DESC LIMIT 100""", user.account_id)
    return [dict(r) for r in rows]


@router.post("/chats")
async def new_chat(user: CurrentUser = Depends(current_user)):
    """빈 대화. 제목은 첫 답 뒤에 붙는다(그 전엔 NULL)."""
    row = await pool().fetchrow(
        "INSERT INTO app.ai_chat(account_id) VALUES($1) RETURNING id, title, updated_at",
        user.account_id)
    return dict(row)


class TitleIn(BaseModel):
    title: str = Field(min_length=1, max_length=TITLE_MAX)


@router.patch("/chats/{chat_id}")
async def rename_chat(chat_id: int, body: TitleIn, user: CurrentUser = Depends(current_user)):
    await _own(chat_id, user.account_id)
    await pool().execute(
        "UPDATE app.ai_chat SET title=$1, updated_at=now() WHERE id=$2", body.title.strip(), chat_id)
    return {"ok": True}


@router.delete("/chats/{chat_id}", status_code=204)
async def drop_chat(chat_id: int, user: CurrentUser = Depends(current_user)):
    """지우기는 표시만 한다. 실삭제는 배치가 한다 —
    잘못 눌러 날린 대화를 되살릴 길이 있어야 한다."""
    await _own(chat_id, user.account_id)
    await pool().execute("UPDATE app.ai_chat SET archived_at=now() WHERE id=$1", chat_id)


@router.get("/chats/{chat_id}")
async def get_chat(chat_id: int, user: CurrentUser = Depends(current_user)):
    await _own(chat_id, user.account_id)
    rows = await pool().fetch(
        """SELECT id, seq, role, content, tool_calls, created_at FROM app.ai_message
            WHERE chat_id=$1 ORDER BY seq""", chat_id)
    return [{**dict(r), "content": json.loads(r["content"]),
             "tool_calls": json.loads(r["tool_calls"]) if r["tool_calls"] else None} for r in rows]


# ── 보내기 ──────────────────────────────────────────────────────────
class SendIn(BaseModel):
    text: str = Field(min_length=1, max_length=20_000)


@router.post("/chats/{chat_id}/messages")
async def send(chat_id: int, body: SendIn, req: Request,
               user: CurrentUser = Depends(current_user)):
    """사용자 말을 싣고 답을 흘린다(SSE).

    사용자 말은 **스트림 전에** 저장한다. 모델이 죽어도 사용자가 친 것은 남아야 한다.
    답은 끝에 저장하되, 도중에 끊겨도 거기까지를 저장한다(§21 조용한 실패).

    고리는 코루틴이고 SSE 는 제너레이터라 큐로 잇는다. 고리가 `emit` 으로 넣으면
    여기서 꺼내 흘린다. 고리가 끝나면 None 을 넣어 문을 닫는다.
    """
    await _own(chat_id, user.account_id)
    text = body.text.strip()
    # 사용자 권한을 빌린다(§9-4). 토큰을 그대로 들고 우리 API 를 부른다
    token = req.headers.get("authorization", "").removeprefix("Bearer ").strip()

    async with pool().acquire() as conn:
        seq = await conn.fetchval(
            "SELECT coalesce(max(seq),0)+1 FROM app.ai_message WHERE chat_id=$1", chat_id)
        await conn.execute(
            """INSERT INTO app.ai_message(chat_id, seq, role, content)
               VALUES($1,$2,'user',$3::jsonb)""",
            chat_id, seq, json.dumps([{"t": "text", "v": text}], ensure_ascii=False))
        await conn.execute("UPDATE app.ai_chat SET updated_at=now() WHERE id=$1", chat_id)
        hist = await conn.fetch(
            """SELECT role, content FROM app.ai_message
                WHERE chat_id=$1 ORDER BY seq DESC LIMIT $2""",
            chat_id, settings.ai_history_turns)
        had_title = await conn.fetchval("SELECT title FROM app.ai_chat WHERE id=$1", chat_id)

    # 이력은 모델로 나가기 전에 지운다(나가는 문 ②). 저장된 원문은 안 건드린다
    ctx = Ctx(user.account_id, user.team_id, chat_id, token)
    msgs = []
    for r in reversed(hist):
        s = scrub(_plain(r["content"]))
        ctx.scrub_hits.extend(s.hits)
        if s.text:
            msgs.append({"role": r["role"], "content": s.text})

    async def stream():
        yield _sse({"t": "start", "seq": seq + 1})
        q: asyncio.Queue = asyncio.Queue()
        res: loop.Result | None = None
        code: str | None = None

        async def emit(e: dict) -> None:
            await q.put(e)

        async def work() -> None:
            nonlocal res, code
            try:
                if not ai.configured():
                    raise ai.AiUnavailable(ai.NOT_CONFIGURED)
                load_all()
                # 길 다섯을 지시문에 직접 싣는다. 첫 실측에서 매 대화 list·describe 두 바퀴에 3만 토큰이 들었다
                sys_text = system(tools=brief() + "\n\n" + endpoints_brief(), limits=await limits())
                res = await loop.run(ctx, sys_text, msgs, emit)
            except (ai.AiUnavailable, anthropic.APIError, anthropic.APIConnectionError) as e:
                code = ai.as_code(e)
                # 코드만 화면에 가고 본문은 여기 남는다. 400 이 왜 났는지는 로그에서만 안다
                log.warning("ai upstream %s · chat=%s · %s: %s", code, chat_id, type(e).__name__, str(e)[:600])
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001 — 고리 밖에서 죽은 것. 대화는 산다
                code = ai.UPSTREAM_DOWN
                log.exception("ai loop crashed · chat=%s · %s", chat_id, type(e).__name__)
            finally:
                await q.put(None)

        task = asyncio.create_task(work())
        stop = None
        try:
            while True:
                e = await q.get()
                if e is None:
                    break
                yield _sse(e)
                if await req.is_disconnected():
                    task.cancel()
                    stop = "stop"
                    break
        finally:
            if not task.done():
                task.cancel()
            pieces = res.pieces if res else []
            tool_log = res.tool_log if res else []
            tin = res.tok_in if res else 0
            tout = res.tok_out if res else 0
            stop = stop or (f"error:{code}" if code else (res.stop if res else "stop"))
            if code:
                yield _sse(await err(code))
            mid = None
            if pieces or code:
                mid = await _save(chat_id, seq + 1, pieces, tool_log, tin, tout, stop)
            title = None
            answer = res.text if res else ""
            if answer and not had_title:
                title = await _title(chat_id, text, answer)
            yield _sse({"t": "done", "message_id": mid, "title": title, "stop": stop,
                        "scrubbed": sorted(set(ctx.scrub_hits)) or None,
                        "tok_in": tin, "tok_out": tout})

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False, default=str)}\n\n"


async def _save(chat_id: int, seq: int, pieces: list, tool_log: list,
                tin: int, tout: int, stop: str) -> int:
    return await pool().fetchval(
        """INSERT INTO app.ai_message(chat_id, seq, role, content, tool_calls, model, tok_in, tok_out, stop_reason)
           VALUES($1,$2,'assistant',$3::jsonb,$4::jsonb,$5,$6,$7,$8)
           ON CONFLICT (chat_id, seq) DO NOTHING
           RETURNING id""",
        chat_id, seq, json.dumps(pieces, ensure_ascii=False, default=str),
        json.dumps(tool_log, ensure_ascii=False, default=str) if tool_log else None,
        settings.ai_model, tin, tout, stop)


async def _title(chat_id: int, ask: str, answer: str) -> str | None:
    """첫 답 뒤에 제목을 짓는다. 싼 모델로, 실패하면 그냥 없이 간다 —
    제목이 없다고 대화가 못 돌 이유가 없다."""
    try:
        r = await ai.client().messages.create(
            model=settings.ai_model_fast, max_tokens=40,
            system="대화 제목을 한국어 명사구 하나로 짓습니다. 15자 이내. 따옴표·마침표·설명 없이 제목만.",
            messages=[{"role": "user", "content": f"{ask}\n\n{answer[:500]}"}])
        t = r.content[0].text.strip().strip('"\'').replace("\n", " ")[:TITLE_MAX]
        if t:
            await pool().execute("UPDATE app.ai_chat SET title=$1 WHERE id=$2", t, chat_id)
            return t
    except Exception:  # noqa: BLE001
        pass
    return None
