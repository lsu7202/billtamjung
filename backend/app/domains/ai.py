"""모델 쪽 문 — 라우트만 둔다(2026-09-18 · 대화 저장 2026-09-21).

조립은 `app/ai/tools.py`, 고리는 `app/ai/agent.py`, 나가는 문은 `app/ai/scrub.py` 다.
여기 있는 것은 인증·흘려보내기·오류 코드·**대화 저장**뿐이다.

    GET  /ai/tools    모델이 받을 스키마를 눈으로 본다. 시험 스크립트도 이걸 읽는다
    POST /ai/search   도구 search 와 **같은 함수**. curl 로 찔러 보려고 둔다
                      인자는 모델이 보는 그대로 한국어다 — `조건`·`정렬`·`차순`
    GET  /ai/buildings/{pk}   도구 building 과 같은 함수(도구는 감춰 뒀어도 라우트는 산다)
    POST /ai/chat     한 물음을 돌리고 일어난 일을 줄 단위 JSON 으로 흘린다(저장 안 함)

    GET/POST /ai/chats · GET/PATCH/DELETE /ai/chats/{id} · POST /ai/chats/{id}/messages
                      화면이 부르는 대화. **app.ai_chat · app.ai_message 에 남는다**(0166 · 0175).
                      전엔 메모리에만 둬서 서버를 다시 띄우면 사라졌다.

대화는 **개인**이다. account_id 로 잠긴다(팀 아님). 지우기는 archived_at 만 찍는다 —
잘못 눌러 날린 대화를 되살릴 길을 남긴다(0166).

REST 모양이 모델에게 안 맞는 자리가 생기면 전용 엔드포인트를 **여기에** 판다.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..ai import agent, tools
from ..core.db import pool
from ..core.deps import CurrentUser, current_user

router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/tools", openapi_extra={"x-ai": "read"})
async def tool_schema(_: CurrentUser = Depends(current_user)):
    """모델에게 그대로 넘길 도구 배열. `hidden` 은 무엇을 왜 뺐는지다."""
    return await tools.build()


@router.post("/search", openapi_extra={"x-ai": "read"})
async def model_search(body: dict, user: CurrentUser = Depends(current_user)):
    """도구 `search` 가 부르는 바로 그 함수. 라우트는 우리가 curl 로 찔러 보려고 둔다 —
    도구는 HTTP 를 안 타고 같은 프로세스에서 직접 부른다.

    몸통을 **모델이 보내는 그대로** 흘린다(`{"조건": [{...}], "정렬": …}`). Pydantic 으로
    한 겹 받으면 curl 이 도구와 다른 것을 찌르게 돼 시험이 시험이 아니게 된다.
    """
    return await _same_as_model(tools._run_search, body, user)


@router.get("/buildings/{building_pk}", openapi_extra={"x-ai": "read"})
async def model_building(building_pk: str, 함께: str = "",
                         user: CurrentUser = Depends(current_user)):
    """도구 `building` 이 부르는 바로 그 함수. 건물번호는 쉼표로 여럿, `함께` 는 쉼표 목록이나
    JSON 객체(`{"주변동향":{"반경":250}}`)다.

        GET /ai/buildings/1024122299?%ED%95%A8%EA%BB%98=층별,주변실거래

    질의 문자열은 **이름까지** 감싸야 한다. `--data-urlencode` 는 값만 감싸므로
    날것의 「함께」가 URL 에 실려 HTTP 파서가 먼저 튕긴다.
    """
    t = 함께.strip()
    if t.startswith("{"):
        try:
            want = json.loads(t)
        except json.JSONDecodeError as e:
            raise HTTPException(422, f"함께 가 JSON 이 아니다: {e}") from e
    else:
        want = [w.strip() for w in t.split(",") if w.strip()]
    pks = [p.strip() for p in building_pk.split(",") if p.strip()]
    return await _same_as_model(tools._run_building,
                                {"건물번호": pks, "함께": want}, user)


async def _same_as_model(fn, args: dict, user: CurrentUser):
    """도구가 죽었을 때 모델이 듣는 말을 curl 도 그대로 듣게 한다.

    `agent.Exec` 는 어떤 예외든 잡아 `{"error": …}` 로 모델에게 넘긴다. 라우트가
    500 을 뱉으면 curl 로 본 것과 모델이 본 것이 갈라져, 여기서 고친 문구가 저기서
    맞는지 알 길이 없다."""
    try:
        return await fn(args, user)
    except HTTPException:
        raise
    except Exception as e:                        # noqa: BLE001
        raise HTTPException(422, str(e)[:600]) from e


# ── 화면(features/assistant)이 부르는 대화 ──────────────────────────────────
# 모델 쪽은 건드리지 않는다 — agent.ask 가 내는 조각을 화면이 기대하는 SSE 사건
# (delta·tool·pins·done)으로 겉만 바꾸고, 끝나면 답을 표에 적는다.

def _j(v):
    """asyncpg 는 jsonb 를 문자열로 준다(코덱을 안 걸었다). 표에 적을 때도 문자열로 넘긴다."""
    if v is None or not isinstance(v, str):
        return v
    try:
        return json.loads(v)
    except ValueError:
        return None


def _chat_row(r) -> dict:
    return {"id": r["id"], "title": r["title"], "updated_at": r["updated_at"].isoformat()}


async def _own_chat(user: CurrentUser, chat_id: int):
    """내 대화가 맞나. 남의 것이면 없는 것과 같이 404 — 있다는 사실도 안 알린다."""
    r = await pool().fetchrow(
        "SELECT id, title, updated_at FROM app.ai_chat"
        " WHERE id = $1 AND account_id = $2 AND archived_at IS NULL", chat_id, user.account_id)
    if r is None:
        raise HTTPException(404, "그런 대화는 없다")
    return r


@router.get("/chats")
async def chats_list(user: CurrentUser = Depends(current_user)):
    rows = await pool().fetch(
        "SELECT id, title, updated_at FROM app.ai_chat"
        " WHERE account_id = $1 AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 200",
        user.account_id)
    return [_chat_row(r) for r in rows]


@router.post("/chats")
async def chats_create(user: CurrentUser = Depends(current_user)):
    r = await pool().fetchrow(
        "INSERT INTO app.ai_chat (account_id) VALUES ($1) RETURNING id, title, updated_at",
        user.account_id)
    return _chat_row(r)


@router.get("/chats/{chat_id}")
async def chat_messages(chat_id: int, user: CurrentUser = Depends(current_user)):
    await _own_chat(user, chat_id)
    rows = await pool().fetch(
        "SELECT id, seq, role, content, tool_calls, pins, created_at"
        " FROM app.ai_message WHERE chat_id = $1 ORDER BY seq", chat_id)
    return [{"id": r["id"], "seq": r["seq"], "role": r["role"],
             "content": _j(r["content"]) or [], "tool_calls": _j(r["tool_calls"]),
             "pins": _j(r["pins"]), "created_at": r["created_at"].isoformat()} for r in rows]


class RenameIn(BaseModel):
    title: str


@router.patch("/chats/{chat_id}")
async def chat_rename(chat_id: int, body: RenameIn, user: CurrentUser = Depends(current_user)):
    await _own_chat(user, chat_id)
    await pool().execute("UPDATE app.ai_chat SET title = $2, updated_at = now() WHERE id = $1",
                         chat_id, body.title.strip()[:80] or None)
    return {"ok": True}


@router.delete("/chats/{chat_id}", status_code=204)
async def chat_delete(chat_id: int, user: CurrentUser = Depends(current_user)):
    await _own_chat(user, chat_id)
    await pool().execute("UPDATE app.ai_chat SET archived_at = now() WHERE id = $1", chat_id)
    return None


async def _append(chat_id: int, role: str, content: list, *, tool_calls=None, pins=None,
                  model: str | None = None, tok_in: int | None = None, tok_out: int | None = None,
                  stop: str | None = None, refs=None) -> dict:
    """대화 끝에 한 줄. seq 는 표에서 센다 — 메모리 카운터는 서버가 둘이면 어긋난다."""
    r = await pool().fetchrow(
        """INSERT INTO app.ai_message
             (chat_id, seq, role, content, tool_calls, pins, model, tok_in, tok_out, stop_reason, refs)
           VALUES ($1, (SELECT coalesce(max(seq), 0) + 1 FROM app.ai_message WHERE chat_id = $1),
                   $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10::jsonb)
           RETURNING id, seq, created_at""",
        chat_id, role, agent.dumps(content),
        agent.dumps(tool_calls) if tool_calls else None,
        agent.dumps(pins) if pins else None,
        model, tok_in, tok_out, stop, agent.dumps(refs) if refs else None)
    await pool().execute("UPDATE app.ai_chat SET updated_at = now() WHERE id = $1", chat_id)
    return {"id": r["id"], "seq": r["seq"], "role": role, "content": content,
            "tool_calls": tool_calls, "pins": pins, "created_at": r["created_at"].isoformat()}


REF_TURNS = 3      # 도구 결과를 다시 넘길 최근 답 수(§23-4, 대표 「3턴까지」)


class AskIn(BaseModel):
    text: str
    history: list[dict] | None = None      # [{role, content}] — 앞선 대화. 없으면 첫 물음


@router.post("/chats/{chat_id}/messages")
async def chat_send(chat_id: int, body: AskIn, user: CurrentUser = Depends(current_user)):
    """화면용. SSE — `data: {…}` 뒤에 빈 줄. api.ts 가 그렇게 끊어 읽는다.

    흐름: 내 말을 먼저 표에 적고 → 앞선 대화(글 조각만)를 모델에 넘기고 → 조각을 흘리고 →
    끝나면 답을 표에 적는다. 제목이 없으면 **첫 물음의 앞머리**를 제목으로 삼는다 —
    모델에게 제목을 짓게 하지 않는다(바퀴 하나가 더 든다)."""
    if not agent.configured():
        raise HTTPException(503, agent.NOT_CONFIGURED)
    chat = await _own_chat(user, chat_id)
    text = body.text.strip()
    if not text:
        raise HTTPException(422, "물음이 비어 있다")

    def ev(d: dict) -> str:
        return "data: " + json.dumps(d, ensure_ascii=False, default=str) + "\n\n"

    # 앞선 대화 — 글 조각 + **최근 3턴은 도구 호출과 줄인 결과**(§23-4 · A-14). 「그 중 첫 번째」·
    # 「아까 자료」를 모델이 대화 기록에서 바로 읽는다. 그 앞 턴은 글만(통째로 넘기면 턴마다 쌓인다)
    prev = await pool().fetch(
        "SELECT role, content, refs FROM app.ai_message WHERE chat_id = $1 ORDER BY seq", chat_id)
    hist = [{"role": r["role"],
             "content": "".join(p.get("v", "") for p in (_j(r["content"]) or []) if p.get("t") == "text"),
             "refs": _j(r["refs"]) if r["role"] == "assistant" else None}
            for r in prev]
    recent = [i for i, h in enumerate(hist) if h["role"] == "assistant"][-REF_TURNS:]
    for i, h in enumerate(hist):
        if i not in recent or not h["refs"]:
            h.pop("refs", None)
    hist = [h for h in hist if h["content"] or h.get("refs")]
    await _append(chat_id, "user", [{"t": "text", "v": text}])
    new_title = None
    if not chat["title"]:
        new_title = text[:40]
        await pool().execute("UPDATE app.ai_chat SET title = $2 WHERE id = $1", chat_id, new_title)

    async def stream():
        yield ev({"t": "start", "seq": 1})
        scrubbed = None
        asked: list[dict] | None = None
        answer: list[str] = []
        tool_log: list[dict] = []
        pins: list[dict] = []
        try:
            async for piece in agent.ask(text, user, hist or None):
                t = piece.get("t")
                if t == "scrubbed":
                    scrubbed = piece.get("kinds")
                elif t == "text":
                    answer.append(piece["v"])
                    yield ev({"t": "delta", "v": piece["v"]})
                elif t == "tool":
                    tool_log.append({"name": piece["name"], "input": piece["input"], "ms": piece["ms"],
                                     "summary": f"{piece['bytes']:,}자", "error": None})
                    # 도구는 다 돈 뒤에 알게 되므로 start·end 를 잇달아 낸다
                    tid = f"{piece['name']}-{piece['ms']}"
                    yield ev({"t": "tool", "phase": "start", "id": tid, "name": piece["name"], "input": piece["input"]})
                    yield ev({"t": "tool", "phase": "end", "id": tid, "name": piece["name"], "ms": piece["ms"],
                              "summary": f"{piece['bytes']:,}자" + (f" · 가림 {','.join(piece['scrubbed'])}" if piece.get("scrubbed") else "")})
                    if piece.get("pins"):
                        # 화면 지도용 핀. 같은 건물이 두 검색에 걸리면 한 번만
                        seen = {p["pk"] for p in pins}
                        new = [p for p in piece["pins"] if p["pk"] not in seen]
                        pins.extend(new)
                        yield ev({"t": "pins", "items": new})
                elif t == "ask":
                    # 되물음. **답 안에 남는다** — 다시 열어도 칩이 서야 한다
                    asked = piece["물음"]
                    yield ev({"t": "ask", "물음": asked})
                elif t == "done":
                    body = [{"t": "text", "v": "".join(answer)}]
                    if asked:
                        body.append({"t": "ask", "물음": asked})
                    m = await _append(chat_id, "assistant", body,
                                      tool_calls=tool_log or None, pins=pins or None,
                                      model=piece.get("model"), tok_in=piece.get("tok_in"),
                                      tok_out=piece.get("tok_out"), stop="end_turn", refs=piece.get("refs"))
                    yield ev({"t": "done", "message_id": m["id"], "title": new_title, "stop": "end_turn",
                              "scrubbed": scrubbed, "tok_in": piece["tok_in"], "tok_out": piece["tok_out"]})
        except agent.AiUnavailable as e:
            # 답이 못 나온 것도 남긴다 — 빈 답이 아니라 왜 못 냈는지가 보여야 한다
            await _append(chat_id, "assistant", [{"t": "text", "v": "".join(answer)}],
                          tool_calls=tool_log or None, pins=pins or None, stop=f"error:{e.code}")
            yield ev({"t": "error", "code": e.code, "title": "지금은 답할 수 없습니다",
                      "body": e.detail, "action": "retry", "level": "warn"})

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/chat")
async def chat(body: AskIn, user: CurrentUser = Depends(current_user)):
    """줄 단위 JSON(ndjson)으로 흘린다. 조각 하나가 한 줄이다. **저장하지 않는다** — 시험용.

    SSE 가 아니라 ndjson 인 이유: 조각이 그대로 JSON 한 덩이라 `data:` 접두어와
    빈 줄 규약이 한 겹 더 붙을 이유가 없다. 화면은 줄로 끊어 읽으면 된다."""
    if not agent.configured():
        raise HTTPException(503, agent.NOT_CONFIGURED)
    if not body.text.strip():
        raise HTTPException(422, "물음이 비어 있다")

    async def stream():
        try:
            async for piece in agent.ask(body.text, user, body.history):
                yield json.dumps(piece, ensure_ascii=False, default=str) + "\n"
        except agent.AiUnavailable as e:
            # 문구를 서버가 짓지 않는다 — 코드만 보내고 화면이 ref.error_msg 에서 읽는다
            yield json.dumps({"t": "error", "code": e.code}, ensure_ascii=False) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")
