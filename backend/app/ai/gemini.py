"""제미나이 고리. `agent.py` 가 정한 조각만 낸다.

## 스키마는 안 고친다

`FunctionDeclaration(parameters_json_schema=…)` 가 **날 JSON 스키마**를 받는다. 그래서
`tools.py` 가 만든 것을 그대로 넣는다. Pydantic 이 내는 `anyOf: [{…},{type:null}]` 를 펼
필요도 없다. 두 벤더가 **같은 스키마**를 봐야, 답이 갈리면 모델이 갈린 것이라고 말할 수 있다.

## 고리를 직접 짠다

SDK 에 자동 고리(AFC)가 있지만 쓰지 않는다. 다음 메이저 판에서 `generate_content` 로는
못 쓰게 되고 `Chats` 로 옮긴다고 예고돼 있다 — 바깥 사정에 고리를 매지 않는다. 바퀴를
직접 돌면 도구가 돌 때마다 제자리에서 알릴 수 있기도 하다(앤트로픽 쪽은 바퀴 끝에야 안다).

AFC 를 **끄는 설정도 안 준다.** 우리가 넘기는 것은 파이썬 함수가 아니라 선언
(`FunctionDeclaration`)이라 애초에 SDK 가 제 손으로 부를 수 없다. 껐다고 적어 두면
SDK 가 「AFC 를 직접 쓰지 말라」는 경고를 호출마다 로그에 찍는다.

## 첫 바퀴는 도구를 강제한다

`mode=ANY` 는 「함수 호출만 하도록」 묶는다. 모델이 우리 DB 를 안 보고 답하는 자리를
이걸로 막는다. **첫 바퀴에만** 건다 — 계속 걸면 답을 영영 못 쓴다.
`BT_AI_FORCE_FIRST_TOOL=false` 로 끈다.

**한 번 뺐다가 되돌렸다(2026-09-21).** `toolConfig` 가 캐시 앞머리에 드는 칸이라
(`CachedContent` 가 캐시하는 넷: contents·tools·toolConfig·systemInstruction), 첫 바퀴만
ANY 면 호출마다 앞머리가 갈려 implicit 캐싱이 안 붙을 것으로 봤다. 그래서 AUTO 로 맞췄는데
실측해 보니 **앞머리가 글자까지 같아도 implicit 은 안 붙는다**(같은 요청 3연속, 캐시 0).
문서가 "no cost saving guarantee" 라고 적어 둔 그대로다. 얻는 것 없이 강제만 잃어
「강남구에 신축하기 좋은 곳」에 도구를 한 번도 안 부르고 조건을 되물었다.
explicit 캐싱은 스키마를 **아예 안 보내는** 방식이라 mode 가 갈려도 상관없다.

## 마지막 바퀴는 도구를 끈다

`ai_max_turns` 에 닿으면 `mode=NONE` 으로 한 바퀴 더 돈다. 그냥 끊으면 도구만 열두 번
돌고 **답이 없다.**
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from collections.abc import AsyncIterator
from typing import Any

from google import genai
from google.genai import errors, types

from ..core.config import settings
from . import agent as A

log = logging.getLogger("app.ai")


def api_key() -> str:
    return settings.gemini_api_key


def model_name() -> str:
    return settings.gemini_model


_client: genai.Client | None = None


def client() -> genai.Client:
    """벤더가 여기 말고 어디에도 안 나온다. 키는 서버에만 있고 프론트로 절대 안 간다."""
    global _client
    if _client is None:
        _client = genai.Client(api_key=api_key())
    return _client


def _tools(specs: list[dict]) -> list[types.Tool]:
    return [types.Tool(function_declarations=[
        types.FunctionDeclaration(name=s["name"], description=s["description"],
                                  parameters_json_schema=s["input_schema"])
        for s in specs])]


# ── 도구 스키마 캐시 ────────────────────────────────────────────────────────
# 스키마 19,799자(8,329토큰)를 **호출마다** 실어 보내고 있었다. 한 물음에 모델을 일곱 번
# 부르면 58,387토큰, 입력의 51% 다(2026-09-21 실측). implicit 캐싱은 켜져 있지만 일곱 번
# 중 한 번만 붙었다 — 문서가 "no cost saving guarantee" 라고 못 박은 그대로다.
#
# explicit 캐시는 스키마를 **아예 안 보낸다.** 구글이 들고 있고 우리는 이름만 가리킨다.
# 실측으로 in 8,341 중 8,329 가 캐시로 붙는다(99.9%).
#
# **모드마다 캐시가 따로다.** `cached_content` 를 쓰면 요청에 `tools`·`tool_config` 를
# 같이 못 준다(400: "CachedContent can not be used with GenerateContent request setting
# system_instruction, tools"). `tool_config` 가 캐시 안에 박히므로 ANY·AUTO·NONE 세 벌을
# 만든다. 같은 8,329토큰이 세 벌이지만 10분 보관료가 셋 합쳐 $0.002 다.
#
# 스키마가 바뀌면(배포·ref.enums·area_event.kind) 지문이 달라져 새로 만든다. 캐시 내용은
# immutable 이라 고칠 수 없다.
_CACHE_TTL = 600                      # 초. 물음 하나가 1분이라 넉넉하고, 보관료가 싸진다
_caches: dict[tuple[str, str], tuple[str, float]] = {}    # (지문, 모드) → (이름, 만료시각)
_cache_lock = asyncio.Lock()


def _fingerprint(specs: list[dict]) -> str:
    return hashlib.sha256(
        json.dumps(specs, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16]


async def _cache_for(specs: list[dict], tools: list[types.Tool], mode: str) -> str | None:
    """이 모드의 캐시 이름. 못 만들면 `None` 을 내고 부르는 쪽이 스키마를 실어 보낸다 —
    **값을 아끼려다 답을 못 내면 안 된다.**"""
    key = (_fingerprint(specs), mode)
    now = time.monotonic()
    if (got := _caches.get(key)) and got[1] > now + 30:
        return got[0]
    async with _cache_lock:
        if (got := _caches.get(key)) and got[1] > time.monotonic() + 30:
            return got[0]                       # 기다리는 동안 남이 만들었다
        try:
            c = await client().aio.caches.create(
                model=model_name(),
                config=types.CreateCachedContentConfig(
                    tools=tools,
                    tool_config=types.ToolConfig(
                        function_calling_config=types.FunctionCallingConfig(mode=mode)),
                    ttl=f"{_CACHE_TTL}s", display_name=f"bt-{key[0]}-{mode}"))
        except Exception as e:                  # noqa: BLE001
            log.warning("도구 캐시를 못 만들었다(%s): %s — 스키마를 그대로 보낸다", mode, e)
            return None
        n = c.usage_metadata.total_token_count if c.usage_metadata else 0
        log.info("도구 캐시 만듦 [%s] %s토큰 · %d초", mode, f"{n:,}", _CACHE_TTL)
        _caches[key] = (c.name, time.monotonic() + _CACHE_TTL)
        return c.name


def _contents(msgs: list[dict]) -> list[types.Content]:
    return [types.Content(role="model" if m["role"] == "assistant" else "user",
                          parts=[types.Part(text=m["content"])])
            for m in msgs]


def _answer(text: str) -> Any:
    """도구가 낸 JSON 문자열을 되돌린다. 제미나이의 function_response 는 dict 를 받는다 —
    문자열째 싸서 보내면 클로드가 본 것과 한 겹 달라진다."""
    try:
        v = json.loads(text)
    except ValueError:
        return {"result": text}
    return v if isinstance(v, dict) else {"result": v}


async def run(specs: list[dict], msgs: list[dict], ex: A.Exec) -> AsyncIterator[dict]:
    contents = _contents(msgs)
    tools = _tools(specs)

    def cfg(mode: str, cache: str | None) -> types.GenerateContentConfig:
        # 캐시를 쓰면 `tools`·`tool_config` 를 **같이 못 준다.** 캐시 안에 들어 있다.
        if cache:
            return types.GenerateContentConfig(
                cached_content=cache, max_output_tokens=settings.ai_max_tokens)
        return types.GenerateContentConfig(
            tools=tools,
            tool_config=types.ToolConfig(
                function_calling_config=types.FunctionCallingConfig(mode=mode)),
            max_output_tokens=settings.ai_max_tokens,
        )

    async def once(mode: str):
        """한 바퀴. 낸 조각과 이번에 부른 도구를 돌려준다."""
        cache = await _cache_for(specs, tools, mode)
        try:
            r = await client().aio.models.generate_content(
                model=model_name(), contents=contents, config=cfg(mode, cache))
        except errors.ClientError as e:
            # 캐시가 만료·삭제됐을 수 있다(TTL 안이라도 구글이 지울 수 있다). 지문을 버리고
            # **스키마를 실어** 한 번 더 간다 — 값 때문에 답을 못 내면 안 된다.
            if not cache:
                raise
            log.warning("캐시로 부르다 실패(%s) — 스키마를 실어 다시 간다: %s", mode, str(e)[:160])
            _caches.pop((_fingerprint(specs), mode), None)
            r = await client().aio.models.generate_content(
                model=model_name(), contents=contents, config=cfg(mode, None))
        out: list[dict] = []
        if u := r.usage_metadata:
            # 캐시 적중을 **남긴다.** 제미나이 2.5 이상은 implicit 캐싱이 기본 켜짐인데
            # 우리가 그 칸을 안 봐서 붙는지조차 몰랐다(2026-09-21). 이게 0으로만 나오면
            # explicit 캐싱을 붙일지 정할 수 있고, 붙고 있으면 안 만들면 된다.
            # tool_use_prompt 는 도구 선언이 먹는 몫 — 스키마 무게를 벤더가 직접 말해 준다.
            out.append({"t": "usage", "in": u.prompt_token_count or 0,
                        "out": (u.candidates_token_count or 0) + (u.thoughts_token_count or 0),
                        "cached": u.cached_content_token_count or 0,
                        "tools": u.tool_use_prompt_token_count or 0})
        if not r.candidates:
            # 안전 차단 등으로 후보가 없다. **조용히 끝내지 않는다** — 빈 답은 버그로 읽힌다.
            raise A.AiUnavailable(A.UPSTREAM_DOWN, f"후보가 없다: {r.prompt_feedback}")
        cand = r.candidates[0]
        contents.append(cand.content)
        for p in (cand.content.parts if cand.content else None) or []:
            if p.text and p.text.strip() and not p.thought:
                out.append({"t": "text", "v": p.text})
        return out, (r.function_calls or [])

    try:
        for turn in range(settings.ai_max_turns):
            mode = "ANY" if turn == 0 and settings.ai_force_first_tool else "AUTO"
            pieces, calls = await once(mode)
            for x in pieces:
                yield x
            if not calls:
                return

            results: list[types.Part] = []
            for fc in calls:
                text = await ex(fc.name or "", dict(fc.args or {}))
                results.append(types.Part.from_function_response(
                    name=fc.name or "", response=_answer(text)))
            contents.append(types.Content(role="user", parts=results))
            for rec in ex.drain():
                yield {"t": "tool", **rec}
            if ex.asked:          # 되물었다. 답은 사용자에게서 오니 더 돌 이유가 없다
                return

        # 상한에 닿았다. **여기서 그냥 끊으면 답이 없다** — 사용자는 도구가 열두 번 도는 것을
        # 보고 빈 화면을 받는다(2026-09-19 실측). 도구를 끄고 한 바퀴 더 돌려, 모아 둔 것으로
        # 답을 쓰게 한다. mode=NONE 은 선언이 아예 없는 것처럼 굴어 도구를 더 못 부른다.
        A.log.warning("도구 바퀴 상한 %s · 도구를 끄고 답만 받는다", settings.ai_max_turns)
        pieces, _ = await once("NONE")
        for x in pieces:
            yield x
    except errors.ClientError as e:
        raise A.AiUnavailable(A.TOO_LONG if e.code == 413 else A.UPSTREAM_DOWN,
                              str(e)[:300]) from e
    except errors.APIError as e:
        raise A.AiUnavailable(A.UPSTREAM_DOWN, str(e)[:300]) from e
