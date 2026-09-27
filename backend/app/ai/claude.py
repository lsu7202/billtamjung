"""앤트로픽 고리. `agent.py` 가 정한 조각만 낸다.

## 고리를 직접 안 짠다

설치된 `anthropic` 의 `beta_async_tool` 이 **런타임 JSON 스키마**를 받으므로
(`input_schema=<dict>`), `tools.py` 가 만든 스키마를 그대로 넣고 `tool_runner` 에 맡긴다.
함수 서명에서 스키마를 뽑는 데코레이터 용법은 우리에게 안 맞는다 — 우리 스키마는
`ref.enums` 와 `Filters` 에서 요청 때 만들어진다.

러너가 도구 함수를 제 손으로 부르므로, 도구가 몇 번 돌았는지는 한 바퀴가 끝난 뒤에야
안다. 그래서 `Exec.drain()` 을 바퀴마다 부어 낸다.
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import anthropic
from anthropic import beta_async_tool

from ..core.config import settings
from . import agent as A


def api_key() -> str:
    return settings.anthropic_api_key


def model_name() -> str:
    return settings.ai_model


_client: anthropic.AsyncAnthropic | None = None


def client() -> anthropic.AsyncAnthropic:
    """벤더가 여기 말고 어디에도 안 나온다. 키는 서버에만 있고 프론트로 절대 안 간다."""
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=api_key())
    return _client


def _wrap(spec: dict, ex: A.Exec):
    """도구 하나를 러너가 쓸 수 있는 꼴로 싼다. 스키마는 요청 때 만들어진 것을 그대로 쓴다."""
    name = spec["name"]

    async def run(**kwargs: Any) -> str:
        return await ex(name, kwargs)

    run.__name__ = name
    return beta_async_tool(run, name=name, description=spec["description"],
                           input_schema=spec["input_schema"])


def _messages(msgs: list[dict]) -> list[dict]:
    """이력 → 클로드 messages. 답에 refs 가 있으면(최근 3턴, §23-4) 답 글 앞에
    tool_use(assistant) → tool_result(user) 를 재현한다."""
    out: list[dict] = []
    for n, m in enumerate(msgs):
        refs = m.get("refs") if m["role"] == "assistant" else None
        if refs:
            ids = [f"ref{n}_{k}" for k in range(len(refs))]
            out.append({"role": "assistant", "content": [
                {"type": "tool_use", "id": i, "name": r["도구"], "input": r.get("입력") or {}}
                for i, r in zip(ids, refs, strict=True)]})
            out.append({"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": i, "content": A.dumps(r.get("결과") or {})}
                for i, r in zip(ids, refs, strict=True)]})
        if m.get("content"):
            out.append({"role": m["role"], "content": m["content"]})
    return out


async def run(specs: list[dict], msgs: list[dict], ex: A.Exec) -> AsyncIterator[dict]:
    kw: dict[str, Any] = {}
    if settings.ai_effort:                       # **Haiku 4.5 는 effort 를 안 받는다**(보내면 400)
        kw["output_config"] = {"effort": settings.ai_effort}

    try:
        runner = client().beta.messages.tool_runner(
            model=model_name(),
            max_tokens=settings.ai_max_tokens,
            tools=[_wrap(s, ex) for s in specs],
            messages=_messages(msgs),
            **kw,
        )
        turns = 0
        async for message in runner:
            turns += 1
            # 캐시 적중을 남긴다. 아직 cache_control 을 안 붙였으니 지금은 늘 0이다 —
            # 붙였을 때 실제로 먹는지 보려면 재는 자리가 먼저 있어야 한다.
            yield {"t": "usage", "in": message.usage.input_tokens,
                   "out": message.usage.output_tokens,
                   "cached": getattr(message.usage, "cache_read_input_tokens", 0) or 0,
                   "wrote": getattr(message.usage, "cache_creation_input_tokens", 0) or 0}
            for b in message.content:
                if b.type == "text" and b.text.strip():
                    yield {"t": "text", "v": b.text}
            for rec in ex.drain():               # 이번 바퀴에 돈 도구를 그대로 알린다
                yield {"t": "tool", **rec}
            if ex.asked:                         # 되물었으면 답을 기다린다
                return
            if turns >= settings.ai_max_turns:
                # **여기서 끊으면 답이 없다.** 제미나이 쪽은 도구를 끄고 한 바퀴 더 돌려
                # 답을 받게 해 뒀는데(gemini.run 끝), tool_runner 로 같은 걸 하려면 러너
                # 바깥에서 대화를 이어받아야 한다. 잔액이 없어 시험을 못 해 안 짰다 —
                # **여기는 아직 구멍이다.** 클로드를 다시 쓸 때 먼저 메울 것.
                A.log.warning("도구 바퀴 상한 %s 에서 끊음 — 답이 없을 수 있다", settings.ai_max_turns)
                break
    except anthropic.APIStatusError as e:
        raise A.AiUnavailable(A.TOO_LONG if e.status_code == 413 else A.UPSTREAM_DOWN,
                              str(e)[:300]) from e
    except anthropic.APIConnectionError as e:
        raise A.AiUnavailable(A.UPSTREAM_DOWN, str(e)[:300]) from e
