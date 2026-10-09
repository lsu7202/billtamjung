"""고리 — 모델을 부르고 도구를 돌린다(2026-09-18 · 벤더 둘 2026-09-19).

## 한 물음이 도는 모양

    사용자 말 → scrub → 모델 → (도구 호출 → 우리 핸들러 → scrub → 되먹임)* → 답

도구가 하는 일은 셋뿐이다. 같은 프로세스에서 우리 핸들러를 부르고, 결과를 나가는 문에
통과시키고, 돌려준다. HTTP 로 자기 자신을 다시 부르지 않는다 — 화면이 보는 것과
**같은 함수**라야 답이 갈라지지 않는다.

## 벤더 둘

`BT_AI_VENDOR` 로 고른다(`claude`·`gemini`). 여기 있는 것은 **둘이 같은 자리**다:
무엇을 내보내고(`scrub`), 도구를 어떻게 돌리고(`Exec`), 무엇을 흘리는지(조각 모양).
벤더마다 다른 것(클라이언트·도구 선언·고리·오류 갈래)은 `claude.py`·`gemini.py` 에 있다.

두 벤더가 **같은 조각**을 내야 화면도 라우트도 벤더를 모른다. 스키마는 어느 쪽이든
`tools.py` 가 만든 것 하나다 — 벤더마다 다른 스키마를 만들면 실험이 실험이 아니게 된다.

## 여기서 안 하는 것

**도구 결과를 고쳐 쓰지 않는다.** 결과는 온 그대로 간다. 가리는 것은 개인정보뿐이고,
가렸으면 가렸다고 말한다.

스키마도 안 만든다(`tools.py`). HTTP 도 모른다(`domains/ai.py`).

## 지시문

지금은 없다. 도구 설명만 주고 시작한다. 필요해지면 그때 무엇을 넣을지 정하고 붙인다.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import time
from decimal import Decimal
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from ..core.config import settings
from ..core.deps import CurrentUser
from . import tools as toolbox
from .scrub import scrub, scrub_obj

log = logging.getLogger("app.ai")

# 모델 쪽 사정으로 못 답할 때의 코드. 문구는 여기서 짓지 않는다 — ref.error_msg 의 열쇠다.
NOT_CONFIGURED = "AI_NOT_CONFIGURED"
UPSTREAM_DOWN = "AI_UPSTREAM_DOWN"
TOO_LONG = "AI_TOO_LONG"

VENDORS = ("claude", "gemini")


def _jsonable(o: Any) -> Any:
    """`default=str` 만 쓰면 asyncpg 의 NUMERIC(`Decimal`)이 **문자열**로 나간다.
    화면 라우트는 FastAPI 인코더를 타 숫자로 나가므로, curl 로 본 것과 모델이 받는 것이
    갈렸다(2026-09-19: 라우트 `262.1` / 모델 `"262.1"`). 같은 함수를 부르는데 답이 갈리면
    라우트를 둔 뜻이 없다. 날짜는 그대로 문자열이다."""
    if isinstance(o, Decimal):
        return int(o) if o == o.to_integral_value() else float(o)
    if isinstance(o, (dt.date, dt.datetime)):
        return o.isoformat()
    return str(o)


def dumps(o: Any) -> str:
    return json.dumps(o, ensure_ascii=False, default=_jsonable)


class AiUnavailable(Exception):
    def __init__(self, code: str, detail: str | None = None):
        super().__init__(code)
        self.code = code
        self.detail = detail


def vendor() -> str:
    v = (settings.ai_vendor or "claude").strip().lower()
    return v if v in VENDORS else "claude"


def _mod():
    """벤더 모듈은 **부를 때** 들여온다. 안 쓰는 쪽 SDK 가 없어도 서버가 뜬다."""
    if vendor() == "gemini":
        from . import gemini as m
    else:
        from . import claude as m
    return m


def configured() -> bool:
    return bool(_mod().api_key())


def model_name() -> str:
    return _mod().model_name()


REF_CAP = 45       # 검색 한 번에 다시 넘길 건물 수(목록 + 나머지). §23-4


def reduce_result(name: str, out: Any) -> dict | None:
    """다음 턴에 다시 넘길 **줄인 결과**(§23-4). 통째로 넘기면 검색 한 번이 2천~9천 토큰이라 턴마다 쌓인다.
    숫자·물음을 낸 도구(invest·develop·ask)는 없다 — 그건 답 글에 이미 있다."""
    if not isinstance(out, dict):
        return None
    if name == "buildings":
        rows = []
        for g in out.get("검색") or []:
            if not isinstance(g, dict):
                continue
            # 한 건물은 한 줄 — 출처로 가르지 않는다(0224)
            items: list[dict] = g.get("목록") or []
            total = g.get("전체") or 0
            # 다음 턴엔 **주소**로 다시 가리킨다 — 건물번호는 모델이 모른다(11b · 10-04)
            bld = [{"순서": i + 1, "주소": x["주소"]}
                   for i, x in enumerate(x for x in items if isinstance(x, dict) and x.get("주소"))]
            rows.append({"건물": bld[:REF_CAP], "전체": total})
        return {"검색": rows} if rows else None
    if name == "customers":
        got = [{"이름": c.get("이름"), "등록일": c.get("등록일")}
               for c in (out.get("고객") or {}).get("목록") or [] if isinstance(c, dict)]
        return {"고객": got} if got else None
    if name in ("make", "fix"):
        got = {k: out[k] for k in ("자료번호", "제목") if k in out}
        return got or None
    return None


def ref_input(name: str, args: dict) -> dict:
    """다시 넘길 도구 입력 — 자료 본문(html)은 크고 결과에 번호가 있으니 뺀다."""
    return {k: v for k, v in args.items() if not (name in ("make", "fix") and k == "html")}


@dataclass
class Exec:
    """도구 하나를 돌리고 나가는 문에 통과시키고 장부에 적는다. **벤더가 안 바뀌는 자리다** —
    클로드로 본 것과 제미나이로 본 것이 갈리면 무엇이 달라서인지 알 수 없게 된다."""

    user: CurrentUser
    calls: list[dict] = field(default_factory=list)
    _told: int = 0
    # 되물었나. `ask` 도구는 **값이 사용자에게서 온다** — 돌려줄 게 없으니 바퀴를 끊는다.
    # 벤더 고리가 이걸 보고 멈추고, `ask()` 가 끝에서 조각으로 낸다(2026-09-25).
    asked: list[dict] | None = None
    # 다음 턴에 다시 넘길 「입력 + 줄인 결과」(§23-4). 답과 함께 ai_message.refs 에 저장된다
    refs: list[dict] = field(default_factory=list)

    async def __call__(self, name: str, kwargs: dict[str, Any]) -> str:
        t0 = time.monotonic()
        hits: list[str] = []
        tool = next((t for t in toolbox.tools_for(self.user) if t.name == name), None)   # 모드 목록 안에서만
        try:
            if tool is None:
                raise ValueError(f"그런 도구는 없다: {name}")
            tok = toolbox._PINS.set([])                 # 화면 지도용 핀을 받을 자리
            ptok = toolbox._PANEL.set({})              # 오른쪽 판 열기 신호(0235) — 도구가 「보여 준다」고 정했을 때만
            try:
                raw = await tool.run(kwargs, self.user)
            finally:
                pins = toolbox._PINS.get() or []
                panel = toolbox._PANEL.get() or None
                toolbox._PINS.reset(tok)
                toolbox._PANEL.reset(ptok)
            if isinstance(raw, dict) and "__ask__" in raw:
                self.asked = raw["__ask__"]
                raw = {"물었다": "답을 기다린다. 이 바퀴는 여기서 끝난다"}
            out = scrub_obj(raw, hits)                 # 나가는 문 ② — 도구가 퍼 온 값
            text = dumps(out)
            red = reduce_result(name, out)            # 가린 뒤의 값에서 줄인다 — 저장되는 것도 가린 것
            if red:
                self.refs.append({"도구": name, "입력": ref_input(name, kwargs), "결과": red})
        except Exception as e:                          # noqa: BLE001
            # 죽지 않고 모델에게 사실대로 말한다. 오류도 문맥이라 다음 바퀴에 고칠 수 있다.
            log.warning("도구 %s 실패: %s", name, e)
            text = dumps({"error": str(e)[:600]})
            pins = []
            panel = None
        rec = {
            "name": name,
            "input": kwargs,
            "ms": int((time.monotonic() - t0) * 1000),
            "scrubbed": sorted(set(hits)) or None,
            "bytes": len(text),
            # 화면 지도용. 모델에게 가는 `text` 엔 없다 — 이 기록을 라우트가 SSE 로 흘린다
            "pins": pins or None,
            "panel": panel or None,      # 오른쪽 판 열기(0235). 모델에게 가는 `text` 엔 없다
        }
        self.calls.append(rec)
        # 백엔드 로그에 그대로 남긴다. 요청과 **응답을 따로 한 줄씩** — 한 줄에 몰면 응답이
        # 잘려 무엇이 돌아왔는지 안 보인다. 길이는 BT_AI_LOG_CHARS 로 정한다(0이면 응답 생략).
        log.info("도구 %s %dms %d자", name, rec["ms"], rec["bytes"])
        log.info("  ← %s", dumps(kwargs))
        if settings.ai_log_chars:
            cut = text[:settings.ai_log_chars]
            log.info("  → %s%s", cut, " …" if len(text) > len(cut) else "")
        return text

    def drain(self) -> list[dict]:
        """아직 안 알린 것만. 벤더 고리가 한 바퀴 끝날 때마다 부른다."""
        out = self.calls[self._told:]
        self._told = len(self.calls)
        return out


async def ask(text: str, user: CurrentUser, history: list[dict] | None = None,
              template: str | None = None) -> AsyncIterator[dict]:
    """한 물음을 끝까지 돌리며 일어난 일을 그대로 흘린다.

    내는 조각: `{t:"scrubbed"}` · `{t:"tool"}` · `{t:"text"}` · `{t:"done"}`.
    화면이 무엇을 그릴지는 화면이 정한다 — 여기서 부품을 만들지 않는다."""
    m = _mod()
    if not m.api_key():
        raise AiUnavailable(NOT_CONFIGURED)

    said = scrub(text)                                  # 나가는 문 ① — 사용자 말
    log.info("물음 [%s/%s] %s", vendor(), m.model_name(), said.text[:200])
    if said.hits:
        yield {"t": "scrubbed", "kinds": sorted(set(said.hits))}

    # 자료 템플릿(0235) — **사용자가 고른 요청에만** make 설명이 그 템플릿의 규격이 된다. 이 말 한 번뿐이다
    from ..render import templates as tpl
    chosen = tpl.get(template)
    built = await toolbox.build(user, chosen["key"] if chosen else None)
    ttok = toolbox._TEMPLATE.set(chosen["key"] if chosen else None)
    ex = Exec(user)
    note = f"\n\n(사용자가 자료 템플릿 「{chosen['name']}」을 골랐다 — make 로 이 템플릿의 자료를 만든다)" if chosen else ""
    msgs = list(history or []) + [{"role": "user", "content": said.text + note}]

    tok_in = tok_out = tok_cached = tok_tools = 0
    calls_n = 0
    answer: list[str] = []
    try:
        async for piece in m.run(built["tools"], msgs, ex):
            if piece["t"] == "usage":
                tok_in += piece["in"]; tok_out += piece["out"]
                tok_cached += piece.get("cached") or 0
                tok_tools += piece.get("tools") or piece.get("wrote") or 0
                calls_n += 1
                # 호출마다 한 줄. 캐시가 붙는지는 **바퀴별로** 봐야 안다 — 첫 바퀴는
                # 원래 0이고 둘째부터 붙는 게 정상이라, 합계만 보면 구분이 안 된다.
                log.info("  호출%d in %s (캐시 %s · 도구 %s) out %s", calls_n,
                         f"{piece['in']:,}", f"{piece.get('cached') or 0:,}",
                         f"{piece.get('tools') or piece.get('wrote') or 0:,}",
                         f"{piece['out']:,}")
                continue
            if piece["t"] == "text":
                answer.append(piece["v"])
            yield piece
    except AiUnavailable:
        raise
    except Exception as e:                              # noqa: BLE001
        # 벤더 SDK 가 제 갈래로 안 싸서 내는 것들(열쇠가 ASCII 가 아니면 httpx 가 먼저 터진다).
        # 500 으로 새면 화면이 「알 수 없는 오류」를 그린다 — 같은 코드로 모은다.
        log.warning("벤더 %s 에서 못 싼 오류: %s: %s", vendor(), type(e).__name__, e)
        raise AiUnavailable(UPSTREAM_DOWN, f"{type(e).__name__}: {e}"[:300]) from e

    if ex.asked:
        yield {"t": "ask", "물음": ex.asked}
    log.info("끝 [%s] 호출 %d번 · 도구 %d번 · in %s (캐시 %s = %d%%) · out %s · 물음=%s",
             vendor(), calls_n, len(ex.calls), f"{tok_in:,}", f"{tok_cached:,}",
             100 * tok_cached // max(1, tok_in), f"{tok_out:,}", said.text[:80])
    yield {"t": "done", "tok_in": tok_in, "tok_out": tok_out,
           "tok_cached": tok_cached, "tok_tools": tok_tools, "calls": calls_n,
           "tools": len(ex.calls), "text": "".join(answer), "vendor": vendor(), "refs": ex.refs or None,
           "model": m.model_name()}
