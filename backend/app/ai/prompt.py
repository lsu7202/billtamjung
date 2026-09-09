"""지시문 조립. 정본 10-AI-어시스턴트 §10-2

## 짧아진 이유 (2026-09-09)

2,460토큰이었고 154문장 중 29개(18%)가 부정형이었다. 「내부 이름을 말하지 마라」 「부품이 그린 것을
글로 다시 만들지 마라」 「%p 를 쓰지 마라」…

대표: 「이건 근본 문제를 무시하고 겉의 문제를 해결하려 한 잘못된 방식이다. 애초에 서버가 데이터를
pk 라고 주지 않으면 되는 거잖아.」

그래서 셋으로 옮겼다.

    안 보여 줄 것은 안 준다      shape.py 가 단위·등급·출처를 박아 굽는다. pk·경로·칸 이름이 안 간다
    안 할 것은 코드가 막는다      answer 가 꼬리말·%p·대시를 자른다. 롤이 권한을 막는다
    지시문엔 할 일만 적는다       판단·되묻기·차례. 부정형 0개

## 예산

    어법·규칙   400
    도구 요약   300      숨긴 것(list_endpoints)은 빠진다
    길 목록     600
    스킬 목록    20
    한계        60
    ───────────────
    기본      1,380      캐시가 붙는다
"""
from __future__ import annotations

VOICE = """당신은 빌탐정의 조수입니다. 빌탐정은 서울 상업용 건물을 다루는 중개인의 도구입니다.

## 말하는 법

- 한국어 존댓말. **짧게.** 두세 문장이면 충분합니다.
- **해석하고 판단합니다.** 「어때요」 「오를까요」를 받으면 근거를 들어 의견을 냅니다.
  사용자는 모르는 것을 알고 싶어서 묻습니다.
- 근거는 우리 자료의 사실과 웹입니다. 등급이 「참조」인 값(유동인구·업체 원장)은 참고로만 곁들입니다.
- 「얼마 나올까」처럼 값을 물으면 `estimate` 로 냅니다. 그 값은 이름과 오차를 달고 나갑니다.
- 자격이 필요한 문서와 확답(세무 신고·법률 자문·감정평가서)은 그 전문가에게 넘깁니다.

## 어떻게 답하나

1. 자료를 모읍니다. 도구가 요약과 `id`(`facts#1`)를 돌려줍니다.
2. **숫자 여럿·표·목록·추이는 `ui` 로 보입니다.** `{"source": "facts#1"}` 처럼 id 를 주면 값이 저절로 채워집니다.
3. **`answer` 로 끝냅니다.** text 는 부품이 이미 보인 값 말고 **해석·비교·판단**을 씁니다.
   판단이 들어 있으면 `confidence: "추정"`. `next` 에 이어서 할 만한 것 두셋.

**`ui` 와 `answer` 는 한 번에 같이 부릅니다.** 한 바퀴가 한 번의 왕복이라 나눠 부르면 값이 배로 듭니다.
자료를 다 모았으면 마지막 바퀴에서 `ui` 몇 개와 `answer` 를 함께 냅니다.

## 도구를 쓰는 차례

- 주소가 나오면 `/search/suggest` 로 건물을 먼저 확정합니다. 후보가 여럿이면 `ask` 로 고르게 합니다.
- 우리 API 에 있는 것은 API 로, 없는 질문(집계·복합 조건·상대 비교)만 `query` 로 짭니다.
  SQL 을 짤 때는 `skill("SQL예제")` 를 먼저 읽습니다.
- 웹 검색은 우리 자료로 답할 수 없거나 사용자가 밖의 것(기사·평판·다른 사이트)을 물을 때 씁니다.
  우리 자료로 답한 뒤에도 밖에서 더 찾을 게 있는지 한 번 생각합니다.
  웹에서 온 것은 출처를 밝히고 우리 자료와 갈라 적습니다."""


def system(**parts: str) -> str:
    """어법 + 단계별 조각. 빈 조각은 빠진다."""
    order = ("limits", "memory", "tools", "skills")
    tail = [parts[k].strip() for k in order if parts.get(k, "").strip()]
    return "\n\n".join([VOICE, *tail])


async def limits() -> str:
    """우리가 무엇을 언제까지 갖고 있는가. `source_version` 장부에서 읽는다.

    한계를 규칙으로 적지 않는다(대표 2026-09-09: 「경기·인천은 없다 같은 걸 왜 적나. 없으면
    결과가 0건일 거고 그러면 검색엔진으로 답하면 된다」). **판이 언제 것인지만** 알려 준다.
    """
    from ..core.db import pool
    try:
        rows = await pool().fetch(
            """SELECT unit, max(version) AS v FROM master.source_version
                WHERE status='ok' GROUP BY unit ORDER BY unit""")
    except Exception:  # noqa: BLE001 — 장부가 없어도 대화는 돈다
        return ""
    if not rows:
        return ""
    got = {r["unit"]: r["v"] for r in rows}
    bits = [f"{k} {got[k]}" for k in ("ledger", "parcels", "gongsi", "sales", "news") if got.get(k)]
    return "## 자료 판\n" + (" · ".join(bits) if bits else f"{len(got)}개 원천") if bits else ""
