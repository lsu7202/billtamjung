"""AI 어시스턴트 — 대화 CRUD 와 스트림. 정본 specs/07-architecture/10-AI-어시스턴트.md

## 1단계 (뼈대)

도구가 하나도 없다. **그냥 대화가 된다.** 이 단계가 끝나면 클로드처럼 쓸 수 있고,
2단계(도구·SQL·롤·scrub)가 끝나면 우리 것이 된다.

## 개인이다

대화는 `account_id` 로 잠긴다. 이 앱의 다른 업무 데이터는 전부 `team_id` 로 잠기는데
(가입하면 1인 팀이 자동으로 생긴다) 대화·기억·문서만 개인이다.
**팀원의 대화는 안 보인다.** 나중에 AI 가 보는 업무 데이터는 여전히 팀 것이다.

## 저장은 우리가 한다

Messages API 는 상태가 없다. 매 호출에 지난 대화를 통째로 다시 보낸다.
우리가 저장 안 하면 아무 데도 안 남는다.

## 조각

답 한 통은 조각 목록이다(`content` jsonb). 1단계는 글뿐이지만 곧 부품과
아티팩트가 섞인다. 지금부터 목록으로 저장해 두면 그때 표를 안 고친다.
"""
from __future__ import annotations

import json

import anthropic
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..ai import client as ai
from ..ai.prompt import system
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
    """조각 목록에서 글자만. 모델에 되보낼 때 쓴다(부품·아티팩트는 글이 아니다)."""
    if isinstance(content, str):
        content = json.loads(content)
    return "\n".join(p.get("v", "") for p in content if p.get("t") == "text").strip()


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
        """SELECT id, seq, role, content, created_at FROM app.ai_message
            WHERE chat_id=$1 ORDER BY seq""", chat_id)
    return [{**dict(r), "content": json.loads(r["content"])} for r in rows]


# ── 보내기 ──────────────────────────────────────────────────────────
class SendIn(BaseModel):
    text: str = Field(min_length=1, max_length=20_000)


@router.post("/chats/{chat_id}/messages")
async def send(chat_id: int, body: SendIn, req: Request,
               user: CurrentUser = Depends(current_user)):
    """사용자 말을 싣고 답을 흘린다(SSE).

    사용자 말은 **스트림 전에** 저장한다. 모델이 죽어도 사용자가 친 것은 남아야 한다.
    답은 끝에 저장하되, 도중에 끊겨도 거기까지를 저장한다(§21 조용한 실패).
    """
    await _own(chat_id, user.account_id)
    text = body.text.strip()

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

    msgs = [{"role": r["role"], "content": _plain(r["content"])}
            for r in reversed(hist) if _plain(r["content"])]

    async def stream():
        yield _sse({"t": "start", "seq": seq + 1})
        got, tin, tout, stop = [], 0, 0, "end_turn"
        try:
            if not ai.configured():
                raise ai.AiUnavailable(ai.NOT_CONFIGURED)
            async with ai.client().messages.stream(
                model=settings.ai_model,
                max_tokens=settings.ai_max_tokens,
                system=system(),
                messages=msgs,
            ) as s:
                async for chunk in s.text_stream:
                    got.append(chunk)
                    yield _sse({"t": "delta", "v": chunk})
                    if await req.is_disconnected():
                        stop = "stop"
                        break
                final = await s.get_final_message()
                tin, tout = final.usage.input_tokens, final.usage.output_tokens
        except (ai.AiUnavailable, anthropic.APIError, anthropic.APIConnectionError) as e:
            code = ai.as_code(e)
            stop = f"error:{code}"
            yield _sse(await err(code))
        finally:
            answer = "".join(got)
            mid = None
            if answer or stop.startswith("error"):
                mid = await _save(chat_id, seq + 1, answer, tin, tout, stop)
            title = None
            if answer and not had_title:
                title = await _title(chat_id, text, answer)
            yield _sse({"t": "done", "message_id": mid, "title": title, "stop": stop})

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False, default=str)}\n\n"


async def _save(chat_id: int, seq: int, answer: str, tin: int, tout: int, stop: str) -> int:
    content = [{"t": "text", "v": answer}] if answer else []
    return await pool().fetchval(
        """INSERT INTO app.ai_message(chat_id, seq, role, content, model, tok_in, tok_out, stop_reason)
           VALUES($1,$2,'assistant',$3::jsonb,$4,$5,$6,$7)
           ON CONFLICT (chat_id, seq) DO NOTHING
           RETURNING id""",
        chat_id, seq, json.dumps(content, ensure_ascii=False),
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
    except Exception:
        pass
    return None
