"""도구 등록부 — 모델이 부를 수 있는 우리 함수 목록. 정본 10-AI-어시스턴트 §9

## 벤더와 무관하다

도구는 그냥 파이썬 함수다. 클로드든 재미나이든 GPT 든 같은 함수를 부른다.
벤더마다 다른 건 **도구 목록을 어떤 모양으로 보여주느냐**뿐이고, 그건 `loop.py` 의
어댑터가 한다. 이 파일은 벤더 이름을 모른다.

## 등록

    @tool("query", "읽기 전용 SQL 을 돌린다", {"type":"object", "properties": {...}, "required":[...]})
    async def query(ctx: Ctx, *, sql: str, purpose: str) -> dict: ...

## 반환 규약 (§9-8 · §23-1)

    실패    빈 값을 준다. 지어낼 재료를 안 준다.  {"rows": [], "count": 0}
    상한    줄이 많으면 전부 안 준다. 개수 + 앞 몇 줄 + result_id.
    출처    "source" 를 붙인다.
    부품    화면이 그릴 것이 있으면 "_ui": {"name": …, "props": …} 를 딸려 낸다.
            loop 가 떼어서 화면에 보내고 모델에겐 안 보인다.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable


@dataclass
class Ctx:
    """도구가 받는 문맥. **사용자 권한을 빌린다** — 새 권한을 만들지 않는다(§9-4)."""
    account_id: int
    team_id: int
    chat_id: int
    token: str                       # 로그인한 사용자의 access 토큰. call_api 가 그대로 쓴다
    scrub_hits: list[str] = field(default_factory=list)   # 도구 결과에서 가린 갈래. 화면이 말한다


@dataclass
class Tool:
    name: str
    description: str
    params: dict[str, Any]           # JSON 스키마
    fn: Callable[..., Awaitable[Any]]


REGISTRY: dict[str, Tool] = {}


def tool(name: str, description: str, params: dict[str, Any]):
    """등록. 같은 이름을 두 번 등록하면 죽는다 — 조용히 덮어쓰면 어느 것이 도는지 모른다."""
    def _wrap(fn: Callable[..., Awaitable[Any]]):
        if name in REGISTRY:
            raise RuntimeError(f"도구 이름이 겹친다: {name}")
        REGISTRY[name] = Tool(name, description, params, fn)
        return fn
    return _wrap


def load_all() -> dict[str, Tool]:
    """도구 모듈을 전부 불러 등록시킨다. loop 가 처음 돌 때 한 번."""
    from . import query  # noqa: F401
    try:
        from . import api  # noqa: F401
    except ImportError:
        pass
    try:
        from . import ask  # noqa: F401
    except ImportError:
        pass
    return REGISTRY


def brief() -> str:
    """지시문에 싣는 한 줄 요약 목록. 스키마는 어댑터가 따로 준다(§10-2 예산)."""
    return "\n".join(f"- {t.name}: {t.description}" for t in REGISTRY.values())
