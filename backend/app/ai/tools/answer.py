"""answer — 답은 이 도구로 낸다. 정본 §8-1 · §12-2 · §13 · §16

## 왜 자연어가 아니라 도구인가

마크다운 한 덩이가 나오면 우리는 손댈 수 없었다. 꼬리말(「어떤 게 필요하세요」)을 지시문으로 다섯 번
조여도 다섯 중 다섯이 붙었다. **규칙으로 못 이기는 건 코드가 이긴다** — 조각으로 받아서 자른다.

    text        두세 문장. 부품이 그린 값을 되풀이하지 않는다. 해석·비교·판단만
    confidence  사실 | 추정.  「추정」이면 서버가 한 줄을 붙인다. 모델이 안 쓴다
    next        다음 걸음 칩 두셋. 「다음에 뭘 할까」는 문장이 아니라 칩이다(§13)

조각 목록 `[text, ui, ui, text]` 은 문서의 뼈대와 같은 모양이라 「이 대화로 보고서」가 조각을 옮기는
일이 된다(§24-2).

## 정규화

모델에게 부탁하지 않고 우리가 자른다. 마지막 문장이 빈 되물음이면 지운다. `%p`→`%`. 대시 연결어→쉼표.
"""
from __future__ import annotations

import re

from . import Ctx, tool

CAVEAT = "자료를 바탕으로 한 추정이고 실제와 다를 수 있습니다."
# 빈 되물음 낱말. **문장 하나만** 잘라낸다 —
# 처음엔 `(?:^|\n)[^\n]*(…)[^\n]*$` 로 썼는데 한 문단짜리 답에서 `^` 부터 먹어 **답을 통째로 지웠다.**
# 그러자 answer 가 「text 가 비었다」를 내고 모델이 다섯 번 고쳐 쓰다 「테스트」로 끝났다(2026-09-09 #77).
TAIL_WORDS = re.compile(
    r"(말씀해\s*주세요|말씀해\s*주시면|말씀\s*주세요|알려\s*주세요|알려\s*주시면|보시겠어요|보시겠습니까|"
    r"필요하세요|필요하시면|도와드릴까요|궁금한\s*점|궁금하신\s*점|원하시면|더\s*알아봐)")
SENT = re.compile(r"[^.!?\n]*[.!?]|[^\n]+")


def _drop_tail(t: str) -> str:
    """마지막 문장이 빈 되물음이면 그것만 지운다. 앞은 안 건드린다."""
    for _ in range(2):
        sents = [m.group(0) for m in SENT.finditer(t)]
        if len(sents) < 2 or not TAIL_WORDS.search(sents[-1]):
            break
        t = "".join(sents[:-1]).rstrip()
    return t


def normalize(text: str) -> str:
    t = _drop_tail(text.strip())
    t = t.replace("%p", "%")
    t = re.sub(r"(?<=[^\s])\s*[—–]\s*(?=[^\s])", ", ", t)   # 대시 연결어. 우리 글 규칙이라 여기서 바꾼다
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


@tool("answer",
      "답을 낸다. 마지막에 한 번. text 는 두세 문장으로 해석·비교·판단만 쓰고, 숫자 여럿·표·목록은 ui 로 "
      "이미 보였으니 되풀이하지 않는다. 판단이 들어 있으면 confidence 를 추정으로. "
      "next 는 이어서 할 만한 것 두셋(짧은 명사구).",
      {"type": "object",
       "properties": {
           "text": {"type": "string", "description": "두세 문장. 마크다운 굵게·목록은 되고 표는 안 쓴다(ui 로)"},
           "confidence": {"type": "string", "enum": ["사실", "추정"]},
           "next": {"type": "array", "items": {"type": "string"}, "maxItems": 3}},
       "required": ["text", "confidence"]})
async def answer(ctx: Ctx, *, text: str, confidence: str, next: list[str] | None = None) -> dict:
    raw = (text or "").strip()
    if not raw:
        return {"error": "text 가 비었다"}
    # 정규화가 다 지웠으면 **원문을 쓴다.** 우리 손질 때문에 모델이 답을 다시 쓰게 하지 않는다
    t = normalize(raw) or raw
    if confidence == "추정" and CAVEAT not in t:
        t = f"{t}\n\n{CAVEAT}"
    nxt = [n.strip() for n in (next or []) if n and n.strip()][:3]
    return {"_answer": {"text": t, "confidence": confidence, "next": nxt}, "ok": True}
