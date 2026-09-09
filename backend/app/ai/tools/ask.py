"""되묻기 — 고를 것이 실제로 있을 때만. 정본 10-AI-어시스턴트 §9-6

자연어가 기본이면 애매함이 늘고, 되묻는 것이 유일하게 정직한 길이다.
찍고 넘어가면 엉뚱한 건물로 문서가 만들어진다.

**두 종류 중 하나만 금지한다.**
    빈 되물음    「어떤 게 필요하세요?」          정보가 없다. 금지. 지시문이 막는다
    구체적 되물음 「성수동1가인가요 2가인가요?」   답이 갈린다. 이 도구다

고리(loop.py)가 `_ask` 를 보면 **멈추고** 화면에 칩을 띄운다. 사용자가 고르면
그 글자가 다음 사용자 말로 들어와 대화가 이어진다. 답을 기다리는 상태를 서버가 안 든다.
"""
from __future__ import annotations

from . import Ctx, tool

MAX_OPTIONS = 6


@tool("ask",
      "답이 갈리는 자리에서 사용자에게 되묻는다. 선택지가 칩으로 뜬다. "
      "건물 후보가 여럿일 때, 범위·형식을 정해야 할 때 쓴다. 고를 것이 실제로 여럿일 때 쓴다 — 후보 건물, 갈림길이 되는 조건.",
      {"type": "object",
       "properties": {
           "question": {"type": "string", "description": "한 문장. 존댓말"},
           "options": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": MAX_OPTIONS,
                       "description": "고를 것. 짧은 명사구. 「직접 입력」은 화면이 알아서 붙인다 — 고를 것만 적는다"}},
       "required": ["question", "options"]})
async def ask(ctx: Ctx, *, question: str, options: list[str]) -> dict:
    opts = [o.strip() for o in options if o and o.strip()][:MAX_OPTIONS]
    if len(opts) < 2:
        return {"error": "선택지가 둘은 되어야 한다. 하나면 그냥 진행한다."}
    return {"_ask": {"question": question.strip(), "options": opts},
            "note": "사용자 답을 기다린다. 이 턴은 여기서 끝난다."}
