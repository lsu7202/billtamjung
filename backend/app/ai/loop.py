"""도구 되먹임 고리 + 벤더 어댑터. 정본 10-AI-어시스턴트 §7 · §9

## 한 번의 대화

    지시문 + 이력 → 모델 → (도구 호출 → 실행 → scrub → 되먹임)* → 답

도구를 부를 때마다 이력 전체를 다시 보낸다(§23). 세 바퀴면 입력이 세 번 실린다.
그래서 결과는 참조로(§23-1), 지시문은 캐시로(앞부분 `cache_control`).

## 벤더는 어댑터 한 겹뿐이다

도구 등록부·scrub·결과 규약은 벤더를 모른다. 겨루기(§24 3단계) 때 재미나이·GPT 어댑터를
같은 자리에 끼운다. `run()` 은 어댑터가 무엇이든 같다.

## 나가는 문 (§3 ②)

도구 결과가 모델로 돌아가기 **직전**에 `scrub_obj` 를 지난다. 사용자 입력은 assistant.py 가
이미 지웠다. 두 문이 다 잠겨야 한다 — 하나만 막으면 도구가 퍼 온 값으로 샌다.

## 도구가 딸려 내는 것

    _ui    화면이 그릴 부품(§12 · §13). 모델에겐 안 보인다. 떼어서 화면으로 보낸다
    _ask   되물음(§9-6). 고리를 **멈추고** 칩을 띄운다. 답은 다음 사용자 말로 온다
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Protocol

import anthropic

log = logging.getLogger(__name__)

from ..core.config import settings
from . import client as ai
from .scrub import scrub_obj
from .tools import REGISTRY, Ctx, load_all

MAX_ROUNDS = 8            # 도구 바퀴 상한. 넘으면 「더 못 한다」고 멈춘다
TOOL_SUMMARY = 160        # 화면에 보이는 도구 결과 한 줄

Emit = Callable[[dict], Awaitable[None] | None]


@dataclass
class ToolCall:
    id: str
    name: str
    input: dict[str, Any]


@dataclass
class Turn:
    """모델이 한 번 답한 것. 벤더 꼴은 raw 에 두고 나머지는 우리 꼴."""
    text: str
    tool_calls: list[ToolCall]
    raw: Any                       # 이력에 그대로 붙일 벤더 꼴 assistant 내용
    stop: str
    tok_in: int
    tok_out: int
    web: list[dict] = field(default_factory=list)   # 벤더가 돌린 웹 검색. {id, query, n}. 화면에 도구 줄로


@dataclass
class Result:
    pieces: list[dict] = field(default_factory=list)      # ai_message.content
    tool_log: list[dict] = field(default_factory=list)    # ai_message.tool_calls
    stop: str = "end_turn"
    tok_in: int = 0
    tok_out: int = 0

    @property
    def text(self) -> str:
        return "\n".join(p["v"] for p in self.pieces if p.get("t") == "text").strip()


OnText = Callable[[str], Awaitable[None]]


class Adapter(Protocol):
    def tools(self) -> list[dict]: ...
    async def turn(self, system: str, messages: list[dict], on_text: OnText) -> Turn: ...
    def assistant_msg(self, turn: Turn) -> dict: ...
    def tool_results_msg(self, results: list[tuple[str, Any]]) -> dict: ...


# ── Anthropic ───────────────────────────────────────────────────────
class AnthropicAdapter:
    def __init__(self, model: str | None = None):
        self.client = ai.client()
        self.model = model or settings.ai_model

    # 웹 검색은 벤더가 서버에서 돌리는 도구다(§9 · 2단계). 새 벤더도 새 키도 없다.
    # 우리 도구와 다르게 **우리가 실행하지 않는다** — 모델 턴 안에서 벤더가 찾고 결과를 붙여 온다.
    # 겨루기 때 재미나이·GPT 는 각자 제 검색을 이 자리에 끼운다.
    WEB_SEARCH = {"type": "web_search_20250305", "name": "web_search", "max_uses": 5}

    def tools(self) -> list[dict]:
        ours = [{"name": t.name, "description": t.description, "input_schema": t.params}
                for t in REGISTRY.values()]
        return ours + [self.WEB_SEARCH]

    async def turn(self, system, messages, on_text) -> Turn:
        # 지시문은 매 바퀴 같다. 캐시에 넣는다(§23). 10분의 1 값
        sys_blocks = [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]
        async with self.client.messages.stream(
            model=self.model, max_tokens=settings.ai_max_tokens,
            system=sys_blocks, messages=messages, tools=self.tools(),
        ) as s:
            async for ev in s:
                if getattr(ev, "type", "") == "content_block_delta" \
                        and getattr(ev.delta, "type", "") == "text_delta":
                    await on_text(ev.delta.text)
            final = await s.get_final_message()
        text = "".join(b.text for b in final.content if b.type == "text")
        calls = [ToolCall(b.id, b.name, dict(b.input)) for b in final.content if b.type == "tool_use"]
        # 이력에 되붙일 assistant 내용은 **손으로 짓는다.** model_dump() 는 citations:null 같은
        # 빈 칸까지 실어 보내고, API 가 그걸 400 으로 거절했다(2026-09-08 대화 #11).
        # 웹 검색 블록(server_tool_use · web_search_tool_result)과 인용은 그대로 되붙여야
        # 다음 바퀴에서 모델이 자기가 뭘 찾았는지 안다. 그것만 exclude_none 으로 덤프한다.
        raw = []
        web: list[dict] = []
        for b in final.content:
            if b.type == "text" and b.text:
                blk: dict = {"type": "text", "text": b.text}
                cites = getattr(b, "citations", None)
                if cites:
                    blk["citations"] = [c.model_dump(exclude_none=True) for c in cites]
                raw.append(blk)
            elif b.type == "tool_use":
                raw.append({"type": "tool_use", "id": b.id, "name": b.name, "input": dict(b.input)})
            elif b.type == "server_tool_use":
                raw.append({"type": "server_tool_use", "id": b.id, "name": b.name, "input": dict(b.input)})
                web.append({"id": b.id, "query": dict(b.input).get("query", ""), "n": 0})
            elif b.type == "web_search_tool_result":
                raw.append(b.model_dump(exclude_none=True))
                c = getattr(b, "content", None)
                n = len(c) if isinstance(c, list) else 0
                for w in web:
                    if w["id"] == getattr(b, "tool_use_id", None):
                        w["n"] = n
        u = final.usage
        return Turn(text, calls, raw, final.stop_reason or "end_turn",
                    (u.input_tokens or 0) + (getattr(u, "cache_read_input_tokens", 0) or 0)
                    + (getattr(u, "cache_creation_input_tokens", 0) or 0),
                    u.output_tokens or 0, web)

    def assistant_msg(self, turn: Turn) -> dict:
        return {"role": "assistant", "content": turn.raw}

    def tool_results_msg(self, results) -> dict:
        return {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": tid,
             "content": json.dumps(out, ensure_ascii=False, default=str)}
            for tid, out in results]}


def make_adapter(vendor: str = "anthropic") -> Adapter:
    """겨루기 때 여기에 재미나이·GPT 가 붙는다. 지금은 하나."""
    if vendor == "anthropic":
        return AnthropicAdapter()
    raise ValueError(f"모르는 벤더 {vendor}")


# ── 고리 ────────────────────────────────────────────────────────────
def _summ(out: Any) -> str:
    """화면에 보이는 도구 결과 한 줄. 모델이 아니라 사람이 본다."""
    if isinstance(out, dict):
        if "error" in out:
            return f"오류 · {out['error']}"[:TOOL_SUMMARY]
        bits = []
        if "count" in out:
            bits.append(f"{out['count']}줄")
        if out.get("truncated"):
            bits.append("더 있음")
        if "ms" in out:
            bits.append(f"{out['ms']}ms")
        if "tables" in out:
            bits.append(f"표 {len(out['tables'])}개")
        if "columns" in out:
            bits.append(f"칸 {len(out['columns'])}개")
        if "endpoints" in out:
            bits.append(f"길 {len(out['endpoints'])}개")
        return " · ".join(bits) or json.dumps(out, ensure_ascii=False)[:TOOL_SUMMARY]
    return str(out)[:TOOL_SUMMARY]


async def run(ctx: Ctx, system: str, history: list[dict], emit: Emit,
              vendor: str = "anthropic") -> Result:
    """도구가 없을 때까지, 또는 되물음이 뜰 때까지 돈다."""
    load_all()
    adapter = make_adapter(vendor)
    msgs = list(history)
    res = Result()

    async def _emit(e: dict) -> None:
        r = emit(e)
        if r is not None:
            await r

    for _round in range(MAX_ROUNDS):
        async def on_text(s: str) -> None:
            await _emit({"t": "delta", "v": s})          # 글자마다 흘린다. 바퀴 끝에 몰아 보내면 스트림이 아니다
        turn = await adapter.turn(system, msgs, on_text)
        res.tok_in += turn.tok_in
        res.tok_out += turn.tok_out
        # 벤더가 돌린 웹 검색은 모델 턴 안에서 이미 끝났다. 사후에 도구 줄로 내보내고 기록에 남긴다
        for w in turn.web:
            summ = f"결과 {w['n']}건"
            await _emit({"t": "tool", "phase": "start", "id": w["id"], "name": "web_search", "input": {"q": w["query"]}})
            await _emit({"t": "tool", "phase": "end", "id": w["id"], "name": "web_search", "ms": 0, "summary": summ})
            res.tool_log.append({"name": "web_search", "input": {"q": w["query"]}, "ms": 0, "summary": summ, "error": None})
        if turn.text:
            res.pieces.append({"t": "text", "v": turn.text})

        if not turn.tool_calls:
            res.stop = turn.stop
            return res

        msgs.append(adapter.assistant_msg(turn))
        results: list[tuple[str, Any]] = []
        for tc in turn.tool_calls:
            await _emit({"t": "tool", "phase": "start", "id": tc.id, "name": tc.name, "input": tc.input})
            t0 = time.monotonic()
            spec = REGISTRY.get(tc.name)
            if spec is None:
                out: Any = {"error": f"없는 도구 {tc.name}"}
            else:
                try:
                    out = await spec.fn(ctx, **tc.input)
                except Exception as e:  # noqa: BLE001 — 도구 하나가 죽어도 대화는 산다
                    # TypeError 를 「인자가 안 맞는다」로 따로 포장했더니 도구 **안에서** 난 TypeError 까지
                    # 그렇게 보였다. 모델이 멀쩡한 본문을 네 번 바꿔 보다 바퀴를 다 썼다(대화 #10).
                    # 이름과 말을 그대로 준다. 인자 문제면 모델이 스키마를 다시 보고, 우리 버그면 로그에 남는다
                    out = {"error": f"{type(e).__name__}: {e}"}
                    log.warning("ai tool %s failed: %s: %s · input=%s", tc.name, type(e).__name__, e,
                                json.dumps(tc.input, ensure_ascii=False)[:300])
            ms = int((time.monotonic() - t0) * 1000)

            ui = ask = None
            if isinstance(out, dict):
                ui = out.pop("_ui", None)
                ask = out.pop("_ask", None)
            out = scrub_obj(out)                       # 나가는 문 ②

            res.tool_log.append({"name": tc.name, "input": tc.input, "ms": ms, "summary": _summ(out),
                                 "error": out.get("error") if isinstance(out, dict) else None})
            await _emit({"t": "tool", "phase": "end", "id": tc.id, "name": tc.name, "ms": ms,
                         "summary": _summ(out)})
            if ui:
                piece = {"t": "ui", **ui}
                res.pieces.append(piece)
                await _emit(piece)
            if ask:
                piece = {"t": "ask", **ask}
                res.pieces.append(piece)
                await _emit(piece)
                res.stop = "ask"
                return res                               # 답은 다음 사용자 말로 온다
            results.append((tc.id, out))
        msgs.append(adapter.tool_results_msg(results))

    res.stop = "max_rounds"
    res.pieces.append({"t": "text", "v": "도구를 여러 번 불렀는데 답이 안 모입니다. 질문을 좁혀 주세요."})
    return res


def as_code(e: Exception) -> str:
    return ai.as_code(e)
