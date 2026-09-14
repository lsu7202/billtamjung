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
from .tools import REGISTRY, Ctx, load_all, visible
from .tools.answer import normalize

MAX_ROUNDS = 10           # 도구 바퀴 상한. ui·answer 도 바퀴라 8 은 빠듯했다(2026-09-09 겨루기 2번:
                          # 자료를 다 모으고 ui 까지 부른 뒤 answer 할 바퀴가 없어 버렸다)
FINISH = ("자료는 충분합니다. 이번 턴에 **answer 로 끝내세요.** 도구를 더 부르지 않습니다. "
          "모은 것으로 두세 문장을 쓰고, 모자란 것은 모자라다고 적습니다.")
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
    cache_read: int = 0            # 캐시에서 읽은 입력. 10분의 1 값이라 따로 센다(§23)
    web: list[dict] = field(default_factory=list)   # 벤더가 돌린 웹 검색. {id, query, n}. 화면에 도구 줄로


@dataclass
class Result:
    pieces: list[dict] = field(default_factory=list)      # ai_message.content
    tool_log: list[dict] = field(default_factory=list)    # ai_message.tool_calls
    stop: str = "end_turn"
    tok_in: int = 0
    tok_out: int = 0
    cache_read: int = 0
    answered: bool = False
    answer_fail: int = 0           # answer 도구로 답이 났나

    @property
    def text(self) -> str:
        return "\n".join(p["v"] for p in self.pieces if p.get("t") == "text").strip()


OnText = Callable[[str], Awaitable[None]]


class Adapter(Protocol):
    def tools(self) -> list[dict]: ...
    async def turn(self, system: str, messages: list[dict], on_text: OnText,
                   finish: bool = False) -> Turn: ...
    def assistant_msg(self, turn: Turn) -> dict: ...
    def tool_results_msg(self, results: list[tuple[str, Any]]) -> dict: ...


# ── Anthropic ───────────────────────────────────────────────────────
class AnthropicAdapter:
    def __init__(self, model: str | None = None, effort: str | None = None):
        self.client = ai.client()
        self.model = model or settings.ai_model
        # effort 는 모델 등급을 내리기 전에 먼저 당겨 볼 손잡이다(겨루기 A). 하이쿠 4.5 는 effort 를 모른다
        self.effort = effort if (effort and "haiku" not in self.model) else None

    # 웹 검색은 벤더가 서버에서 돌리는 도구다(§9 · 2단계). 새 벤더도 새 키도 없다.
    # 우리 도구와 다르게 **우리가 실행하지 않는다** — 모델 턴 안에서 벤더가 찾고 결과를 붙여 온다.
    # 겨루기 때 재미나이·GPT 는 각자 제 검색을 이 자리에 끼운다.
    # 소넷 5 는 거르기가 붙은 20260209 판, 하이쿠 4.5 는 기본 20250305 판만 받는다.
    def web_search(self) -> dict:
        kind = "web_search_20250305" if "haiku" in self.model else "web_search_20260209"
        return {"type": kind, "name": "web_search", "max_uses": 5}

    def tools(self) -> list[dict]:
        ours = [{"name": t.name, "description": t.description, "input_schema": t.params}
                for t in visible()]
        return ours + [self.web_search()]

    async def turn(self, system, messages, on_text, finish: bool = False) -> Turn:
        # 지시문은 매 바퀴 같다. 캐시에 넣는다(§23). 10분의 1 값
        sys_blocks = [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]
        extra: dict = {"output_config": {"effort": self.effort}} if self.effort else {}
        async with self.client.messages.stream(
            model=self.model, max_tokens=settings.ai_max_tokens,
            system=sys_blocks, messages=messages,
            # 마무리 바퀴는 answer 만 준다. 도구를 또 부르면 영영 안 끝난다
            tools=[t for t in self.tools() if t.get("name") == "answer"] if finish else self.tools(),
            **extra,
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
        cr = getattr(u, "cache_read_input_tokens", 0) or 0
        return Turn(text, calls, raw, final.stop_reason or "end_turn",
                    (u.input_tokens or 0) + cr + (getattr(u, "cache_creation_input_tokens", 0) or 0),
                    u.output_tokens or 0, cr, web)

    def assistant_msg(self, turn: Turn) -> dict:
        return {"role": "assistant", "content": turn.raw}

    def tool_results_msg(self, results) -> dict:
        return {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": tid,
             "content": json.dumps(out, ensure_ascii=False, default=str)}
            for tid, out in results]}


def make_adapter(vendor: str = "anthropic", model: str | None = None,
                 effort: str | None = None) -> Adapter:
    """겨루기 때 여기에 재미나이·GPT 가 붙는다. 지금은 하나.
    model·effort 는 겨루기(qa/ai/bench)가 같은 고리를 다른 모델로 돌릴 때 준다. 화면은 설정값을 쓴다."""
    if vendor == "anthropic":
        return AnthropicAdapter(model, effort)
    raise ValueError(f"모르는 벤더 {vendor}")


# ── 고리 ────────────────────────────────────────────────────────────
def _one(o: Any, cap: int = 400) -> str:
    """도구에 보낸 것을 한 줄로. 경로만으론 모자란다 — /search 는 경로가 늘 같고 본문이 다르다."""
    if not isinstance(o, dict):
        return str(o)[:cap]
    bits = []
    for k in ("path", "query", "table", "name", "group", "building_pk", "region"):
        if o.get(k):
            bits.append(f"{k}={json.dumps(o[k], ensure_ascii=False)}" if not isinstance(o[k], str) else f"{k}={o[k]}")
    if o.get("body"):
        b = o["body"]
        bits.append(json.dumps(b.get("filters", b), ensure_ascii=False) if isinstance(b, dict) else str(b))
    if o.get("sql"):
        bits.append(" ".join(str(o["sql"]).split()))
    if o.get("props"):
        bits.append(json.dumps(o["props"], ensure_ascii=False))
    if o.get("text"):
        bits.append(str(o["text"]))
    return " ".join(bits)[:cap] or json.dumps(o, ensure_ascii=False)[:cap]


def _summ(out: Any) -> str:
    """화면에 보이는 도구 결과 한 줄. 모델이 아니라 사람이 본다."""
    if isinstance(out, dict):
        if "error" in out:
            return f"오류 · {out['error']}"[:TOOL_SUMMARY]
        bits = []
        if (n := out.get("돌아온 줄", out.get("count"))) is not None:
            bits.append(f"{n}줄")
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
        # **구운 결과는 알맹이를 앞으로 끌어낸다.** 그냥 JSON 앞 160자를 자르면
        # 「전체 0동」이 뒤에 묻혀 화면에서 안 보인다 — 모델이 0을 받고 99라 답한 판을
        # 사람이 눈치챌 수가 없었다(2026-09-09 대표). 사람이 보는 줄이니 사람이 볼 것을 앞에
        data = out.get("data")
        if isinstance(data, dict):
            for k in ("전체", "우리 팀", "건수", "줄", "매물", "매수자", "업체", "후보", "사진", "약속"):
                if k in data and not isinstance(data[k], (dict, list)):
                    bits.append(f"{k} {data[k]}")
            if out.get("id"):
                bits.append(str(out["id"]))
        return " · ".join(bits) or json.dumps(out, ensure_ascii=False)[:TOOL_SUMMARY]
    return str(out)[:TOOL_SUMMARY]


async def run(ctx: Ctx, system: str, history: list[dict], emit: Emit,
              vendor: str = "anthropic", model: str | None = None,
              effort: str | None = None) -> Result:
    """도구가 없을 때까지, 또는 되물음이 뜰 때까지 돈다."""
    load_all()
    adapter = make_adapter(vendor, model, effort)
    msgs = list(history)
    res = Result()
    log.info("■ %s", " ".join(str((history or [{}])[-1].get("content", ""))[:160].split()))
    drafts: list[dict] = []      # 도중에 그린 부품. 화면엔 떴지만 답에 남을지는 answer 가 정한다

    async def _emit(e: dict) -> None:
        r = emit(e)
        if r is not None:
            await r

    for _round in range(MAX_ROUNDS):
        async def on_text(s: str) -> None:
            # 답은 answer 도구로 온다(§8-1). 바퀴 사이 글은 「검색하겠습니다」 같은 혼잣말이라
            # 화면에 안 흘린다(2026-09-08 겨루기에서 하이쿠가 그걸 답에 실었다).
            # 기다리는 동안은 도구 줄이 흐른다
            return
        turn = await adapter.turn(system, msgs, on_text)
        res.tok_in += turn.tok_in
        res.tok_out += turn.tok_out
        res.cache_read += turn.cache_read
        # 벤더가 돌린 웹 검색은 모델 턴 안에서 이미 끝났다. 사후에 도구 줄로 내보내고 기록에 남긴다
        for w in turn.web:
            summ = f"결과 {w['n']}건"
            await _emit({"t": "tool", "phase": "start", "id": w["id"], "name": "web_search", "input": {"q": w["query"]}})
            await _emit({"t": "tool", "phase": "end", "id": w["id"], "name": "web_search", "ms": 0, "summary": summ})
            res.tool_log.append({"name": "web_search", "input": {"q": w["query"]}, "ms": 0, "summary": summ, "error": None})
        if not turn.tool_calls:
            # answer 없이 끝났다. 모델이 그냥 글로 답한 것 — 정규화해서 받는다
            if turn.text and not res.answered:
                # 여기서 import 를 한 번 더 하면 **파이썬이 normalize 를 이 함수의 지역 이름으로 본다.**
                # 그러면 이 줄에 닿기 전에 쓰는 326·334 줄이 UnboundLocalError 로 죽고,
                # 마무리 바퀴가 통째로 날아가 「자료를 다 모으지 못했습니다」가 나갔다(2026-09-09).
                # 파일 머리(41줄)에 이미 있다.
                t = normalize(turn.text)
                if t:
                    if drafts:
                        res.pieces.append(drafts[-1])
                    res.pieces.append({"t": "text", "v": t})
                    await _emit({"t": "text", "v": t})
                    res.answered = True
            if res.answered:
                res.stop = turn.stop
                return res
            # **부품만 그리고 입을 다문 경우.** 도구도 글도 없이 끝났다 —
            # 화면엔 표가 섰는데 답이 없다(2026-09-09 잣대 12번). 마무리 바퀴로 보낸다
            log.info("ai 도구도 글도 없이 끝났다 · 마무리 바퀴로")
            break

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

            ui = ask = ans = None
            if isinstance(out, dict):
                ui = out.pop("_ui", None)
                ask = out.pop("_ask", None)
                ans = out.pop("_answer", None)
            out = scrub_obj(out)                       # 나가는 문 ②

            res.tool_log.append({"name": tc.name, "input": tc.input, "ms": ms, "summary": _summ(out),
                                 "error": out.get("error") if isinstance(out, dict) else None})
            # **터미널로 한 바퀴를 그대로 본다**(2026-09-09 대표). 오류만 찍으니 「무엇을 물었길래
            # 이 답이 나왔나」를 볼 수가 없었다. docker logs -f docker-api-1 로 흐르게 둔다
            log.info("  %-14s %s", tc.name, _one(tc.input))
            log.info("  %-14s → %s", "", _summ(out))
            await _emit({"t": "tool", "phase": "end", "id": tc.id, "name": tc.name, "ms": ms,
                         "summary": _summ(out)})
            if ui:
                # **화면엔 바로 띄우되 대화엔 안 남긴다.** 답이 정해지기 전의 부품은
                # 「찾는 중」 표시다. 마지막에 answer 가 고른 것만 답에 남는다 —
                # 안 그러면 「스타벅스 99동」을 그려 놓고 답은 「5곳」이 된다(2026-09-09 대표)
                piece = {"t": "ui", **ui}
                drafts.append(piece)
                await _emit(piece)
            if ask:
                piece = {"t": "ask", **ask}
                res.pieces.append(piece)
                await _emit(piece)
                res.stop = "ask"
                return res                               # 답은 다음 사용자 말로 온다
            if isinstance(out, dict) and out.get("error") and tc.name == "answer":
                # answer 가 거절당하면 모델이 답을 고쳐 쓰며 바퀴를 태운다(#77 에서 다섯 번).
                # 한 번만 봐주고, 두 번째부터는 우리 잘못이니 글을 그대로 받는다
                res.answer_fail += 1
                if res.answer_fail >= 2:
                    t = (tc.input.get("text") or "").strip()
                    if t:
                        if drafts:
                            res.pieces.append(drafts[-1])
                        res.pieces.append({"t": "text", "v": t})
                        await _emit({"t": "text", "v": t})
                        res.answered = True
                        res.stop = "end_turn"
                        log.warning("ai answer 두 번 거절 · 원문으로 받는다 · %s", out.get("error"))
                        return res
            if ans:
                # 답이 고른 부품을 먼저, 글을 나중에. 한 번에 쓰였으니 어긋날 자리가 없다
                for want in (ans.get("show") or [])[:4]:
                    nm = want.get("name") if isinstance(want, dict) else None
                    if not nm:
                        continue
                    built = await REGISTRY["ui"].fn(ctx, name=nm,
                                                    props={k: v for k, v in want.items() if k != "name"},
                                                    title=want.get("title"))
                    if isinstance(built, dict) and built.get("_ui"):
                        res.pieces.append({"t": "ui", **built["_ui"]})
                    else:
                        log.info("ai answer.show 못 그림 · %s", (built or {}).get("error"))
                if not res.pieces and drafts:
                    # 부품을 안 골랐는데 도중에 그린 게 있으면 마지막 것만 남긴다 —
                    # 화면에 떴던 게 통째로 사라지면 사용자가 놓친 줄 안다
                    res.pieces.append(drafts[-1])
                piece = {"t": "text", "v": ans["text"], "confidence": ans["confidence"]}
                res.pieces.append(piece)
                log.info("✔ %s", " ".join(ans["text"][:300].split()))
                await _emit({"t": "text", **{k: v for k, v in piece.items() if k != "t"}})
                res.answered = True
                res.stop = "end_turn"
                return res                               # answer 가 마지막이다
            results.append((tc.id, out))
        msgs.append(adapter.tool_results_msg(results))

    # 바퀴를 다 썼다. 여기서 버리면 여덟 바퀴가 통째로 날아간다 — **한 번 더 주되 도구를 뺀다.**
    # 모델은 모은 것으로 answer 만 낼 수 있다(2026-09-09 겨루기 2번에서 자료를 다 모으고도 버렸다)
    msgs.append({"role": "user", "content": FINISH})
    try:
        turn = await adapter.turn(system, msgs, on_text, finish=True)
        res.tok_in += turn.tok_in
        res.tok_out += turn.tok_out
        res.cache_read += turn.cache_read
        for tc in turn.tool_calls:
            if tc.name == "answer":
                t = normalize((tc.input.get("text") or "").strip())
                if t:
                    # 마무리 바퀴도 같은 규칙 — 도중에 그린 것 중 마지막 하나만 남긴다
                    if drafts:
                        res.pieces.append(drafts[-1])
                    res.pieces.append({"t": "text", "v": t, "confidence": tc.input.get("confidence", "추정")})
                    await _emit({"t": "text", "v": t, "confidence": tc.input.get("confidence", "추정")})
                    res.answered = True
                    res.stop = "end_turn"
                    return res
        if turn.text:
            t = normalize(turn.text)
            if t:
                if drafts:
                    res.pieces.append(drafts[-1])
                res.pieces.append({"t": "text", "v": t})
                await _emit({"t": "text", "v": t})
                res.answered = True
                res.stop = "end_turn"
                return res
    except Exception as e:  # noqa: BLE001
        log.warning("ai 마무리 바퀴 실패: %s", e)
    res.stop = "max_rounds"
    res.pieces.append({"t": "text", "v": "자료를 다 모으지 못했습니다. 질문을 좁혀 주시면 다시 찾아보겠습니다."})
    return res


def as_code(e: Exception) -> str:
    return ai.as_code(e)
