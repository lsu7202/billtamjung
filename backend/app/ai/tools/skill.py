"""skill — 긴 지시문은 필요할 때만 읽는다. 정본 §10

지시문에는 이름 목록만 싣고(스무 토큰), 모델이 뜻을 알아채면 `skill("SQL예제")` 로 그때 읽는다.
「성수동 실거래 알려줘」 한 마디에 문서 만드는 법 열두 장이 딸려 갈 이유가 없다(§10-2).

**스킬은 능력만 준다. 차례는 주지 않는다**(대표 2026-09-09). 내용은 대화에서 나온다.

파일은 `ai/skills/*.md` 다. 결이 바뀌어도 코드를 안 고친다.
"""
from __future__ import annotations

from pathlib import Path

from . import Ctx, tool

DIR = Path(__file__).resolve().parent.parent / "skills"


def names() -> list[str]:
    return sorted(p.stem for p in DIR.glob("*.md")) if DIR.exists() else []


def brief() -> str:
    """지시문에 싣는 한 줄. 이름만."""
    ns = names()
    return ("## 스킬\n필요할 때 skill(이름)으로 읽는다: " + " · ".join(ns)) if ns else ""


@tool("skill",
      "긴 지시문을 읽는다. SQL예제(우리 표를 SQL 로 짜는 법 · 인덱스 · 단위) 등. 이름 없이 부르면 목록.",
      {"type": "object",
       "properties": {"name": {"type": "string"}},
       "required": []})
async def skill(ctx: Ctx, *, name: str | None = None) -> dict:
    ns = names()
    if not name:
        return {"skills": ns}
    p = DIR / f"{name}.md"
    if not p.exists():
        return {"error": f"{name} 은 없다. 있는 것: {', '.join(ns) or '없음'}"}
    return {"name": name, "text": p.read_text(encoding="utf-8")}
