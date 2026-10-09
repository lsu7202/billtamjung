"""모델 쪽 문 — 라우트만 둔다(2026-09-18 · 대화 저장 2026-09-21).

조립은 `app/ai/tools.py`, 고리는 `app/ai/agent.py`, 나가는 문은 `app/ai/scrub.py` 다.
여기 있는 것은 인증·흘려보내기·오류 코드·**대화 저장**뿐이다.

    GET  /ai/tools    내 모드(토큰의 계정 종류)의 도구 스키마. 시험 스크립트도 이걸 읽는다
    POST /ai/read/buildings · /ai/read/customers · GET /ai/read/me
                      읽기 도구와 **같은 함수**(11b §5). 인자는 모델이 보는 그대로 한국어다
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
import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..ai import agent, people, tools
from ..core import storage
from ..core.db import pool
from ..core.deps import CurrentUser, any_user, current_user

router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/tools", openapi_extra={"x-ai": "read"})
async def tool_schema(user: CurrentUser = Depends(any_user)):
    """내 모드(토큰의 계정 종류)의 도구 배열. `hidden` 은 무엇을 왜 뺐는지다."""
    return await tools.build(user)


# ── 읽기 점검(11b §5) — 모델은 HTTP 를 안 탄다. 사람이 같은 함수를 curl 로 찔러 보는 길이다 ──
# 몸통을 **모델이 보내는 그대로** 흘린다. 대화 엔진과 같은 모드 · 같은 거름을 탄다.
@router.post("/read/buildings", openapi_extra={"x-ai": "read"})
async def read_buildings(body: dict, user: CurrentUser = Depends(any_user)):
    return await _same_as_model(tools._run_buildings, body, user)


@router.post("/read/customers", openapi_extra={"x-ai": "read"})
async def read_customers(body: dict, user: CurrentUser = Depends(current_user)):
    return await _same_as_model(people.run_customers, body, user)


@router.get("/read/me", openapi_extra={"x-ai": "read"})
async def read_me(user: CurrentUser = Depends(any_user)):
    return await _same_as_model(people.run_me, {}, user)


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
        "SELECT id, seq, role, content, tool_calls, pins, panel, created_at"
        " FROM app.ai_message WHERE chat_id = $1 ORDER BY seq", chat_id)
    return [{"id": r["id"], "seq": r["seq"], "role": r["role"],
             "content": _j(r["content"]) or [], "tool_calls": _j(r["tool_calls"]),
             "pins": _j(r["pins"]), "panel": _j(r["panel"]), "created_at": r["created_at"].isoformat()} for r in rows]


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
                  stop: str | None = None, refs=None, panel=None) -> dict:
    """대화 끝에 한 줄. seq 는 표에서 센다 — 메모리 카운터는 서버가 둘이면 어긋난다."""
    r = await pool().fetchrow(
        """INSERT INTO app.ai_message
             (chat_id, seq, role, content, tool_calls, pins, model, tok_in, tok_out, stop_reason, refs, panel)
           VALUES ($1, (SELECT coalesce(max(seq), 0) + 1 FROM app.ai_message WHERE chat_id = $1),
                   $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
           RETURNING id, seq, created_at""",
        chat_id, role, agent.dumps(content),
        agent.dumps(tool_calls) if tool_calls else None,
        agent.dumps(pins) if pins else None,
        model, tok_in, tok_out, stop, agent.dumps(refs) if refs else None, agent.dumps(panel) if panel else None)
    await pool().execute("UPDATE app.ai_chat SET updated_at = now() WHERE id = $1", chat_id)
    return {"id": r["id"], "seq": r["seq"], "role": role, "content": content,
            "tool_calls": tool_calls, "pins": pins, "panel": panel, "created_at": r["created_at"].isoformat()}


REF_TURNS = 3      # 도구 결과를 다시 넘길 최근 답 수(§23-4, 대표 「3턴까지」)


# ── 올린 이미지(0237) — 자료에 넣는 용도. 파일은 바깥 모델로 안 보낸다 · 올린 사람 본인만 연다 ──
_UP_MAX = 15 * 1024 * 1024


@router.post("/uploads")
async def upload(file: UploadFile = File(...), user: CurrentUser = Depends(current_user)):
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(422, "이미지 파일만 올릴 수 있습니다")
    data = await file.read()
    if len(data) > _UP_MAX:
        raise HTTPException(422, "15MB 까지 올릴 수 있습니다")
    key = f"ai_uploads/acc{user.account_id}_{uuid.uuid4().hex}{os.path.splitext(file.filename or '')[1][:8] or '.jpg'}"
    await storage.save(key, data, file.content_type or "image/jpeg")
    uid = await pool().fetchval(
        "INSERT INTO app.ai_uploads(account_id, path, mime, name) VALUES ($1,$2,$3,$4) RETURNING id",
        user.account_id, key, file.content_type or "image/jpeg", (file.filename or "")[:200])
    return {"id": uid, "name": file.filename}


@router.get("/uploads/{uid}")
async def upload_get(uid: int, user: CurrentUser = Depends(current_user)):
    r = await pool().fetchrow("SELECT path, mime FROM app.ai_uploads WHERE id=$1 AND account_id=$2", uid, user.account_id)
    data = await storage.load(r["path"]) if r else None
    if data is None:
        raise HTTPException(404, "사진이 없습니다")
    return Response(content=data, media_type=r["mime"], headers={"Cache-Control": "private, max-age=600"})


class AskIn(BaseModel):
    text: str
    history: list[dict] | None = None      # [{role, content}] — 앞선 대화. 없으면 첫 물음
    template: str | None = None            # 사용자가 고른 자료 템플릿(0235) · 이 말 한 번뿐
    attachments: list[int] | None = None   # 이 말과 함께 올린 이미지(0237) · 모델에겐 번호만 간다


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
    # 올린 이미지 — 내 것만. 말 조각에 남겨 다시 열어도 사진이 보이고, 모델에겐 번호만 간다
    ups = []
    if body.attachments:
        ups = [dict(r) for r in await pool().fetch(
            "SELECT id, name FROM app.ai_uploads WHERE id = ANY($1::bigint[]) AND account_id = $2 ORDER BY id",
            body.attachments[:10], user.account_id)]
        await pool().execute("UPDATE app.ai_uploads SET chat_id = $1 WHERE id = ANY($2::bigint[]) AND account_id = $3",
                             chat_id, [u["id"] for u in ups], user.account_id)
    await _append(chat_id, "user", [{"t": "text", "v": text}] + [{"t": "file", "id": u["id"], "name": u["name"]} for u in ups])
    if ups:
        text = text + "\n\n(사용자가 이미지를 올렸다: " + " · ".join(
            f'<bt-upload id="{u["id"]}"></bt-upload>' + (f'({u["name"]})' if u["name"] else "") for u in ups) + \
            " — 자료에 이 부품으로 넣을 수 있다)"
    new_title = None
    if not chat["title"]:
        new_title = text[:40]
        await pool().execute("UPDATE app.ai_chat SET title = $2 WHERE id = $1", chat_id, new_title)

    tpl_key = body.template          # 스트림 안의 지역 이름 body(답 조각)와 겹치지 않게 미리 꺼낸다

    async def stream():
        yield ev({"t": "start", "seq": 1})
        scrubbed = None
        asked: list[dict] | None = None
        answer: list[str] = []
        tool_log: list[dict] = []
        pins: list[dict] = []
        panel: dict | None = None      # 이번 답의 마지막 판 열기(0235). 다시 열면 이 판이 돌아온다
        try:
            async for piece in agent.ask(text, user, hist or None, tpl_key):
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
                    if piece.get("panel"):
                        # 오른쪽 판 열기 — 도구가 「보여 준다」고 정했을 때만(핀이 있다고 열지 않는다)
                        panel = piece["panel"]
                        yield ev({"t": "panel", **panel})
                elif t == "ask":
                    # 되물음. **답 안에 남는다** — 다시 열어도 칩이 서야 한다
                    asked = piece["물음"]
                    yield ev({"t": "ask", "물음": asked})
                elif t == "done":
                    body = [{"t": "text", "v": "".join(answer)}]
                    if asked:
                        body.append({"t": "ask", "물음": asked})
                    m = await _append(chat_id, "assistant", body,
                                      tool_calls=tool_log or None, pins=pins or None, panel=panel,
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


