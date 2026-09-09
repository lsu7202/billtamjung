"""answer — 답은 이 도구로 낸다. 정본 §8-1 · §12-2 · §13 · §16

## 왜 자연어가 아니라 도구인가

마크다운 한 덩이가 나오면 우리는 손댈 수 없었다. 꼬리말(「어떤 게 필요하세요」)을 지시문으로 다섯 번
조여도 다섯 중 다섯이 붙었다. **규칙으로 못 이기는 건 코드가 이긴다** — 조각으로 받아서 자른다.

    text        첫 문장은 물음에 대한 답(수를 물으면 수). 그다음은 해석·비교·판단.
                **마크다운이 자유롭다** — 표도 목록도 쓴다. 부품이 이미 그린 것만 안 되풀이한다
    confidence  사실 | 추정.  「추정」이면 서버가 한 줄을 붙인다. 모델이 안 쓴다

`next`(다음 걸음 칩)는 뺐다(2026-09-09 대표). 모델이 「임대료 추정 estimate」처럼 **도구 이름을**
칩에 적었고, 그걸 채우느라 출력 토큰을 매 답마다 썼다. 다음에 뭘 할지는 사용자가 정한다.

조각 목록 `[text, ui, ui, text]` 은 문서의 뼈대와 같은 모양이라 「이 대화로 보고서」가 조각을 옮기는
일이 된다(§24-2).

## 한 벌로 받는다 (2026-09-09)

부품을 `ui` 로 하나씩 부르고 `answer` 를 따로 부르니 **조각끼리 어긋났다.** 「스타벅스 99동」을
그려 놓고 답은 「스타벅스+병원 5곳」이라 했고, 왜 있는지 모를 building_card 셋이 끼어 있었다.
각 호출이 앞뒤를 몰라서고, 서버도 검사할 단위가 없어서다(대표 지적).

그래서 **`show` 로 답과 부품을 한 번에 받는다.** 한 번에 쓰니 어긋날 자리가 없고,
서버가 한 벌을 통째로 볼 수 있다. 도중의 `ui` 는 화면에 「찾는 중」으로 뜨되 답에는 안 남는다.

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
# 답 자리에 도구 호출을 적어 넣는 일이 있다. 열어 준 마크다운이 그 문을 넓혔다
TOOL_XML = re.compile(r"<\s*(invoke|parameter|function_calls|antml:)|</\s*(invoke|parameter|ui)\s*>", re.I)
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
      "답을 낸다. 마지막에 한 번. **첫 문장은 물음에 대한 답이다** — 몇 개냐고 물으면 몇 개인지 말한다. "
      "그다음은 해석·비교·판단. **마크다운이 자유롭다** — 표도 목록도 굵게도 쓴다. "
      "부품으로 이미 그린 것만 글로 되풀이하지 않는다. "
      "판단이 들어 있으면 confidence 를 추정으로.",
      {"type": "object",
       "properties": {
           "text": {"type": "string", "description": "첫 문장이 답. 마크다운이 자유롭다 — 표·목록·굵게 다 된다. 값이 많고 정확해야 하면 ui 부품, 몇 줄만 골라 보이거나 우리 칸에 없는 것을 섞으면 마크다운 표"},
           "show": {"type": "array", "maxItems": 4,
                    "description": "글과 **함께** 세울 부품. 앞서 ui 로 그린 것을 다시 적지 않는다 — "
                                   "여기 적은 것만 답에 남는다. [{\"name\":\"map\",\"source\":\"events#1\"}, …]",
                    "items": {"type": "object", "additionalProperties": True}},
           "confidence": {"type": "string", "enum": ["사실", "추정"]}},
       "required": ["text", "confidence"]})
async def answer(ctx: Ctx, *, text: str, confidence: str, show: list | None = None) -> dict:
    raw = (text or "").strip()
    if not raw:
        return {"error": "text 가 비었다"}
    # **되물음만 있는 답을 되돌린다.** 처음엔 「문장이 하나인데 꼬리말이면」으로 좁게 잡았더니
    # 「…말씀해 주세요. …알려드릴 수 있습니다.」처럼 두 문장이면 그냥 통과했고, 표를 그린 뒤
    # 수를 안 말하는 답이 잣대 다섯 문항에 깔렸다(2026-09-09).
    # 잣대는 **길이가 아니라 알맹이**다 — 되물음 낱말이 있는데 사실(숫자·고유명사)이 없으면 답이 아니다.
    # **도구 호출을 글로 쓴 것.** 마크다운을 열어 주니 모델이 답 자리에 <invoke name="ui"> 를
    # 통째로 적어 넣었고 그게 사용자에게 그대로 나갔다(2026-09-09 잣대 6번).
    # 글은 글이고 도구는 도구다 — 섞이면 되돌린다.
    if TOOL_XML.search(raw):
        return {"error": "여기엔 사람이 읽을 글만 쓴다. 부품은 ui 도구로 따로 부른다"}
    body = TAIL_WORDS.sub("", raw)
    if TAIL_WORDS.search(raw) and not re.search(r"\d", body):
        return {"error": "찾은 것을 먼저 말한다 — 몇 개인지, 어디인지. 되물음만으로는 답이 되지 않는다"}
    # 정규화가 다 지웠으면 **원문을 쓴다.** 우리 손질 때문에 모델이 답을 다시 쓰게 하지 않는다
    t = normalize(raw) or raw
    if confidence == "추정" and CAVEAT not in t:
        t = f"{t}\n\n{CAVEAT}"
    return {"_answer": {"text": t, "confidence": confidence, "show": show or []}, "ok": True}
