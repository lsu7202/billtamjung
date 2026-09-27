"""도구 사전 — 모델이 읽을 스키마와 부를 함수를 **한 자리에** 둔다(2026-09-18).

## 왜 도구가 하나인가

FastMCP 를 만든 사람이 「REST API 를 그대로 MCP 로 바꾸지 마라」고 썼다. 모델은 준 도구
전부의 이름·설명·파라미터를 추론할 때마다 처리한다. 작은 엔드포인트 수백 개를 그대로 주면
힘을 실어 주는 게 아니라 익사시키는 것이다. Anthropic 의 도구 작성 지침도 같은 말을 한다 —
「기존 API 엔드포인트를 그저 감싼 도구」를 흔한 실수로 부르고, 자주 이어 부르는 것을 하나로
합치라고 한다(`list_users`+`list_events`+`create_event` → `schedule_event`).

그래서 굵은 것 하나로 시작한다. 건물을 찾는 일 전체가 `search` 하나다. `x-ai` 로 표시해 둔
나머지 22개는 잘게 쪼개진 쪽이라 아직 안 연다. 다음 굵은 도구는 건물 하나에 딸린 것
(대장·층별·주변·시세)을 한 번에 주는 `building` 이 될 것이다.

## 왜 여기 있나

조립은 앱 옆 단일 모듈, 라우트는 따로 둔다. 도메인 코드는 `ai` 를 import 하지 않는다 —
`search.py` 는 `x-model: False` 라는 평범한 dict 표시만 달고, 그 표시를 읽는 건 여기다.

## 스키마와 실행을 왜 묶나

둘이 떨어지면 어긋난다. `Tool` 한 줄에 이름·설명·스키마 만드는 법·부를 함수가 같이 있다.
스키마를 고치면 실행이 바로 옆에 보인다.

## 여기서 안 하는 것

모델을 부르지 않는다(`agent.py`). HTTP 를 모른다(`domains/ai.py`).
도구 결과를 고쳐 쓰지 않는다 — 결과는 온 그대로 모델에게 간다.
"""
from __future__ import annotations

import asyncio
import contextvars
import datetime as dt
import difflib
import json
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from ..core.config import settings
from ..core.db import pool
from ..core.deps import CurrentUser
from ..domains import buildings as bld
from ..domains import floors as flr
from ..domains import floor_rents as frt
from ..domains import market as mkt
from ..domains.search import (_ECHO, _FIELDS_OK, _NOT_COL, _VACANT_ANY, _VACANT_COL,
                              _VACANT_FIELDS, Filters, SearchIn, search, search_vacant)
from . import calc, names

# 모델이 `칸` 으로 더 볼 수 있는 것 — 한국어 → 영어. 응답에 돌아오는 이름과 **같은 낱말**이라야
# 모델이 「추정가를 달라」고 해서 「추정가」를 받는다. 이름이 겹치면 어느 칸인지 못 가리므로
# 여기서 막는다(2026-09-19: gongsi_ratio·gongsi_ratio_team 이 둘 다 「공시비율」이었다).
# names.DROP 은 뺀다 — 응답에서 걷어 내는 칸이라 달래 봐야 안 온다.
_FIELDS_MODEL: dict[str, str] = {names.ko(f): f for f in _FIELDS_OK if f not in names.DROP}
assert len(_FIELDS_MODEL) == len(_FIELDS_OK - names.DROP), "칸 이름이 겹친다"

# 조건과 무관하게 **늘 실려 오는 칸.** 달라고 하면 그냥 넘긴다 — 있는 것을 달랬는데
# 「그런 칸은 없다」로 튕기면 모델이 그 바퀴를 통째로 버린다(2026-09-19 실측).
_ALWAYS = frozenset({"건물번호", "주소", "추정가"})

# 값 목록이 스키마 안으로 들어가는 칸 — 필터 이름 → ref.enums 의 갈래 이름.
# 여기 없는 enum 칸(팀 매물 관리 쪽)은 애초에 모델에게 안 간다.
#
# **손으로 적는다. 파생시키려다 막혔다(2026-09-18 실측).** 사슬이 두 마디인데 둘째가 없다.
#   필터 이름 → 칸 이름 : `search._ECHO` 에 있다(use_zones → use_zone)
#   칸 이름 → 갈래 이름 : `ref.fields.enum_key` 여야 하는데 —
#       use_zone       ref.fields 에 있으나 enum_key 가 빈 문자열
#       main_use_name  ref.fields 에 없음(갈래 이름은 main_use 라 칸 이름과도 다르다)
#       land_use       ref.fields 에 없음
#   결과 줄 78칸 중 ref.fields 에 등록된 것이 16개(21%)뿐이다. 첫 마디만 파생시켜도
#   둘째는 어차피 손으로 적어야 하니, 파생 코드 + 예외 표보다 이 여섯 줄이 작다.
_ENUM_OF = {
    "use_zones": "use_zone",
    "jimoks": "jimok",
    "road_frontages": "road_frontage",
    "shapes": "shape",
    "slopes": "slope",
    "main_uses": "main_use",
    "sell_vagues": "sell_vague",
    # 팀 매물 판정값 — 값 목록이 ref.enums 에 있다(2026-09-19)
    "urgencies": "urgency", "owner_types": "owner_type", "relations": "relation",
    "cooperations": "cooperation", "kindnesses": "kindness",
    "meongdos": "meongdo", "use_changes": "use_change", "myeolsils": "myeolsil",
    # 규제(311가지)는 여기 없다. 164개를 enum 으로 박았더니 ANY 모드가 400 INVALID_ARGUMENT 로
    # 죽었다(2026-09-22, 제약 디코딩의 상태 수). 값은 막이(search._ENUM)가 다 알고, 틀리면
    # 가까운 이름을 돌려준다. 스키마엔 흔한 이름 몇 개만 설명으로(_VIEW_DESC).
}

# 정렬·쪽수는 모델에게 안 준다.
#   sort      화면의 `addr` 은 정렬 표에 없어 동작조차 안 하고(price·roi 뿐), `price DESC` 는
#             조 단위 건물을 앞세운다 — 실측에서 종로구 692동의 첫 줄이 15조 8천억이었다.
#             어느 줄을 볼지는 우리 매물 우선으로 서버가 정한다.
#   per_page  줄 수로 자르면 값이 안 정해진다. 같은 20줄도 4칸이면 1,000 토큰, 12칸이면
#             3,300 토큰이다. 칸 수에서 줄 수를 역산한다(_rows_for).
# 화면은 SearchIn.sort 세 개를 그대로 쓴다.

# 결과에 쓸 토큰 예산. 도구 스키마가 약 6,700 이라 한 바퀴를 1.3만쯤으로 잡는다.
# 한 응답에 담을 토큰. **여기 하나에서 다 나온다** — 검색 줄 수도, 검색 개수 상한도,
# 한 번에 볼 건물 수도. 자리마다 숫자를 따로 박으면 근거 없는 문턱이 된다.
_BUDGET = 6000      # 목록 하나가 먹을 토큰. 내매물·일반 각각에 붙으니 최대 두 배다
_ROW_BASE = 71      # 칸을 안 더해도 줄 하나에 드는 토큰(건물번호·주소·추정가)
_PER_COL = 9        # 칸 하나가 줄마다 더 먹는 토큰
_ROWS_MIN = 5       # 이보다 적게 주면 검색한 뜻이 없다
_ROW_SLIM = 25      # 잘린 줄 하나의 바탕(건물번호 + 괄호). 걸린 칸은 _PER_COL 씩 더한다
# 검색 줄은 1.47자/토큰이다(2026-09-21, 호출 입력 증가분에서 역산: 5,135자 → 약 3,500토큰).
# 숫자와 주소가 많아 스키마(2.3자/토큰)보다 나쁘다. 줄 수를 글자로 셀 땐 이 값을 쓴다.
_ROW_CHARS_PER_TOK = 1.47
_CHARS_PER_TOK = 2.5   # 한국어 JSON 실측(14,927자 = 6,022토큰)
# 건물 하나의 대장만 받았을 때. **2026-09-21 에 목록 넷(버스정류장·지하철역·공시지가추이·
# 실거래이력)을 `함께` 로 내리면서 2,947 → 837자가 됐다.** 상수를 안 고쳤더니 한 번에
# 다섯 채까지만 되어, 모델이 검색에서 고른 예닐곱을 보려다 바퀴를 버렸다(실측 두 번).
# 최대치(나대지 967자)로 잡는다 — 평균으로 잡으면 큰 것만 모였을 때 예산을 넘는다.
_LEDGER_CHARS = 970
# 묶음 하나가 한 채에 더하는 자릿수 — 실측 중앙값(2026-09-21, 강남구 삼성동 160-22).
# **퍼 오기 전에 몇 채가 들어갈지 셈하는 데 쓴다.** 어림이라도 있어야 버릴 것을
# 퍼 오지 않는다. 무거운 셋(주변동향·주변매각·주변실거래)이 나머지를 다 합친 것보다 크다.
_SEC_CHARS: dict[str, int] = {
    "주변매각": 2932, "주변동향": 2525, "주변실거래": 1268, "층별": 1006, "임대내역": 700,
    "공시지가추이": 640, "버스정류장": 559, "필지": 448, "시간대별유동인구": 150, "상권구성": 80,
    "임대추이": 271, "지하철역": 260, "실거래이력": 33,
}
# 위 값은 **손잡이를 안 줬을 때**다. 좁혀 부르면 훨씬 작아진다 — 주변동향은 반경 250 ·
# 연수 1 이면 2,525 → 170자다. 그걸 안 보고 셈했더니 예산 15,000 중 5,228자만 쓰고
# 네 채에서 끊었다(2026-09-21 실측). 손잡이가 크기를 어떻게 줄이는지 같이 센다.
_SEC_ROWS = {"주변동향": 20, "주변매각": 19, "주변실거래": 8, "버스정류장": 13,
             "지하철역": 5, "공시지가추이": 37}     # 손잡이 없을 때의 줄 수(실측)
_SEC_YEARS = {"주변동향": 10, "주변매각": 5, "주변실거래": 5,
              "공시지가추이": 37, "실거래이력": 5}   # 기본이 훑는 햇수


def _sec_chars(key: str, o: dict) -> int:
    """이 묶음이 이 손잡이로 부르면 몇 자쯤 되나. **어림이면 된다** — 버릴 것을 퍼 오지
    않을 만큼만 맞으면 되고, 남으면 뒤에서 한 번 더 자른다."""
    n = _SEC_CHARS.get(key, 800)
    if o.get("줄수") and (rows := _SEC_ROWS.get(key)):
        n = int(n * min(1.0, int(o["줄수"]) / rows))
    if o.get("연수") and (yrs := _SEC_YEARS.get(key)):
        n = int(n * min(1.0, int(o["연수"]) / yrs))
    # **반경으로는 안 깎는다.** 반경이 도는 묶음 셋에 줄 수 상한 20이 걸려 있어서,
    # 소식이 스물보다 많은 동안에는 반경을 좁혀도 크기가 그대로다(종로구 실측:
    # 반경 700 → 2,525자 · 반경 250 → 2,306자, 9% 만 준다). 넓이 제곱으로 깎았더니
    # 어림 107 · 실제 502자로 다섯 배 어긋나 헛질의가 났다(2026-09-21).
    if o.get("갈래"):
        n = n // 2                                          # 갈래가 고르게 안 퍼져 있다
    return max(300, n)

# 검색을 몇 개까지 한 바퀴에 — 예산이 줄 다섯도 못 줄 만큼 쪼개지면 거기가 끝이다.
_SEARCH_MAX = max(1, _BUDGET // (_ROWS_MIN * _ROW_BASE))


def _rows_for(n_fields: int, n_search: int = 1, sec_tok: int = 0) -> int:
    """이번 요청의 칸 수로 줄 수를 정한다. 실측(제미나이 count_tokens, 2026-09-19):
    칸 0개 120줄 = 8,480토큰 · 칸 16개 22줄 = 4,592토큰 → 줄당 71 + 9n."""
    budget = _BUDGET // max(1, n_search)
    per = _ROW_BASE + _PER_COL * n_fields + sec_tok
    # 묶음을 달랬으면 최소 줄 수를 1로 내린다. 다섯 줄을 지키려고 예산을 다섯 배
    # 넘기면 안 된다(건물 조회에서 같은 판단을 했다).
    return max(1 if sec_tok else _ROWS_MIN, min(120, budget // per))

# 단위를 여기에도 적는다. MCP 명세는 outputSchema 의 description 에 박는 예시를 보여 주지만
# **클라이언트가 그걸 모델에게 준다는 보장이 없다.** 도구 설명은 반드시 실린다.
_SEARCH_DESC = (
    "응답은 `검색` 목록이고 그 안이 `내매물`·`일반` 둘로 갈린다. "
    "**이름을 대면 줄에 보이고, 손잡이를 달면 걸린다.** 보기만 할 거면 빈 묶음을 준다 — "
    "`{\"대지면적\":{\"이상\":200}, \"구조\":{}}` 는 대지 200㎡ 이상을 거르고 줄에 대지면적과 구조를 낸다. "
    "손잡이는 수면 `이상`·`이하`, 갈래면 `값`·`없음` 이다. 걸 조건과 볼 칸이 따로 있지 않으니 같은 이름을 두 번 적지 마라. "
    "**조건끼리는 AND 다.** `조건`은 늘 목록이다 — 하나여도 `[{…}]` 다. 「입주업체가 병원이거나 주용도가 의료시설」처럼 갈래가 둘이면 목록에 둘을 넣어라. 한 번에 같이 돈다. "
    "「신축 가능한 곳」처럼 빈 땅과 헐 건물이 둘 다 답이면 조건마다 `대상`을 달리 건다. "
    "`값`은 세 모양이다 — `[\"A\",\"B\"]`는 A 또는 B, `[[\"A\",\"B\"],[\"C\"]]`는 (A 그리고 B) 또는 C. "
    "안쪽 「그리고」가 뜻을 갖는 건 `주용도`(부분일치)와 `입주업체`(한 건물에 여럿 든다)뿐이다. "
    "`주용도`는 허가 받을 때 당시의 용도라 지금과 다를 수 있다. 지금 무엇이 들어와 있는지는 `입주업체`로 찾는다 — 병원·카페·스타벅스는 대개 이쪽이다. "
    "가격은 `가격_이상`·`가격_이하` 하나로 건다. 추정가·매매가·매도희망가 어느 하나라도 범위면 나오고, 줄에 걸린 값이 다 나온다. 지난 실거래가는 가격이 아니다. "
    "명도·용도변경·멸실·급함·매도의사·소유자·매물번호·수익률·총월임대처럼 **우리가 적은 값**을 조건에 걸면, "
    "`내매물` 목록만 그 조건으로 걸러진다. `일반` 목록은 그 조건을 **보지 않은** 건물이다. "
    "추정 수익률·추정 임대·평단가·공시비율은 손잡이가 없다(스키마에 빈 묶음으로 보인다) — 이름만 대서 보거나 `정렬`로 세워 위에서 읽는다. "
    "유동인구는 이름만 대서 볼 수 있고 조건·정렬은 없다. "
    f"단위는 {names.UNITS}."
)


async def enum_values() -> dict[str, list[str]]:
    """ref.enums 에서 모델에게 줄 갈래만 뽑는다. code 가 아니라 label 로 준다 —
    검색이 이름으로 비교하고(「제2종일반주거지역」), 모델도 이름으로 말한다."""
    rows = await pool().fetch(
        "SELECT enum_key, label FROM ref.enums"
        " WHERE active AND enum_key = ANY($1::text[]) ORDER BY enum_key, sort_order",
        list(_ENUM_OF.values()),
    )
    out: dict[str, list[str]] = {}
    for r in rows:
        out.setdefault(r["enum_key"], []).append(r["label"])
    # 주변동향 갈래는 ref.enums 가 아니라 자료 자체에 있다. 박아 두면 파이프라인이
    # 갈래를 늘렸을 때 스키마만 조용히 낡는다 — 세어서 많은 것부터 준다.
    out["_event_kind"] = [r["kind"] for r in await pool().fetch(
        "SELECT kind, count(*) n FROM master.area_event"
        " WHERE kind IS NOT NULL GROUP BY 1 ORDER BY n DESC")]
    return out


def _inline_enum(spec: dict, values: list[str]) -> None:
    """값 목록을 스키마 **안쪽**에 박는다. MCP 에는 도구 인자 값을 조회하는 수단이 없다
    (`ref/prompt`·`ref/resource` 뿐이고 `ref/tool` 은 없다) — 박는 것 말고 길이 없다.

    Pydantic 의 `X | None` 은 `anyOf: [{type:array, items:…}, {type:null}]` 로 나온다.
    바깥에 `items` 를 얹으면 anyOf 안쪽 가지가 이기거나 무시돼 값이 안 보인다.
    배열 가지를 찾아 그 안의 `items` 를 바꾼다. 설명의 「값은 GET /enums 를 봐라」도
    지운다 — 값이 여기 있는데 다른 문을 가리키면 그게 거짓말이다."""
    for branch in spec.get("anyOf") or [spec]:
        if branch.get("type") == "array":
            branch["items"] = {"type": "string", "enum": values}
        elif branch.get("type") == "string":
            branch["enum"] = values
    d = spec.get("description") or ""
    if "GET /enums" in d:
        spec["description"] = re.sub(r"\s*값은 GET /enums 의 \S+\.?", "", d).strip() or d


def _shapes(name: str, spec: dict) -> dict:
    """목록 조건이 받는 세 모양을 스키마에 알린다.

        ["A","B"]                  A 또는 B                  ← 흔한 경우
        [["A","B"], ["C"]]         (A 그리고 B) 또는 C
        {"있음": …, "없음": [...]}  거기서 뺀다

    괄호 없는 불리언이 전부 이 꼴로 써진다. 조건마다 `_모두`·`_없음` 을 파면 조건만 불어나고,
    어느 조건에 무엇이 있는지를 모델이 외워야 한다.

    **갈래값은 첫 가지에만 박는다.** 세 가지에 다 넣으면 용도지역 하나가 세 배가 된다.
    """
    branches = [b for b in (spec.get("anyOf") or [spec]) if b.get("type") != "null"]
    arr = next((b for b in branches if b.get("type") == "array"), None)
    if arr is None or len(branches) != 1:
        return spec                                   # 목록이 아닌 조건은 그대로
    inner = arr.get("items") or {}
    if inner.get("type") == "array":                  # use·biz_dnf 는 이미 DNF 로 선언돼 있다
        inner = inner.get("items") or {"type": "string"}
    plain = {"type": inner.get("type", "string")}     # 갈래값 없는 가지(토큰을 아낀다)
    # 세 모양이 무엇인지는 **도구 설명에 한 번만** 적는다. 조건마다 되풀이하면
    # 스키마가 14,927 → 21,329자로 불었다(2026-09-20 실측).
    # 안쪽 「그리고」 가지는 뜻이 있는 둘에만 준다. 한 건물에 값이 하나뿐인 칸에 붙이면
    # **언제나 오류인 가지**를 열다섯 군데에 다는 셈이고, 스키마만 무거워진다.
    deep = [{"type": "array", "items": {"type": "array", "items": plain}}] if name in _DNF_OK else []
    has = {"type": "array", "items": ({"type": "array", "items": plain} if deep else plain)}
    return {
        "description": spec.get("description") or "",
        "anyOf": [
            {"type": "array", "items": inner},
            *deep,
            {"type": "object", "properties": {"있음": has, "없음": {"type": "array", "items": plain}}},
        ],
    }


def model_filters(schema: dict, enums: dict[str, list[str]]) -> tuple[dict, list[str]]:
    """Filters 의 JSON Schema 에서 모델용 속성만 남긴다. 반환 (속성, 뺀 칸).

    뺀 칸은 추정치다(`search.Filters` 의 `_EST` 표시). 오차가 커서 조건으로 걸면
    맞는 건물이 조용히 빠진다 — 적정가 중위 17%, 임대 29%, 유동인구는 이동통신 기반이다.
    화면은 그대로 쓴다. 사람은 오차를 알고 거는 것이고 모델은 모르는 채로 건다."""
    props: dict[str, dict] = {}
    dropped: list[str] = []
    for name, spec in (schema.get("properties") or {}).items():
        if spec.get("x-model") is False:
            dropped.append(name)
            continue
        s = {k: v for k, v in spec.items() if k not in ("title", "x-model")}
        key = _ENUM_OF.get(name)
        if key and enums.get(key):
            _inline_enum(s, enums[key])
        s = _shapes(name, s)
        props[names.FILTER_KO.get(name, name)] = s      # 이름도 한국어(names.FILTER_KO)
    return props, dropped



# ── 화면 지도용 핀 ─────────────────────────────────────────────────────────
# 검색 원본 줄엔 좌표가 있는데 모델에게 가기 전에 걷는다(names.DROP). 그 자리에서 핀만
# 따로 빼 **화면으로만** 보낸다 — 제미나이처럼 답 옆에 지도가 서고, 글이 가리키는 건물엔
# 카드가 선다(2026-09-21 대표). 모델은 이걸 못 본다. `agent.Exec` 가 도구를 돌리기 전에
# 빈 목록을 걸고, 돌린 뒤 걷어 도구 기록에 붙인다.
_PINS: contextvars.ContextVar[list[dict] | None] = contextvars.ContextVar("bt_pins", default=None)


def _collect_pins(raw: dict, vacant: bool) -> None:
    sink = _PINS.get()
    if sink is None:
        return
    for col in ("mine", "normal"):
        for r in (raw.get(col) or {}).get("items") or []:
            lng, lat = r.get("lng"), r.get("lat")
            if lng is None or lat is None:
                continue
            # asyncpg 의 NUMERIC 은 Decimal 이라 그대로 두면 SSE 에서 문자열이 되고 지도가
            # 숫자로 못 읽는다. 여기서 숫자로 바꾼다.
            num = lambda v: (float(v) if v is not None else None)   # noqa: E731
            sink.append({
                "pk": r.get("pnu") if vacant else r.get("building_pk"),
                "vacant": vacant, "addr": r.get("addr"), "lng": float(lng), "lat": float(lat),
                "col": col, "sale_est": num(r.get("sale_est")), "price": num(r.get("sale_price")),
                "land_area": num(r.get("land_area")), "total_area": num(r.get("total_area")),
            })


# ── 이름 하나 사전 ──────────────────────────────────────────────────────────
# 전엔 **같은 개념을 두 사전이 다르게 불렀다.** 걸 조건 99개와 볼 칸 79개인데 접미사를 뗀
# 조건 65개 중 14개는 같은 이름의 칸이 없었다. 모델이 조건에 `연식_이상: 30` 을 걸고 줄에서도
# 보려고 `칸` 에 `연식_이상` 을 적어 600자 오류를 받고 바퀴를 버렸다(2026-09-21 실측).
#
# 이제 이름이 하나고 거기에 손잡이가 달린다. **이름을 대면 보이고, 손잡이를 달면 걸린다.**
#
#     "대지면적": {"이상": 200, "이하": 1500}      걸고 + 본다
#     "구조": {}                                   보기만
#
# 재는 양과 보이는 양이 다른 넷(연식/사용승인일 · 리모델링경과/리모델링일 ·
# 실거래경과/최근실거래월 · 가격/매매가·추정가)은 이름을 합칠 수 없다. 걸면 그 칸이
# 줄에 실린다고 설명에 적는다. 어차피 모델이 칸 이름을 따로 댈 일이 없어졌다.
# 나이를 재는 이름은 날짜 칸을 **거꾸로** 읽는다. 「연식 내림차순」 = 오래된 것부터 = 사용승인일
# 오름차순. 차순을 칸에 그대로 넘겨 「오래된 건물부터」가 2026년 준공부터 나왔다(2026-09-25 실측)
_AGE_SORT = frozenset({"연식", "리모델링경과", "실거래경과"})
# 정렬로 못 세우는 이름(2026-09-27 대표). 유동인구는 250m 격자 추정이라 그 값으로 줄을 세우는 것 자체가
# 믿을 만하지 않다 — 칸으로 보기만 한다(조건도 없다, [[pop-no-condition]])
_NO_SORT = frozenset({"유동인구"})
_SCOPE = ("대상", "지역", "법정동코드", "건물번호", "필지번호", "주소")   # 줄 값이 아니라 어디를 볼지
# 그중 **어디를 볼지**. 조건마다 하나는 있어야 한다(`대상` 은 무엇을 찾나지 어디가 아니다)
_WHERE = ("지역", "법정동코드", "건물번호", "필지번호", "주소")

# 묶음이 받는 손잡이. 없는 것은 건물 하나에 딸린 값이라 좁힐 축이 없다.
_SEC_KNOBS: dict[str, tuple[str, ...]] = {
    "주변동향": ("반경", "연수", "갈래"), "주변실거래": ("반경", "연수"),
    "주변매각": ("반경",),
    "버스정류장": ("반경", "줄수"), "지하철역": ("반경", "줄수"),
    "공시지가추이": ("연수", "줄수"), "실거래이력": ("연수", "줄수"),
}


def _col_of(en: str) -> str | None:
    """조건이 되비치는 칸(영문). `search._ECHO` 가 정본이다."""
    c = _ECHO.get(en)
    if isinstance(c, tuple):
        c = c[0]
    return c.split(" AS ")[-1] if c else None


def _entries() -> dict[str, dict[str, Any]]:
    """이름 → {f: 걸 필터들, col: 줄에 보일 칸, kind: 갈래}. 스키마도 옮기기도 여기서 나온다 —
    **한 표에서 나와야 둘이 갈라질 자리가 없다.**"""
    e: dict[str, dict[str, Any]] = {}
    for en, k in names._FILTER_RANGE.items():           # 수: _이상·_이하 짝
        e[k] = {"f": (f"{en}_min", f"{en}_max"), "col": _col_of(f"{en}_min"),
                "kind": "수", "lo": "이상", "hi": "이하"}
    for en, k in names._FILTER_PLAIN.items():
        if k in _SCOPE:
            continue                                     # 어디를 볼지 — 칸 밖이다
        base, lo_hi = k, None
        for a, b in (("_이상", ("이상", None)), ("_이하", (None, "이하")),
                     ("_이후", ("이후", None)), ("_이전", (None, "이전"))):
            if k.endswith(a):
                base, lo_hi = k[:-len(a)], b
                break
        if lo_hi:                                        # 역거리_이하 · 접수일_이후/_이전
            g = e.setdefault(base, {"f": (), "col": _col_of(en), "kind": "수",
                                    "lo": None, "hi": None})
            g["f"] = g["f"] + (en,)
            if lo_hi[0]:
                g["lo"] = lo_hi[0]
            if lo_hi[1]:
                g["hi"] = lo_hi[1]
            continue
        e[k] = {"f": (en,), "col": _col_of(en), "kind": "목록"}
    for ko_name, col in _FIELDS_MODEL.items():           # 조건이 없는 칸 — 보기만
        e.setdefault(ko_name, {"f": (), "col": col, "kind": "보기만"})
    # 묶음도 같은 사전에 든다(2026-09-21). 한 줄짜리 값이든 여러 줄 목록이든
    # **이름을 대면 보인다**가 똑같이 적용돼야 모델이 두 어법을 안 외운다.
    for sec in names.SECTIONS:
        # 겹치면 앞 항목이 조용히 사라진다 — 「유동인구」 수 조건이 그렇게 없어졌었다(2026-09-22)
        assert sec not in e, f"묶음 이름 「{sec}」이 조건·칸 이름과 겹친다"
        e[sec] = {"f": (), "col": None, "kind": "묶음", "knobs": _SEC_KNOBS.get(sec, ())}
    return e


_ENTRY = _entries()
_ENTRY_BY_FILTER = {f: n for n, v in _ENTRY.items() for f in v["f"]}




def _from_entries(cond: dict[str, Any]) -> tuple[dict, dict, list[str], str, dict, list[str]]:
    """조건 항목 하나 → (Filters 인자, 아님, 줄에 낼 칸, 대상).

    **이름을 대면 보이고, 손잡이를 달면 걸린다.** 손잡이가 없어도(`{}`) 이름을 댔으면
    칸으로 실린다. 그래서 모델이 「건 조건을 칸에 또 적을」 자리가 없다."""
    flat: dict[str, Any] = {}
    nots: dict[str, list[str]] = {}
    fields: list[str] = []
    cond_cols: list[str] = []          # 손잡이를 단 이름의 칸 — 잘린 줄엔 이것만 실린다
    secs: dict[str, dict] = {}
    target = "building"
    seen_where = False
    for name, v in cond.items():
        if name in _WHERE and (v if isinstance(v, str) else True):
            seen_where = True
        if name == "대상":
            target = {"나대지": "vacant"}.get(str(v or ""), "building")
            continue
        if name in _SCOPE and name != "대상":
            # 「주소」는 늘 줄에 실리는 칸이기도 하다. `{}` 로 달라고만 한 건 조건이 아니다
            if name == "주소" and not isinstance(v, str):
                continue
            if name == "주소" and not v.strip():
                raise ValueError("「주소」가 비었다. 「종로5가 104-8」처럼 동과 지번을 준다")
            flat[names.FILTER_EN.get(name, name)] = v
            continue
        e = _ENTRY.get(name)
        if e is None:
            near = difflib.get_close_matches(name, _ENTRY, n=3, cutoff=0.5)
            raise ValueError(f"그런 이름은 없다: 「{name}」."
                             + (f" 혹시 {' · '.join(near)}?" if near else
                                f" 고를 수 있는 이름: {sorted(_ENTRY)}"))
        if e["kind"] == "묶음":
            if not isinstance(v, dict):
                raise ValueError(f"「{name}」은 묶음으로 준다. 그냥 볼 거면 {{}}, "
                                 f"좁히려면 {{{' · '.join(e['knobs']) or '손잡이 없음'}}}")
            if bad := [k for k in v if k not in e["knobs"]]:
                raise ValueError(f"「{name}」이 받는 손잡이는 "
                                 f"{list(e['knobs']) or '없다'}. 받은 것: {bad}")
            secs[name] = v
            continue
        if e["col"]:
            fields.append(e["col"])
            if isinstance(v, dict) and v:
                # 되비치는 칸 **전부**. 가격은 매매가·추정가·매도희망가 셋이 한 조건이다.
                for f in e["f"]:
                    ec = _ECHO.get(f)
                    for c in (ec if isinstance(ec, tuple) else (ec,)) if ec else ():
                        cond_cols.append(c.split(" AS ")[-1])
        if not isinstance(v, dict):
            raise ValueError(f"「{name}」은 묶음으로 준다. 보기만 할 거면 {{}}, "
                             f"걸려면 {{\"이상\": …}} 이나 {{\"값\": […]}}")
        if not v:
            if name == "입주업체":
                # 저장된 칸이 없다. 카카오에 무엇을 물을지 안 알려 준 것이라 뜻이 없다.
                raise ValueError("「입주업체」는 보기만 할 수 없다. 찾을 낱말을 줘라: "
                                 "{\"값\": [\"병원\"]}")
            continue                                  # {} = 보기만
        if e["kind"] == "수":
            sides = [e.get("lo"), e.get("hi")] if len(e["f"]) == 2 else [e.get("lo") or e.get("hi")]
            for f, side in zip(e["f"], [x for x in sides if x]):
                if v.get(side) is not None:
                    flat[f] = v[side]
            if bad := [k for k in v if k not in (e.get("lo"), e.get("hi"))]:
                raise ValueError(f"「{name}」이 받는 손잡이는 "
                                 f"{[x for x in (e.get('lo'), e.get('hi')) if x]} 뿐이다. 받은 것: {bad}")
        elif e["kind"] == "보기만":
            if v:
                raise ValueError(f"「{name}」은 보기만 한다 — 조건이 없다. {{}} 로 달라고만 해라. 받은 것: {sorted(v)}")
        else:
            if bad := [k for k in v if k not in ("값", "없음")]:
                raise ValueError(f"「{name}」이 받는 손잡이는 ['값', '없음'] 뿐이다. 받은 것: {bad}")
            one, _n = _unpack({e["f"][0]: {"있음": v.get("값"), "없음": v.get("없음")}})
            flat.update(one)
            nots.update(_n)
    # **어디를 볼지가 없으면 찾지 않는다**(2026-09-25 대표). 빈손으로 부르면 서울 58만 동이
    # 대상이라 무엇을 받아도 뜻이 없고, 실제로 한 물음에 같은 검색을 여섯 번 돌았다.
    # 지시문으로 타이르지 않고 **구조로 막는다** — `입주업체` 에 `값` 을 required 로 박은 것과 같다.
    if not seen_where:
        raise ValueError(
            "어디를 볼지가 없다. 「지역」·「주소」·「건물번호」·「필지번호」·「법정동코드」 중 "
            "하나는 조건마다 있어야 한다. 「지역」은 **구부터** 고른다(「강남구」·「종로구」). "
            "아직 어디인지 모르면 찾지 말고 `ask` 로 물어 좁힌다")
    return flat, nots, fields, target, secs, cond_cols


# 보기만 칸은 Filters 설명이 없다. 뜻이 이름만으로 안 서는 것에만 한 줄.
_VIEW_DESC = {
    "유동인구": "주간·야간 두 수(명/일, 생활인구 250m 격자 2주 평균). 조건·정렬은 없다",
    "측면도로폭": "m, 실측", "후면도로폭": "m, 실측",
    "도로접면": "대장 분류. 광대 25m 이상 · 중로 12~25 · 소로 8~12 · 세로 8 미만, 각지=두 면 접함. 실측 m 는 「전면도로폭」",
    "규제": "이름은 토지이용계획확인서 그대로: 지구단위계획구역 · 정비구역 · 재정비촉진지구 · 개발제한구역 · "
           "역사문화환경보존지역 · 상대보호구역 · 가로구역별 최고높이 제한지역 · 건축허가·착공제한지역 등 311가지. "
           "모르는 이름을 걸면 가까운 이름을 알려 준다",
}


def _entry_schema(enums: dict[str, list[str]]) -> tuple[dict, list[str]]:
    """이름 사전 → `조건` 항목의 스키마. `model_filters` 가 낸 낱개 속성(갈래값·설명이
    붙은 것)을 이름별로 접는다. **한 표에서 나오므로 조건 쪽과 칸 쪽이 갈라질 수 없다.**"""
    flat, dropped = model_filters(Filters.model_json_schema(), enums)
    props: dict[str, dict] = {
        "대상": {"type": "string", "enum": ["건물", "나대지"],
                "description": "이 조건이 무엇을 찾나. 안 주면 건물. "
                               "나대지는 지목이 「대」이고 건물이 안 붙은 필지다. "
                               "연면적·층수·주용도·입주업체·가격을 못 건다"},
    }
    for k in _SCOPE[1:]:                               # 지역·법정동코드·건물번호·필지번호·주소
        if k in flat:
            props[k] = flat[k]

    for name, v in _ENTRY.items():
        inner: dict[str, dict] = {}
        desc = ""
        if v["kind"] == "수":
            for f, side in zip(v["f"], (v.get("lo"), v.get("hi")) if len(v["f"]) == 2
                               else (v.get("lo") or v.get("hi"),)):
                if not side:
                    continue
                sp = flat.get(names.FILTER_KO.get(f, ""), {})
                inner[side] = {"type": "number"}
                desc = desc or (sp.get("description") or "")
        elif v["kind"] == "목록":
            sp = flat.get(names.FILTER_KO.get(v["f"][0], ""), {})
            desc = sp.get("description") or ""
            # `_shapes` 가 만든 세 가지(평평·DNF·있음/없음)를 그대로 옮긴다
            br = [b for b in (sp.get("anyOf") or [sp]) if b.get("type") != "null"]
            arr = [b for b in br if b.get("type") == "array"]
            obj = next((b for b in br if b.get("type") == "object"), None)
            if arr:
                inner["값"] = arr[0] if len(arr) == 1 else {"anyOf": arr}
            elif br:
                inner["값"] = br[0]
            if obj and "없음" in (obj.get("properties") or {}):
                inner["없음"] = obj["properties"]["없음"]
        if v["col"] and v["kind"] != "보기만":
            ko_col = names.ko(v["col"])
            if ko_col != name:
                desc = (desc + f" 걸면 줄엔 「{ko_col}」이 실린다.").strip()
        if name == "지목":
            desc = (desc + " 안 걸면 " + "·".join(_PUBLIC_JIMOK) + "는 뺀다(팔 수 없는 땅). "
                    "보려면 여기에 걸어라.").strip()
        if name in _VIEW_DESC:
            desc = (desc + " " + _VIEW_DESC[name]).strip()
        o: dict[str, Any] = {"type": "object", "properties": inner}
        if desc:
            o["description"] = desc
        if name == "입주업체":
            # 저장된 칸이 없다. 무엇을 검색할지 안 주면 뜻이 없어 **구조로 막는다.**
            o["required"] = ["값"]
        props[name] = o
    return props, dropped


def _search_schema(enums: dict[str, list[str]]) -> tuple[dict, list[str]]:
    props, dropped = _entry_schema(enums)
    # 세울 수 있는 이름 — 줄에 실리는 칸이 있는 것만. 「지역」이나 「입주업체」로는 못 센다.
    # 같은 칸을 **같은 방향으로** 세우는 이름이 둘이면 칸 이름 하나만 둔다(공실/공실면적 ·
    # 사진있음/사진). 나이 이름은 방향이 반대라 날짜 이름과 따로 남는다
    own = {v["col"]: n for n, v in _ENTRY.items()
           if isinstance(v["col"], str) and n not in _AGE_SORT and n == names.ko(v["col"])}
    sortable = sorted(n for n, v in _ENTRY.items() if v["col"] and n not in _NO_SORT
                      and (n in _AGE_SORT or not isinstance(v["col"], str) or own.get(v["col"], n) == n))
    return {
        "type": "object",
        "properties": {
            # 조건끼리는 AND 다. 「A 이거나 B」는 조건을 둘 줘서 한 바퀴에 돌린다.
            #
            # **모양은 하나다 — 늘 목록이다.** 전에는 하나면 `{…}`, 여럿이면 `[{…},{…}]` 로
            # 둘을 받았는데, 목록 가지엔 토큰을 아끼려고 속성을 안 실었다. 그래서 모델이
            # 갈래를 나누려고 목록을 고르는 순간 **채울 이름이 하나도 안 보였고**, 빈
            # `[{}, {}]` 를 보내 첫 바퀴를 통째로 날렸다(2026-09-21 실측 10,862자).
            # 가지를 없애면 고를 일이 없고, 그 하나에 이름이 다 적혀 있다.
            #
            # **이름 하나에 손잡이가 달린다.** 걸 조건과 볼 칸을 따로 두지 않는다 —
            # 두 사전이 같은 개념을 다르게 불러 모델이 조건 이름을 칸에 적고 바퀴를
            # 버렸다(2026-09-21). 이름을 대면 보이고, 손잡이를 달면 걸린다.
            "조건": {
                "type": "array",
                "items": {"type": "object", "properties": props},
            },
            # 정렬이 없으면 「주차 넓은 건물」에 임의 문턱(`주차대수_이상: 5`)을 지어내거나,
            # 조건을 더 걸어 개수를 줄이며 검색을 네 번 돈다(2026-09-19 실측 in 157,645).
            # **기본값을 두지 않는다.** 결과는 예산만큼 잘려 나가므로 무엇으로 세우느냐가
            # 곧 모델이 보는 것을 정한다. 기본이 「추정가 큰 순」이면 「신축하기 좋은 곳」에
            # 코엑스와 롯데가 올라온다(2026-09-21 실측). 기준은 물음이 정해야 한다.
            "정렬": {
                "type": "string",
                "description": "이 이름으로 세운다. 결과는 잘려 나가니 물음에 맞는 것을 골라라",
                "enum": sortable,
            },
            "차순": {"type": "string", "enum": ["내림차순", "오름차순"],
                    "description": "내림차순은 큰 것부터, 오름차순은 작은 것부터"},
            "범위": {
                "type": "string",
                "description": "한쪽만 본다. 안 주면 둘 다",
                "enum": ["내매물", "일반"],
            },
        },
        "required": ["조건", "정렬", "차순"],
    }, dropped


def _shape(raw: dict, want: list[str] | None = None, *, full: int | None = None,
           slim_keys: set[str] | None = None, sort_key: str | None = None,
           asc: bool = False) -> dict:
    """화면용 응답을 모델용으로 바꾼다. **값을 다시 계산하지 않는다** — 이름을 갈고,
    안 읽는 것을 걷고, 팀 값을 한 묶음으로 내릴 뿐이다.

      · `mine`/`normal` 을 **`내매물`·`일반` 두 목록으로 낸다.** 합쳐 놓으면 어느 조건이
        어느 쪽에 걸렸는지가 사라진다 — 팀 조건은 `내매물` 에만 걸리므로(search.for_model),
        「명도 가능」을 걸고 `내매물` 0 · `일반` 29 를 받으면 그 29동은 명도를 안 본 것이다.
        한 목록으로 뭉치면 29동이 전부 명도 가능으로 읽힌다(2026-09-19 실측).
      · `내매물` 은 0건이어도 낸다. 안 내던 것이 위 사고의 원인이다
      · `sale_price: null` 이 58만 줄에 → 줄 안의 팀 값은 「내매물」 묶음으로. 빈 칸을 보여 주면
        모델이 「정확한 가격은 모릅니다」로 답한다. 자료가 없는 게 아니라 구멍을 보여 준 것이다
      · `page`/`pages` 는 안 낸다. 모델은 페이지를 안 넘긴다
      · 칸 이름은 한국어. 단위는 줄마다 말고 맨 앞 `단위` 한 줄에(실측: 영어+접미사보다 싸다)"""
    # 입주업체는 **걸린 낱말을 이름으로, 값은 상호명**으로 낸다. 「업종수: 1」이라고 주니 모델이
    # 그게 병원 수라는 걸 못 잇고 주용도(근생)만 보고 「병원 건물이 아니네요」라고 답했다(09-19).
    # 이름까지 주면 건물을 열어 층별에서 확인하는 바퀴가 사라진다 — 실측 왕복 4 중 2가 그것이었다.
    biz_names: dict[str, dict[str, list[str]]] = raw.get("biz_names") or {}
    word = next((m.get("낱말") for m in (raw.get("biz") or []) if m.get("낱말")), None)

    def rows(col: str) -> list[dict]:
        out: list[dict] = []
        for r in (raw.get(col) or {}).get("items") or []:
            row: dict[str, Any] = {}
            team: dict[str, Any] = {}
            for k, v in r.items():
                if k in names.DROP or v is None or v == []:   # 빈 것은 안 보낸다
                    continue
                if k == "biz_n":
                    if v and word:
                        row[word] = v                  # 화면용 biz 로 걸었을 때(숨긴 칸)
                    continue
                if k == "float_pop":                   # 한 이름에 두 수. 명/일, 소수는 뜻이 없다
                    row["유동인구"] = {"주간": round(v), "야간": round(r["float_pop_night"])
                                    if r.get("float_pop_night") is not None else None}
                    continue
                if k == "full_est":                    # 칸으로는 안 보내고 이름을 가른다(아래)
                    continue
                # 만실 두 칸은 공실 평당가에 추정이 섞였으면 **이름**에 「추정」을 붙인다(0181).
                # 칸 하나를 더 보내 「이건 추정」이라 알리면 모델이 값과 따로 읽는다
                ko = ("추정" + names.ko(k)) if k in _FULL and r.get("full_est") else names.ko(k)
                (team if k in names.LISTING else row)[ko] = v
            for w, by_pk in biz_names.items():      # 「병원: [일등플란트치과의원]」
                got = by_pk.get(r.get("building_pk"))
                if got:
                    row[w] = got
            if team:
                row["내매물"] = team
            out.append(row)
        return out

    def sort_val(r: dict):
        if sort_key == "가격":                          # 별칭 price = 매매가 ?? 추정가
            return (r.get("내매물") or {}).get("매매가") or r.get("추정가")
        return r.get(sort_key) if sort_key else None

    def block(col: str) -> dict:
        """세 겹이다(2026-09-21). ① 자세한 줄은 예산까지 ② 그 뒤는 걸린 칸만 단 줄
        ③ 그래도 남으면 「이 값부터 N건 더」 한 줄. 잘린 것이 있다는 숫자만 주면 모델이
        그게 봐야 할 것인지 판단할 길이 없다. 걸린 칸만 있어도 「얼마짜리 무슨 학원」은 보인다."""
        items = rows(col)
        total = (raw.get(col) or {}).get("total", 0)
        b: dict[str, Any] = {"전체": total}
        head = items if full is None else items[:full]
        tail = [] if full is None else items[full:]
        if len(head) < total:                           # 다 안 보냈을 때만 말한다
            b["보여준수"] = len(head)
        b["목록"] = head
        if tail:
            keep = {"건물번호", "필지번호"} | (slim_keys or set()) | set(biz_names)
            if word:
                keep.add(word)
            if sort_key == "가격":
                keep |= {"추정가", "내매물"}           # 별칭 price 가 읽는 자리
            elif sort_key:
                keep.add(sort_key)
            b["나머지"] = [{k: v for k, v in r.items() if k in keep} for r in tail]
        shown = len(head) + len(tail)
        if shown < total and items:
            gap: dict[str, Any] = {"건수": total - shown}
            v = sort_val(items[-1])
            if sort_key and v is not None:
                gap[sort_key] = f"{v} {'이상' if asc else '이하'}"
            b["안보인"] = gap
        return b

    out: dict[str, Any] = {}
    if raw.get("matched"):
        out["지역"] = raw["matched"]      # 「종로구」를 무엇으로 읽었는지 — 모호함을 푼다
    if raw.get("biz_cut"):
        # 카카오 한 질의 45건 상한에 걸려 버린 게 있다. 중간 계산(카카오 42 · 건물 93)은
        # 안 낸다 — 숫자끼리 안 맞고 실제 결과는 넷째 숫자였다. 잘렸다는 사실만 말한다.
        ws = " · ".join(raw["biz_cut"])
        out["경고"] = f"{ws} 검색이 카카오 상한에 걸렸다. 결과가 전부가 아닐 수 있다"
    out["내매물"] = block("mine")         # 우리 것이 먼저 — 중개인은 자기 것을 먼저 본다
    out["일반"] = block("normal")
    # **달라고 했는데 한 줄도 안 채워진 칸은 이름을 낸다.** 빈 칸을 안 보내는 건 맞지만,
    # 안 왔다는 말이 없으면 모델이 조건을 건 것으로 읽는다 — 「명도 가능」을 걸고 받은 29동을
    # 전부 명도 가능으로 읽던 자리다(2026-09-19 실측).
    seen: set[str] = set()
    rows_any = False
    for blk in (out["내매물"], out["일반"]):
        for row in blk["목록"] + blk.get("나머지", []):
            rows_any = True
            seen |= set(row)
            seen |= set(row.get("내매물") or {})
            seen |= {k.removeprefix("추정") for k in row.get("내매물") or {}}
    # **줄이 하나도 없으면 안 적는다.** 0건인데 「이 칸들이 안 왔다」는 말은 뜻이 없다.
    if rows_any and (miss := [f for f in (want or []) if f not in seen]):
        out["안 온 칸"] = miss
    return out


# 목록 조건이 받는 세 모양. 값이 여럿인 칸은 안쪽 AND 가 뜻을 갖고, 하나뿐인 칸은 0이 된다.
#   ["A","B"]                     A 또는 B                    ← 흔한 경우. 지금과 같다
#   [["A","B"], ["C"]]            (A 그리고 B) 또는 C
#   {"있음": …, "없음": ["D"]}     거기서 D 든 것을 뺀다
# DNF 를 안쪽에서 쓰는 칸은 둘뿐이다. 나머지는 한 필지에 값이 하나뿐이라 안쪽에 둘을 넣으면
# 언제나 0이므로, 그대로 0을 내지 않고 짚어 준다.
_DNF_OK = frozenset({"use", "biz_dnf"})      # 안쪽 AND 가 뜻을 갖는 칸(부분일치·다중값)


def _one_group(v: Any) -> list[list[str]]:
    """값을 DNF 로 편다. 맨 목록은 [[A],[B]] 가 된다."""
    if not isinstance(v, list):
        return [[str(v)]]
    if v and all(isinstance(x, list) for x in v):
        return [[str(w) for w in g] for g in v]
    return [[str(x)] for x in v]


def _unpack(cond: dict[str, Any]) -> tuple[dict[str, Any], dict[str, list[str]]]:
    """모델이 보낸 조건을 (Filters 인자, 아님) 으로 가른다. 이름은 이미 영문이다."""
    out: dict[str, Any] = {}
    nots: dict[str, list[str]] = {}
    for k, v in cond.items():
        has, no = v, None
        if isinstance(v, dict):
            has, no = v.get("있음"), v.get("없음")
        if no:
            vals = [str(x) for x in (no if isinstance(no, list) else [no])]
            if k == "biz_dnf":
                out["biz_not"] = vals      # 카카오라 SQL 이 아니라 집합으로 뺀다
            else:
                nots[k] = vals
        if has is None or has == []:
            continue
        if k in _DNF_OK:
            out[k] = _one_group(has)
            continue
        groups = _one_group(has) if isinstance(has, list) else None
        if groups and any(len(g) > 1 for g in groups):
            raise ValueError(
                f"「{_ENTRY_BY_FILTER.get(k, k)}」는 한 건물에 값이 하나뿐이라 안쪽 묶음에 둘을 넣을 수 없다. "
                f"「또는」으로 나열해라: {{\"값\": [\"A\",\"B\"]}}")
        out[k] = [g[0] for g in groups] if groups else has
    return out, nots


# 나대지에 되는 묶음. 층별·필지는 건물 것이다.
_VACANT_SEC = frozenset({"시간대별유동인구", "상권구성", "주변동향", "주변실거래", "주변매각"})

# 팔 수 없는 땅의 지목. **모델용 검색에서만 기본으로 뺀다**(2026-09-22 대표).
# 「용적여유 큰 순」에 봉익동 67(지목 공원, 대지 3,027㎡·건물 253㎡)이 1등으로 올라
# 「신축 알짜」로 소개됐다. 모델이 `지목` 을 직접 걸면(있음이든 없음이든) 그 말을 따른다.
# 학교용지·종교용지는 안 뺀다 — 가끔 거래된다. 검색 화면은 이 규칙이 없다(사람이 칩으로 거른다).
_PUBLIC_JIMOK = ("공원", "도로", "하천", "제방", "구거", "유지", "철도용지", "묘지", "수도용지", "사적지")


async def _attach(block: dict, secs: dict[str, dict], vacant: bool,
                  user: CurrentUser) -> None:
    """검색 줄에 묶음을 붙인다. **줄마다 질의가 도니** 예산이 이미 줄 수를 줄여 놓았다
    (`_rows_for` 의 `sec_tok`). 한 줄이 죽어도 나머지는 준다."""
    rows = [r for col in ("내매물", "일반") for r in (block.get(col) or {}).get("목록", [])]
    keys = [k for k in secs if not vacant or k in _VACANT_SEC]
    if not rows or not keys:
        return

    async def fill(r: dict) -> None:
        pk = r.get("건물번호") or r.get("필지번호")
        for k in keys:
            try:
                if v := await _section(pk, k, secs[k], user, vacant=vacant):
                    r[k] = v
            except Exception as e:                  # noqa: BLE001
                r[k] = {"오류": str(e)[:120]}

    await asyncio.gather(*(fill(r) for r in rows))
    # **어림이 틀려도 예산은 지킨다.** `_sec_chars` 는 중앙값 기반 어림이라 소식이
    # 몰린 동네에선 열 배까지 어긋난다. 붙인 뒤 다시 재서 넘치면 줄을 버리고 말한다.
    limit = int(_BUDGET * _CHARS_PER_TOK)
    used = 0
    for col in ("내매물", "일반"):
        blk = block.get(col) or {}
        keep = []
        for r in blk.get("목록") or []:
            n = len(json.dumps(r, ensure_ascii=False, default=str))
            if keep and used + n > limit:
                break
            keep.append(r); used += n
        if len(keep) < len(blk.get("목록") or []):
            blk["보여준수"] = len(keep)
        blk["목록"] = keep


async def _run_search(args: dict[str, Any], user: CurrentUser) -> Any:
    """같은 프로세스 안에서 우리 핸들러를 그대로 부른다. HTTP 로 자기를 다시 안 부른다.
    화면이 보는 것과 **같은 함수**라 답이 갈라질 자리가 없다.

    **조건을 여럿 받는다.** 조건끼리는 AND 로 묶이므로 「입주업체가 병원이거나 주용도가
    의료시설」 같은 물음은 한 조건으로 못 쓴다. 조건을 둘 주면 한 바퀴에 둘 다 돈다 —
    바퀴가 비용의 단위고, 바퀴마다 스키마 7,500토큰이 다시 실린다(2026-09-20 실측)."""
    raw_c = args.get("조건")
    conds = raw_c if isinstance(raw_c, list) else [raw_c or {}]
    conds = [c for c in conds if isinstance(c, dict)]
    # `[]` 는 「검색 안 함」이지 「조건 없음」이 아니다. 조용히 `[{}]` 로 바꿔 읽으면
    # 서울 전체 58만이 돌아온다 — 물은 적 없는 답이다. 조건 없이 훑으려면 `[{}]` 라고 쓴다.
    if not conds:
        raise ValueError("조건이 없다. 조건 없이 전체를 훑으려면 `[{}]` 라고 줘라")
    if len(conds) > _SEARCH_MAX:
        raise ValueError(f"한 번에 검색 {_SEARCH_MAX}개까지다({len(conds)}개를 달랬다) — "
                         f"더 쪼개면 검색마다 {_ROWS_MIN}줄도 못 준다")
    # 빈 조건은 **하나일 때만** 뜻이 있다(「서울에서 용적여유 제일 큰 곳」). 여럿에 섞이면
    # 그 하나가 나머지를 다 삼켜 서울 전체가 한 벌 더 붙는다. 같은 조건을 두 번 다는 것도
    # 같은 답을 두 벌 내는 것이다 — 조용히 합치지 않고 짚는다(2026-09-21 실측: `[{}, {}]`).
    if len(conds) > 1 and any(not c for c in conds):
        raise ValueError("조건 하나가 비어 있다. 빈 조건은 나머지를 다 삼키니 "
                         "따로 걸 것이 없으면 조건을 하나만 줘라")
    seen_c: list[dict] = []
    for c in conds:
        if c in seen_c:
            raise ValueError(f"같은 조건을 두 번 달랬다: {c}. 같은 답이 두 벌 온다")
        seen_c.append(c)

    # `칸` 인자는 없어졌다. 조건에 이름을 대면 그게 곧 줄에 실릴 칸이다.
    # 조건마다 이름이 다를 수 있으니 예산은 **합집합**으로 잡는다.
    parsed = [_from_entries(c) for c in conds]
    fields = sorted({f for _fl, _n, fs, _t, _s, _c in parsed for f in fs})
    want = [names.ko(f) for f in fields]

    # 정렬·차순은 **필수**다. 없다고 기본으로 떨어뜨리면 그 기본이 답을 정해 버린다.
    srt = args.get("정렬") or ""
    _SORT_COL = {n: v["col"] for n, v in _ENTRY.items() if v["col"] and n not in _NO_SORT}
    if not srt:
        raise ValueError("정렬이 없다. 결과는 잘려 나가니 무엇으로 세울지 골라야 한다. "
                         f"고를 수 있는 이름: {sorted(_SORT_COL)}")
    if srt not in _SORT_COL:
        near = difflib.get_close_matches(srt, _SORT_COL, n=3, cutoff=0.5)
        raise ValueError(f"「{srt}」로는 못 센다."
                         + (f" 혹시 {' · '.join(near)}?" if near else
                            f" 고를 수 있는 이름: {sorted(_SORT_COL)}"))
    asc = args.get("차순") or ""
    if asc not in ("내림차순", "오름차순"):
        raise ValueError("차순이 없다. 「내림차순」(큰 것부터) 또는 「오름차순」(작은 것부터)")
    scope = {"내매물": "mine", "일반": "normal"}.get(args.get("범위") or "", "")
    # 나대지에 있는 조건. 건물 조건과 이름이 겹치는 것만 골라 둔 것이다.
    _V_OK = set(_VACANT_ANY) | set(_VACANT_COL) | {"region", "bjd_code"}
    # 검색이 여럿이면 예산을 나눈다 — 안 나누면 세 검색 × 두 목록이 그대로 곱해진다.
    # 묶음은 줄마다 질의가 한 번씩이라 **줄 수를 크게 줄인다.** 조건마다 묶음이 다를 수
    # 있으니 제일 무거운 조건으로 잡는다 — 넉넉히 잡으면 어느 조건에선 예산을 넘는다.
    sec_tok = max((sum(_sec_chars(k, o) for k, o in sc.items()) for *_r, sc, _c in parsed),
                  default=0) / _CHARS_PER_TOK
    per = _rows_for(len(fields), len(conds), int(sec_tok))
    # **잘린 줄은 걸린 칸만 달고 남은 예산까지 더 낸다.** 「학원 + 60~100억」이 37건인데
    # 25건만 보이고 12건은 있다는 숫자만 왔다(2026-09-21 실측). 자세한 줄이 예산을 거의
    # 다 쓰지만 걸린 칸만 단 줄은 서너 배 싸서, 남은 자투리에 열 줄쯤 들어간다.
    # 묶음이 붙는 검색엔 안 낸다 — 묶음은 줄마다 질의라 슬림 줄도 질의가 된다.
    budget = _BUDGET // max(1, len(conds))
    n_cond = max((len(c) for *_r, c in parsed), default=0)
    slim_tok = _ROW_SLIM + _PER_COL * n_cond
    # 「남은 예산까지」는 산술적으로 늘 한 줄 미만이다 — per 가 예산÷줄값이라 나머지가
    # 줄값보다 작다(첫 구현에서 슬림 줄이 2개 나왔다). 그래서 슬림 줄엔 **같은 예산을 한 번
    # 더** 준다. 새 숫자가 아니라 있는 숫자를 두 번 쓰는 것이고, 슬림 줄은 서너 배 싸서
    # 그 안에 자세한 줄의 세 배가 들어간다. 잘린 게 없으면 한 줄도 안 나가 값이 안 든다.
    extra = 0 if sec_tok else budget // slim_tok

    async def one(asked: dict, got: tuple) -> dict:
        # 「대상」은 조건 안에 있다. 「신축 가능한 곳」은 답이 둘이라(빈 땅 · 헐 건물)
        # 한 바퀴에 둘을 같이 물을 수 있어야 한다(2026-09-20).
        flat, nots, my_fields, target, my_secs, my_cond = got
        # 건물에 `필지번호` 를 걸면 지금까지 **조용히 무시되고 58만이 나왔다**(2026-09-21).
        # 나대지 전용 조건이다. 건물은 `건물번호` 로 집는다.
        if target == "building" and "pnu" in flat:
            raise ValueError("「필지번호」는 나대지에만 쓴다. 건물은 「건물번호」로 집는다. "
                             "빈 땅을 찾는 거면 그 조건에 대상:「나대지」를 같이 걸어라")
        # **이름 사전으로 말한다.** 합친 뒤에도 여기만 옛 이름(`역거리_이하`)을 뱉어
        # 모델이 무엇을 고치라는 건지 알 수 없었다(2026-09-21 실측).
        if target == "vacant" and (bad := sorted({_ENTRY_BY_FILTER.get(k, k)
                                                  for k in flat if k not in _V_OK})):
            ok = sorted({_ENTRY_BY_FILTER[k] for k in _V_OK if k in _ENTRY_BY_FILTER})
            raise ValueError(f"나대지에는 {bad} 가 없다. 건물이 없는 필지라서다. "
                             f"걸 수 있는 이름: {ok}")
        if bad := [k for k in nots if k not in _NOT_COL]:
            raise ValueError(f"「{_ENTRY_BY_FILTER.get(bad[0], bad[0])}」에는 「없음」을 쓸 수 없다")
        if target == "building" and "jimoks" not in flat and "jimoks" not in nots:
            nots = {**nots, "jimoks": list(_PUBLIC_JIMOK)}     # 지목이 NULL 인 건물은 남는다(모름≠공원)

        # 칸·정렬은 대상마다 되는 것이 다르다. **없는 칸에 튕기지 않고 되는 것만 쓴다** —
        # 대상을 섞어 물으면 한쪽에만 있는 칸이 늘 생긴다. 안 온 것은 `안 온 칸` 이 말한다.
        f_ok = fields if target == "building" else [f for f in fields if f in _VACANT_FIELDS]
        # 「가격」은 매매가 OR 추정가 OR 매도희망가라 칸이 하나가 아니다. 세울 땐 화면과 같은
        # 별칭 `price`(매매가 ?? 추정가)로 세운다. `sale_price` 로 넘기면 search 가 몰라서
        # 조용히 기본(내림차순)으로 떨어졌다(2026-09-21 실측: 오름차순을 달래도 내림차순).
        s_ok = "price" if srt == "가격" else _SORT_COL[srt]
        col_asc = (asc == "오름차순") != (srt in _AGE_SORT)     # 나이 이름은 날짜 칸을 거꾸로
        fell = ""
        if target == "vacant" and s_ok not in _VACANT_FIELDS:
            # 나대지엔 그 칸이 없어 search_vacant 가 대지면적으로 떨어뜨린다. **떨어뜨렸다고
            # 말한다** — 물은 것과 다른 줄을 주면서 가만있으면 모델이 제 기준으로 읽는다.
            s_ok, fell = "price", "대지면적"

        # 세운 칸은 줄에 싣는다. 잘린 줄의 경계(「이 값부터 N건 더」)를 말하려면 그 값이
        # 있어야 하고, 모델도 무엇으로 세웠는지 값으로 본다. 별칭 price 는 추정가가 늘 있다.
        okc = _FIELDS_OK if target == "building" else set(_VACANT_FIELDS)
        if s_ok in okc and s_ok not in f_ok:
            f_ok = [*f_ok, s_ok]
        if target == "building":
            # 좌표는 화면 핀용. 모델 쪽 줄에선 names.DROP 이 걷는다
            f_ok = [*f_ok, *(c for c in ("lng", "lat") if c not in f_ok)]
            if "float_pop" in f_ok:                    # 「유동인구」 칸은 주간·야간 둘이다
                f_ok = [*f_ok, "float_pop_night"]
        body = SearchIn(
            filters=Filters(nots=nots or None, **flat),
            fields=f_ok,
            sort=s_ok,
            sort_asc=col_asc,
            only=scope,
            target=target,
            per_page=per + extra,
            for_model=True,   # 팀 조건은 내매물에만 · 내매물 = 우리 팀 매물 전부(담당 배정 무관)
        )
        my_want = want if target == "building" else [w for w in want if _FIELDS_MODEL.get(w) in _VACANT_FIELDS]
        slim_keys = {names.ko(c) for c in my_cond}
        sort_key = "가격" if srt == "가격" else (fell or names.ko(s_ok))
        raw = await search(body, user)
        _collect_pins(raw, target == "vacant")
        out = _shape(raw, my_want, full=per, slim_keys=slim_keys,
                     sort_key=sort_key, asc=col_asc)
        if fell:
            out = {"정렬": fell, **out}      # 나대지엔 그 칸이 없어 이걸로 세웠다
        if my_secs:
            await _attach(out, my_secs, target == "vacant", user)
        if len(conds) > 1:
            # 어느 조건이 어느 결과를 냈는지 — 둘을 섞어 읽으면 답이 갈린다.
            # **물은 그대로** 돌려준다(대상까지) — 우리가 꺼낸 뒤 것을 주면 되짚기가 안 된다.
            return {"조건": asked, **out}
        return out

    got = await asyncio.gather(*(one(c, pr) for c, pr in zip(conds, parsed, strict=True)),
                               return_exceptions=True)
    # 하나뿐인데 죽었으면 **그대로 올린다.** 줄 안에 묻으면 모델이 오류를 결과로 읽는다.
    # 여럿이면 하나가 죽어도 나머지는 준다 — 줄마다 조건이 붙어 있어 어느 것이 죽었는지 보인다.
    if len(conds) == 1 and isinstance(got[0], BaseException):
        raise got[0]
    rows = [g if isinstance(g, dict) else {"조건": c, "오류": str(g)[:300]}
            for c, g in zip(conds, got, strict=True)]
    # **하나를 물어도 목록으로 낸다.** 개수에 따라 모양이 바뀌면 모델이 둘을 외워야 한다.
    return {"단위": names.UNITS, "검색": rows}


_BUILDING_DESC = (
    "건물이나 나대지를 본다. 응답은 `건물` 목록이다. 검색을 거치지 않고 바로 불러도 된다 — 검색 줄에 있던 값이 「대장」에 다 있다. "
    "**여러 채가 궁금하면 `건물번호`에 한꺼번에 넣어라.** 한 채씩 따로 부르면 그만큼 느리고 비싸다. "
    "`함께` 로 목록을 고른다(층별·임대내역·입주이력·필지·주변실거래·주변매각·유동인구·주변동향·임대추이·버스정류장·지하철역·공시지가추이·실거래이력). 안 주면 대장만 온다 — 한 채에 목록이 백 줄 넘게 붙어서다. "
    "`임대내역`은 우리 매물일 때만 온다(호실·임대료·공실면적). 우리 매물이 아니면 임대는 추정뿐이다. "
    "`주변동향`은 가까운 20줄만 오고 `전체`가 몇인지 같이 온다. 더 좁히려면 `함께`를 객체로 준다. "
    f"단위는 {names.UNITS}."
)


def _clean(o: Any, nested: bool = False, sec: str = "") -> Any:
    """이름을 한국어로 갈고 빈 것·안 읽는 것을 걷는다. **값은 안 고친다.**

    `sec` 는 묶음 이름이다. 같은 `name` 이 층별에선 상호명이고 소식에선 제목이라
    묶음마다 다르게 옮겨야 한다(names.KO_BY_SECTION)."""
    per = names.KO_BY_SECTION.get(sec, {})

    def nm(k: str) -> str:
        return per.get(k) or (names.kon(k) if nested else names.ko(k))

    if isinstance(o, dict):
        out = {}
        for k, v in o.items():
            if (k in names.DROP or k in names.LEDGER_DROP or k in names.NESTED_DROP
                    or v is None or v == [] or v == {}):
                continue
            out[nm(k)] = _clean(v, nested=True, sec=sec)
        return out
    if isinstance(o, list):
        return [_clean(x, nested=True, sec=sec) for x in o]
    return o


def _floor_label(fl: str | None) -> str | None:
    """층 이름을 **한 벌로** 쓴다. 팀 줄은 「1」·「B1」, 대장은 「1층」, 원장은 「지하-1층」 이라
    한 목록 안에서 같은 층이 둘로 보였다(2026-09-25). 못 읽는 이름은 그대로 둔다."""
    n = flr._sfloor(fl)
    if n is None:
        return fl
    if n >= 900:
        return f"옥탑{n - 900}층"
    return f"지하{-n}층" if n < 0 else f"{n}층"


# 만실 두 칸(0181) — full_est 면 이름 앞에 「추정」이 붙는다
_FULL = frozenset({"rent_full", "roi_full"})

# 합계가 읽는 곳 — 팀 값의 정본이다(0173). 층별 줄이 있으면 mirror 가 여기로 접어 둔다.
_TOTAL_SQL = ("SELECT total_deposit, total_rent, total_mgmt, vacant_area, roi, rent_full, roi_full, full_est"
              "  FROM app.listings WHERE building_pk = $1 AND team_id = $2 ORDER BY id LIMIT 1")


def _floors_for_model(raw: dict) -> dict:
    """층별 — 대장과 업체 원장만(2026-09-26 나눔). 모든 건물에 같은 모양으로 온다.

      층 · 바닥면적 · 용도 · 전유부   대장(층별개요 + 전유부)
      업체                            원장(인허가·상가정보) + 카카오. 누가 있다는 것만

    임대료·공실은 여기 없다 — 우리 매물이면 「임대내역」 묶음에만 있다. 빈 칸 투성이 임대 칸을
    모든 건물에 붙이면 모델이 「0원」·「만실」로 읽는다.
    **전유부는 참조다.** 대장 호실은 등기 단위라 실제 칸(업체 단위 호실)과 다르다."""
    out: list[dict] = []
    for g in raw.get("floors") or []:
        row: dict[str, Any] = {"층": _floor_label(g.get("floor"))}
        if g.get("floor_area"):
            row["바닥면적"] = round(g["floor_area"], 2)     # 164.32999999999998 이 그대로 나갔다
        if g.get("uses"):
            row["용도"] = g["uses"]
        if g.get("rooms"):
            # 용도는 안 싣는다 — 49.3만 층 중 용도가 갈리는 층이 2.5만(5%)뿐이라 층 용도와 겹친다
            row["전유부"] = [{"전용면적": round(r["excl_area"], 2),
                           **({"공용면적": round(r["common_area"], 2)} if r["common_area"] else {})}
                          for r in g["rooms"]]
        if g.get("ledger"):
            row["업체"] = [_clean({k: v for k, v in u.items() if k != "floor"}, nested=True) for u in g["ledger"]]
        out.append(row)
    res: dict[str, Any] = {}
    if out:
        res["층"] = out
    if raw.get("unknown"):
        res["층미상"] = [_clean({k: v for k, v in u.items() if k != "floor"}, nested=True) for u in raw["unknown"]]
    return res


def _ledger_for_model(raw: dict, total: dict) -> dict:
    """임대내역 — 우리 매물의 호실 줄(0185). 호실은 **업체 단위**이고 상태는 저장값이 아니라 판정이다:
    상호가 있거나 임대료가 적혀 있으면 임대중, 둘 다 없으면 공실.

    합계는 `app.listings` 에서 온다(0173) — 총액만 손으로 적은 매물도 합계가 선다.
    공실면적은 **적힌 공실 호실의 합**이다(0186). 적힌 공실이 없으면 칸이 없다 — 만실이라는 뜻이 아니다.
    호실이 그 층의 전부인지는 모른다. 만실 월임대는 「적힌 공실이 다 차면」이다."""
    def unit(u: dict) -> dict:
        d = {"상호": u.get("tenant_name"), "호수": u.get("unit_no") or None,
             "상태": "임대중" if u.get("occupied") else "공실",
             "계약면적": round(u["contract_area"], 2) if u.get("contract_area") else None,
             "보증금": u.get("deposit"), "월임대": u.get("rent"), "관리비": u.get("maintenance")}
        return {k: v for k, v in d.items() if v is not None}
    res: dict[str, Any] = {}
    est = bool(total.get("full_est"))
    got = {("추정" if est and k in _FULL else "") + names.kon(k): v
           for k, v in total.items() if v is not None and k != "full_est"}
    if got:
        res["합계"] = got
    floors = []
    for g in raw.get("floors") or []:
        if not g.get("units"):
            continue                                   # 호실 없는 층 — 모른다. 줄을 세우지 않는다
        row: dict[str, Any] = {"층": _floor_label(g["floor"]), "호실": [unit(u) for u in g["units"]]}
        if g.get("vacant_area") is not None:
            row["공실면적"] = round(g["vacant_area"], 2)
        floors.append(row)
    if floors:
        res["층"] = floors
    if raw.get("unknown"):
        res["층미상"] = [unit(u) for u in raw["unknown"]]
    return res


# ── 묶음 퍼 오기 ────────────────────────────────────────────────────────────
# `_run_building` 안에 갇혀 있던 것을 꺼냈다(2026-09-21). 검색 줄에도 묶음을 붙이려면
# 두 곳에서 같은 함수를 불러야 하고, 복제하면 한쪽만 고쳐질 자리가 생긴다.
_LIST_MAX = 20      # 한 묶음이 낼 줄 수. 소식·매각 둘 다


async def _section(pk: str, key: str, o: dict, user: CurrentUser,
                   vacant: bool = False):
    if key in ("시간대별유동인구", "상권구성"):
        # 한 원천(생활인구 격자 + 반경 600m 업체)을 둘로 갈라 낸다. 주간·야간은 「유동인구」 칸이 준다.
        r = dict(await (bld.vacant_pop if vacant else bld.building_pop)(pk, user))
        if key == "상권구성":
            return _clean(r.get("mix") or {}, nested=True, sec=key)
        return _clean({k: r.get(k) for k in ("hourly", "peak_hour", "days")}, nested=True, sec=key)
    if key == "입주이력":
        # 최근에 연 순서로 자른다 — 오래된 건물은 수십 줄이다. 전부 몇인지는 같이 낸다
        r = await flr.tenancy_history(pk)
        rows = sorted(r["items"], key=lambda x: str(x.get("open_on") or ""), reverse=True)
        sec: dict[str, Any] = {"전체": len(rows)}
        if len(rows) > _LIST_MAX:
            sec["보여준수"] = _LIST_MAX
        sec["목록"] = [{"층": _floor_label(x["floor"]) if x["floor"] else None, "상호명": x["name"],
                       "업종": x["biz"], "개업": x["open_on"], "폐업": x["close_on"],
                       # 「영업」은 신고상이다. 폐업 신고를 안 하면 남는다. **지금 있는지는 카카오로만 본다** —
                       # 확인되면 「지금 있음」, 안 되면 「모름」. 인허가 「영업」을 그대로 넘기지 않는다
                       "상태": x["state"] if x["state"] in ("폐업", "휴업")
                               else ("지금 있음" if x.get("now") else "모름")} for x in rows[:_LIST_MAX]]
        sec["목록"] = [{k: v for k, v in d.items() if v is not None} for d in sec["목록"]]
        if r["ecommerce"]:
            sec["통신판매업"] = r["ecommerce"]      # 줄로 안 세운다 — 주소만 올린 것이 섞인다
        return sec
    if key == "층별":
        return _floors_for_model(await flr.building_floors(pk, user))
    if key == "임대내역":
        total = await pool().fetchrow(_TOTAL_SQL, pk, user.team_id)
        if not total:
            return None                                 # 우리 매물이 아니다 — 묶음 자체가 없다
        return _ledger_for_model(await frt.list_rents(pk, user), dict(total))
    if key == "필지":
        return _clean(await bld.get_parcels(pk, user), nested=True, sec=key)
    if key == "주변실거래":
        return _clean(await mkt.nearby_sales(pk, int(o.get("반경") or 500),
                                             int(o.get("연수") or 5), 8, user),
                      nested=True, sec=key)
    if key == "임대추이":
        return _clean(await bld.rent_series(pk, user), nested=True, sec=key)
    if key == "주변매각":
        # nearby 는 화면용이라 좌표·폴리곤·층을 받는다. 우리는 건물번호로 중심을 잡아 넘긴다.
        g = await pool().fetchrow(
            "SELECT ST_Y(c) y, ST_X(c) x FROM ("
            "  SELECT geom c FROM master.buildings WHERE building_pk = $1"
            "  UNION ALL"
            "  SELECT ST_PointOnSurface(geom) FROM master.vacant_parcels WHERE pnu = $1) t", pk)
        if not g:
            return None
        body = mkt.NearbyIn(center_lat=g["y"], center_lng=g["x"],
                            radius_m=int(o.get("반경") or 500),
                            building_pk=None if vacant else pk)
        raw = await mkt.nearby(body, user)
        got = raw.get("sales") or []
        # `price` 는 names.DROP 에 있다 — 검색에선 추정가와 섞인 값이라 버리는 칸인데
        # 여기선 **실제 거래가**다. 이름을 바꿔 살린다.
        for r in got:
            if r.get("price") is not None:
                r["거래가"] = r.pop("price")
        sec = {"반경": raw.get("radius_m"), "전체": len(got)}
        if len(got) > _LIST_MAX:
            sec["보여준수"] = _LIST_MAX
        sec["목록"] = _clean(got[:_LIST_MAX], nested=True, sec=key)
        return sec
    if key == "주변동향":
        raw = await bld.area_events(pk, int(o.get("반경") or 700), o.get("갈래"),
                                    int(o["연수"]) if o.get("연수") else None, user)
        got = raw.get("items") or []
        sec = _clean({k: v for k, v in raw.items() if k != "items"}, nested=True, sec=key)
        sec["전체"] = len(got)
        if len(got) > _LIST_MAX:      # 자른 것은 **잘랐다고 말한다** — 전부로 읽으면 안 된다
            sec["보여준수"] = _LIST_MAX
        rows = _clean(got[:_LIST_MAX], nested=True, sec=key)
        # `연도` 는 `날짜` 와 겹친다(2026-08-26 / 2026). 줄당 11자라 20줄이면 220자다.
        # **날짜가 없을 때만 남긴다** — 정비구역 545건은 연도만 있어, 통째로 빼면
        # 그 줄이 시점을 잃는다(전에 한 번 그렇게 지웠다가 되돌렸다).
        for r in rows:
            if r.get("날짜"):
                r.pop("연도", None)
        sec["목록"] = rows
        return sec
    return None


async def _run_building(args: dict[str, Any], user: CurrentUser) -> Any:
    """건물을 본다 — 아홉 곳을 따로 부르던 것을 한 번에 묶는다.

    **여러 채를 한 번에 받는다.** 세 채를 따로 부르면 바퀴가 셋이고, 스키마 7,500토큰이
    바퀴마다 다시 실려 15,000토큰이 그냥 나간다(2026-09-20 실측). 제미나이가 한 응답에
    호출 여럿을 담기도 하지만 **그때그때 다르다** — 우리가 정할 수 있는 자리로 옮긴다.

    `함께` 를 안 주면 대장만 준다. 실측으로 한 채에 층 7 · 층미상 8 · 필지 3 ·
    주변실거래 8 · 시간대 24 · 버스 25 · 지하철 10 · 공시 37 이 붙어 백 줄이 넘는다."""
    raw_pk = args.get("건물번호")
    pks = [str(x).strip() for x in (raw_pk if isinstance(raw_pk, list) else [raw_pk])
           if str(x or "").strip()]
    if not pks:
        raise ValueError("건물번호 가 필요하다")
    # 채 수로 자르지 않는다 — 크기는 채 수가 아니라 `함께` 가 정한다(대장만 837자,
    # 묶음 전부를 붙이면 11,318자로 열세 배). 예산까지 담고 남은 것은 **몇 채를 못 줬는지 말한다.**
    # 다만 예산이 대장만으로도 못 담을 만큼 달래면 퍼 오기 전에 끊는다.
    cap = max(1, int(_BUDGET * _CHARS_PER_TOK) // _LEDGER_CHARS)
    if len(pks) > cap:
        raise ValueError(f"한 번에 {cap}채까지다. {len(pks)}채를 달랬다")

    # `함께` 는 목록도 객체도 받는다. 객체면 묶음마다 손잡이를 준다 —
    #   ["층별","주변동향"]                         지금과 같다
    #   {"주변동향": {"반경":250, "연수":1, "갈래":"정비·개발"}}
    raw_w = args.get("함께") or []
    opt: dict[str, dict] = raw_w if isinstance(raw_w, dict) else {}
    want = {w.strip() for w in (opt or raw_w) if w and w.strip()} & set(names.SECTIONS)

    # 소식은 반경 안의 것을 **전부** 낸다. 한 건물에 115줄 70,594자가 나와 대장(3,349자)의
    # 스무 배였다(2026-09-20 실측). 화면은 갈래 칩으로 걸러 보니 견디는데 모델은 통째로 받고,
    # 받은 뒤에는 바퀴마다 문맥에 다시 실린다. 그래서 여기서 자른다 — 반경·연수·갈래는
    # area_events 가 이미 받는 인자라 모델이 좁혀 부를 수도 있다.

    # 대장에 실려 오던 목록 넷. 여기서 떼어 `함께` 로만 낸다. 값은 이미 손에 있으므로
    # 다시 묻지 않는다 — `_sec` 처럼 질의를 또 날리면 같은 값을 두 번 읽는 셈이다.
    _HELD = ("버스정류장", "지하철역", "공시지가추이", "실거래이력")

    def _held_sec(key: str, v):
        """부르면 전부 준다. 좁히는 건 손잡이가 할 일이다."""
        o = opt.get(key) or {}
        if key in ("버스정류장", "지하철역"):
            rows = list(v or [])
            if (r := o.get("반경")):
                rows = [x for x in rows if (x.get("거리") or 0) <= int(r)]
            # 같은 이름이 여러 번 온다(「삼성역7번출구」가 셋). 가장 가까운 것만 남긴다 —
            # 이름이 같으면 모델에게 같은 자리고, 줄만 늘린다.
            seen: set = set()
            out = []
            for x in sorted(rows, key=lambda x: x.get("거리") or 0):
                nm = x.get("정류장명") or x.get("역명")
                if nm in seen:
                    continue
                seen.add(nm)
                out.append(x)
            return out[:int(o.get("줄수") or len(out))]
        if key in ("공시지가추이", "실거래이력"):
            rows = list(v or [])
            if (y := o.get("연수")):
                cut = dt.date.today().year - int(y)
                # 공시는 [연도, 값], 실거래는 {"ym": "202108", …} 다
                rows = [x for x in rows
                        if int(str(x[0] if isinstance(x, list) else x.get("ym", ""))[:4] or 0) >= cut]
            return rows[-int(o["줄수"]):] if o.get("줄수") else rows
        return v

    # 나대지는 건물이 없어 `pnu` 로 가리킨다. pnu 는 늘 19자리고 building_pk 는 8·9·10·14·22
    # 이라 길이로 갈린다(2026-09-20 실측). 검색이 내준 것을 못 여는 일이 없어야 한다.
    # 나대지에 되는 묶음. 반경 질의 셋은 `me` CTE 가 pnu 도 받게 넓혀서 이제 돈다
    # (buildings.area_events · market.nearby_sales · market.nearby, 2026-09-20).
    # 층별·필지는 건물 것이라 여전히 안 된다.
    _VACANT_SEC = {"시간대별유동인구", "상권구성", "주변동향", "주변실거래", "주변매각"}

    async def one_vacant(pnu: str) -> dict:
        row: dict[str, Any] = {"필지번호": pnu}
        row["대장"] = _clean(await bld.get_vacant_parcel(pnu, user))
        held = {k: row["대장"].pop(k) for k in _HELD if k in row["대장"]}
        for key in sorted(want & set(held)):
            if (v := _held_sec(key, held.get(key))):
                row[key] = v
        for key in sorted(want & _VACANT_SEC):
            try:
                row[key] = await _section(pnu, key, opt.get(key) or {}, user, vacant=True)
            except Exception as e:                  # noqa: BLE001
                row[key] = {"오류": str(e)[:160]}
        # 안 되는 묶음은 **응답에 안 적는다.** 나대지에 층이 없는 건 자명해서, 적어 주면
        # 도움이 아니라 군말이다. 되는 것이 무엇인지는 `함께` 설명에 한 번 적혀 있다.
        return row

    async def one(pk: str) -> dict:
        if len(pk) == 19:
            return await one_vacant(pk)
        row: dict[str, Any] = {"건물번호": pk}
        raw = await bld.get_building(pk, user)
        # 참조값은 **이름을 갈라** 낸다. 대장이 비었을 때 곁에 서는 값이고, 확인설명서·
        # 계약서로 나가는 자리엔 안 선다(화면도 「계산 58%」·「승강기공단 1대」로 쓴다).
        ref = {names.REF_KO[k]: v for k, v in (raw.get("_ref") or {}).items()
               if k in names.REF_KO and v is not None}
        ledger = _clean({k: v for k, v in raw.items() if k != "_ref"})
        ledger.pop("건물번호", None)
        ledger.pop("참조", None)
        team = {k: ledger.pop(k) for k in list(ledger) if k in
                {names.ko(x) for x in names.LISTING}}
        if team:
            ledger["내매물"] = team
        if ref:
            ledger["참조"] = ref
        # 걸침 필지일 때만 비중을 낸다. 하나뿐이면 「용도지역」과 같은 말이라 군말이다.
        mix = ledger.get("용도지역 비중")
        if not isinstance(mix, list) or len(mix) < 2:
            ledger.pop("용도지역 비중", None)
        held = {k: ledger.pop(k) for k in _HELD if k in ledger}
        row["대장"] = ledger
        for key in want & set(_HELD):
            if (v := _held_sec(key, held.get(key))):
                row[key] = v
        for key in want - set(_HELD):
            try:
                v = await _section(pk, key, opt.get(key) or {}, user)
            except Exception as e:                  # noqa: BLE001 — 한 묶음이 죽어도 나머지는 준다
                row[key] = {"오류": str(e)[:160]}
                continue
            if v:
                row[key] = v
        return row

    # **퍼 오기 전에 자른다.** 전엔 열다섯 채를 다 퍼 온 뒤 예산에 맞춰 버렸다 —
    # 주변동향 15채가 7.7초 걸려 5채를 주고, 무거운 넷은 9.0초 걸려 **한 채**를 줬다
    # (2026-09-21 실측). 버릴 것을 퍼 오는 데 시간을 다 쓴 것이다. 묶음 무게로 몇 채가
    # 예산에 들어갈지 미리 셈해 그만큼만 퍼 온다. 무게는 실측 중앙값이라 어림이고,
    # 남으면 아래에서 한 번 더 자른다.
    per = _LEDGER_CHARS + sum(_sec_chars(k, opt.get(k) or {}) for k in want)
    fit = max(1, int(_BUDGET * _CHARS_PER_TOK) // per)
    asked_n, pks = len(pks), pks[:fit]
    got = await asyncio.gather(*(one(pk) for pk in pks), return_exceptions=True)
    if len(pks) == 1 and isinstance(got[0], BaseException):
        raise got[0]                    # 하나뿐이면 그대로 올린다(위 검색과 같은 어법)
    rows = [r if isinstance(r, dict) else {"건물번호": pk, "오류": str(r)[:160]}
            for pk, r in zip(pks, got, strict=True)]
    # 예산까지만 담는다. 자른 것은 **잘랐다고 말한다** — 검색 줄·주변동향과 같은 어법.
    keep, used, limit = [], 0, int(_BUDGET * _CHARS_PER_TOK)
    for r in rows:
        n = len(json.dumps(r, ensure_ascii=False, default=str))
        if keep and used + n > limit:
            break
        keep.append(r); used += n
    out: dict[str, Any] = {"단위": names.UNITS}
    if len(keep) < asked_n:
        out["달란수"] = asked_n
        out["보여준수"] = len(keep)
    out["건물"] = keep
    return out



@dataclass(frozen=True)
class Tool:
    """도구 하나. 스키마와 실행이 같은 줄에 있어야 어긋나지 않는다."""
    name: str
    description: str
    schema: Callable[[dict[str, list[str]]], tuple[dict, list[str]]]
    run: Callable[[dict[str, Any], CurrentUser], Awaitable[Any]]


def _building_schema(enums: dict[str, list[str]]) -> tuple[dict, list[str]]:
    _EVENT_KINDS = enums.get("_event_kind") or []
    return {
        "type": "object",
        "properties": {
            "건물번호": {
                "description": "검색 결과 줄의 「건물번호」. 나대지는 「필지번호」를 그대로 넣는다. "
                               "**여러 채를 한 번에 준다** — 따로 부르면 그만큼 바퀴가 늘고 값이 비싸진다",
                "anyOf": [{"type": "string"},
                          {"type": "array", "items": {"type": "string"}}],
            },
            "함께": {
                "description": "같이 볼 목록. 안 주면 대장만 온다 — 대장엔 한 줄짜리 값만 있다"
                               "(역거리·공시지가·최근실거래가). 추이나 목록이 필요하면 여기서 부른다. "
                               "나대지는 `층별`·`필지`가 없다. "
                               "`주변동향`은 반경 안 소식이라 무겁다 — 필요할 때만 고르고, "
                               "좁히려면 목록 대신 객체로 준다: "
                               "{\"주변동향\": {\"반경\": 250, \"연수\": 1, \"갈래\": \"정비·개발\"}}",
                "anyOf": [
                    {"type": "array", "items": {"type": "string", "enum": sorted(names.SECTIONS)}},
                    # 손잡이가 있는 묶음만. 층별·필지·유동인구는 건물 하나에 딸린 것이라
                    # 반경도 연수도 없다.
                    {"type": "object", "properties": {
                        "주변동향": {"type": "object", "properties": {
                            "반경": {"type": "integer"}, "연수": {"type": "integer"},
                            # 자유 문자열이면 모델이 값을 지어낸다. 실제 값은 다섯뿐이다.
                            "갈래": ({"type": "string", "enum": _EVENT_KINDS}
                                    if _EVENT_KINDS else {"type": "string"})}},
                        "주변실거래": {"type": "object", "properties": {
                            "반경": {"type": "integer"}, "연수": {"type": "integer"}}},
                        "주변매각": {"type": "object", "properties": {"반경": {"type": "integer"}}},
                        # 대장에서 내려온 넷. 부르면 전부 오고, 손잡이로 좁힌다.
                        **{k: {"type": "object", "properties": {
                            "반경": {"type": "integer"}, "줄수": {"type": "integer"}}}
                           for k in ("버스정류장", "지하철역")},
                        **{k: {"type": "object", "properties": {
                            "연수": {"type": "integer"}, "줄수": {"type": "integer"}}}
                           for k in ("공시지가추이", "실거래이력")},
                        **{k: {"type": "object"} for k in sorted(names.SECTIONS)
                           if k not in ("주변동향", "주변실거래", "주변매각",
                                        "버스정류장", "지하철역", "공시지가추이", "실거래이력")},
                    }},
                ],
            },
        },
        "required": ["건물번호"],
    }, []


# ── 투자 셈 두 도구(2026-09-24) ─────────────────────────────────────────────
#
# **이 도구의 값은 산수가 아니라 이름이다.** 곱셈은 모델도 한다. 그런데 「투자 시나리오를
# 짜 줘」에 모델이 낸 금전 정보는 추정가 한 줄뿐이었다(2026-09-22 관악구 병원 실측) —
# 총투자비·대출·자기자본 수익률은 생각이 거기까지 안 갔다. 주차도 「기준이 엄격하니 검토가
# 필요합니다」라고 **말로 때웠다.** 사전에 이름이 있어야 모델이 그걸 셈한다.
#
# 모르는 값은 기본값을 깔지 않고 **필수로 받는다.** 우리 추정을 넣었으면 나가는 이름에
# 「추정」이 붙는다 — 화면의 0134 규칙(추정 임대료로 ROE 를 안 센다)을 뒤집지 않고 푸는 길이다.

_MONEY_PK = {
    "description": "검색 결과 줄의 「건물번호」. 나대지는 「필지번호」를 그대로 넣는다. "
                   "여러 채를 한 번에 주면 한 바퀴에 갈라 보인다",
    "anyOf": [{"type": "string"}, {"type": "array", "items": {"type": "string"}}],
}
_MONEY_DEAL = {"type": "number",
               "description": "원. 얼마에 사느냐. 안 주면 매매가, 그것도 없으면 추정가로 떨어진다"}

_INVEST_DESC = (
    "사는 셈. 한 해짜리다 — 총투자비·대출·연 이자·연 순수익·자기자본 수익률을 낸다. "
    "임대료는 실측이면 「연임대료」, 우리 추정이면 「추정연임대」로 넣는다(둘 중 하나 필수). "
    "추정을 넣으면 나가는 이름에 「추정」이 붙는다. 금리는 기본값이 없다 — 모르면 사용자에게 묻는다"
)
_DEVELOP_DESC = (
    "짓는 셈. 대지·법정 용적률로 지을 수 있는 규모를 내고, 받은 단가로 총사업비·완성가치·"
    "개발이익·토지잔여가치를 낸다. 토지잔여가치는 「이 땅에 얼마까지 낼 수 있나」다. "
    "공사단가·완성단가는 우리에게 없는 값이라 **네가 넣어야 한다**(원/평). "
    "그 둘이 없으면 셈이 안 돈다. 아는 시세로 넣고 답에 그 값을 밝히면 된다"
)


def _invest_schema(_enums: dict[str, list[str]]) -> tuple[dict, list[str]]:
    return {
        "type": "object",
        "properties": {
            "건물번호": _MONEY_PK,
            "자기자본": {"type": "number", "description": "원"},
            "금리": {"type": "number", "description": "연 %. 지어내지 말고 사용자에게 받는다"},
            "연임대료": {"type": "number",
                      "description": "원/년. **실측**일 때만 — 층별 합계이거나 팀이 적은 총액"},
            "추정연임대": {"type": "number",
                       "description": "원/년. 우리 추정(검색 줄의 「추정연임대」). "
                                      "넣으면 나가는 이름이 전부 「추정 …」이 된다"},
            "거래금액": _MONEY_DEAL,
            "부대비용률": {"type": "number", "description": f"%. 안 주면 {calc.FEE_PCT_DEFAULT}"},
        },
        "required": ["건물번호", "자기자본", "금리"],
    }, []


def _develop_schema(_enums: dict[str, list[str]]) -> tuple[dict, list[str]]:
    return {
        "type": "object",
        "properties": {
            "건물번호": _MONEY_PK,
            "추정공사단가": {"type": "number",
                        "description": "원/평. 지상 기준. 우리에게 없는 값이니 네가 아는 시세를 넣는다. "
                                       "평당 얼마로 봤는지가 답을 지배하므로 그 값을 답에 밝힌다"},
            "추정완성단가": {"type": "number",
                        "description": "원/평. 다 지었을 때 연면적 평당 값. 주변 신축 실거래나 "
                                       "「주변매각」 묶음의 평단가를 잣대로 삼아 네가 넣는다"},
            "거래금액": _MONEY_DEAL,
            "부대비용률": {"type": "number",
                      "description": f"%. 설계·감리·인허가. 안 주면 {calc.DEV_FEE_PCT_DEFAULT}"},
        },
        "required": ["건물번호", "추정공사단가", "추정완성단가"],
    }, []


def _pks(args: dict[str, Any]) -> list[str]:
    raw = args.get("건물번호") or args.get("필지번호")
    pks = [str(x).strip() for x in (raw if isinstance(raw, list) else [raw]) if str(x or "").strip()]
    if not pks:
        raise ValueError("「건물번호」가 없다. 검색 결과 줄의 건물번호를 넣는다(나대지는 필지번호)")
    return pks[:20]


async def _ours(pks: list[str], user: CurrentUser) -> dict[str, dict]:
    """셈에 쓸 우리 값. **검색을 그대로 부른다** — 도구가 낸 숫자와 검색 줄이 갈리면 안 된다.
    나대지(필지번호 19자리)는 표가 달라 따로 부른다."""
    want = ["land_area", "legal_far", "legal_bcr", "team_price AS sale_price", "sale_est"]
    out: dict[str, dict] = {}
    for vacant in (False, True):
        group = [p for p in pks if (len(p) == 19 and p.isdigit()) is vacant]
        if not group:
            continue
        f = Filters(pnu=group) if vacant else Filters(building_pk=group)
        body = SearchIn(filters=f, fields=[c.split(" AS ")[0] for c in want],
                        sort="land_area", target="vacant" if vacant else "building",
                        per_page=len(group) * 2, for_model=True)
        raw = await (search_vacant(body, user) if vacant else search(body, user))
        for col in ("mine", "normal"):
            for r in (raw.get(col) or {}).get("items") or []:
                out[str(r.get("building_pk") or r.get("pnu"))] = dict(r)
    return out


def _one(v: Any) -> tuple[float | None, list]:
    """법정 건폐·용적은 나대지 쪽이 **배열**이다 — 용도지역이 걸친 필지는 값이 둘 이상이다(0153).
    하나면 풀어 쓰고, 여럿이면 **고르지 않는다.** 둘 중 하나를 몰래 고르면 답이 통째로 갈린다."""
    if isinstance(v, (list, tuple)):
        vals = [x for x in v if x is not None]
        return (float(vals[0]), []) if len(vals) == 1 else (None, list(vals))
    return (float(v), []) if v is not None else (None, [])


def _deal(args: dict[str, Any], row: dict) -> tuple[float, str]:
    """거래금액과 그 출처. 받은 것이 먼저, 없으면 매매가, 그것도 없으면 추정가."""
    if (v := args.get("거래금액")) is not None:
        return float(v), "받은 값"
    for key, label in (("sale_price", "매매가"), ("sale_est", "추정가")):
        if (v := row.get(key)) is not None:
            return float(v), label
    raise ValueError("거래금액이 없다. 매매가도 추정가도 없는 건물이라 「거래금액」을 직접 넣어야 한다")


def _tag(out: dict, est: bool) -> dict:
    """우리 추정을 깔고 셌으면 나가는 이름에 「추정」을 박는다. 이름이 그걸 지고 있어야 한다."""
    if not est:
        return out
    return {(k if k.startswith("추정") else f"추정 {k}"): v for k, v in out.items()}


async def _run_invest(args: dict[str, Any], user: CurrentUser) -> Any:
    real, est_rent = args.get("연임대료"), args.get("추정연임대")
    if real is None and est_rent is None:
        raise ValueError("임대료가 없다. 실측이면 「연임대료」, 우리 추정이면 「추정연임대」에 "
                         "연 임대료(원)를 넣는다. 레버리지가 오차를 키워서 임대료 없이는 안 센다")
    for k in ("자기자본", "금리"):
        if args.get(k) is None:
            raise ValueError(f"「{k}」가 없다. 기본값을 지어내지 않는다 — 사용자에게 받아 넣는다")
    rent = float(real if real is not None else est_rent)
    rows, ours = [], await _ours(_pks(args), user)
    for pk in _pks(args):
        row = ours.get(pk)
        if row is None:
            rows.append({"건물번호": pk, "안 찾음": "우리 자료에 없는 번호다"})
            continue
        # **한 채가 막혀도 나머지는 낸다.** 봉익동 67(추정가 없음) 하나로 세 채가 통째로
        # 죽었다(2026-09-24). 막힌 줄은 막혔다고 그 줄에 적는다 — 조용히 빠지지 않는다.
        try:
            deal, src = _deal(args, row)
        except ValueError as e:
            rows.append({"건물번호": pk, "주소": row.get("addr"), "안 셈": str(e)})
            continue
        est = real is None or src == "추정가"
        got = calc.buy(거래금액=deal, 자기자본=float(args["자기자본"]), 금리=float(args["금리"]),
                       연임대료=rent, 부대비용률=args.get("부대비용률"))
        rows.append({"건물번호": pk, "주소": row.get("addr"),
                     "기준": f"거래금액 {src} · 임대 {'추정연임대' if real is None else '연임대료'}",
                     **_tag(got, est)})
    return {"단위": names.UNITS, "투자": rows}


async def _run_develop(args: dict[str, Any], user: CurrentUser) -> Any:
    for k in ("추정공사단가", "추정완성단가"):
        if args.get(k) is None:
            raise ValueError(f"「{k}」가 없다. 원/평으로 넣는다. 기본값을 지어내지 않는다 — "
                             f"평당 얼마로 볼지가 답을 지배하므로 그 숫자가 드러나야 한다")
    rows, ours = [], await _ours(_pks(args), user)
    for pk in _pks(args):
        row = ours.get(pk)
        if row is None:
            rows.append({"건물번호": pk, "안 찾음": "우리 자료에 없는 번호다"})
            continue
        area = row.get("land_area")
        far, far_many = _one(row.get("legal_far"))
        bcr, _ = _one(row.get("legal_bcr"))
        if far_many:
            rows.append({"건물번호": pk, "주소": row.get("addr"),
                         "안 셈": f"용도지역이 걸쳐 있어 법정용적률이 여럿이다({'·'.join(map(str, far_many))}%). "
                                f"어느 쪽으로 볼지 정해야 한다"})
            continue
        if not area or not far:
            rows.append({"건물번호": pk, "주소": row.get("addr"),
                         "안 셈": "대지면적이나 법정용적률이 없어 규모를 못 낸다"})
            continue
        try:
            deal, src = _deal(args, row)
        except ValueError as e:
            rows.append({"건물번호": pk, "주소": row.get("addr"), "안 셈": str(e)})
            continue
        got = calc.build(대지면적=float(area), 법정용적률=far, 법정건폐율=bcr,
                         거래금액=deal, 추정공사단가=float(args["추정공사단가"]),
                         추정완성단가=float(args["추정완성단가"]),
                         부대비용률=args.get("부대비용률"))
        rows.append({"건물번호": pk, "주소": row.get("addr"),
                     "기준": f"대지 {float(area):,.0f}㎡ · 법정용적률 {float(far):g}% · 거래금액 {src}",
                     **got})
    return {"단위": names.UNITS, "신축": rows}


# ── 자료 만들기(2026-09-24) ─────────────────────────────────────────────────
#
# **우리가 주는 건 시각적인 것뿐이다**(대표). 토큰(색·글꼴·간격)과 틀(.slide·표)을 주고,
# 차트·표는 **모델이 SVG·HTML 로 직접 그린다.** 완제품 부품을 열넷 만들려던 것을 둘로 줄였다 —
# 모델이 못 그리는 것(지적도·사진)만 `<bt-*>` 로 남긴다. 부품이 울타리가 되면 자유가 깎인다.
#
# 글과 판단은 우리가 안 쓴다. 「신축용으로 좋다」는 자료를 보는 사람의 몫이다.

_HOWTO = (
    "HTML 을 그대로 쓴다. 굽는 쪽이 토큰과 틀을 머리에 박아 주므로 <style> 을 쓸 일이 거의 없다.\n"
    "틀: <section class=\"slide\"> 한 장 · <div class=\"row\"> 가로 나눔 · class=\"grow\" 남은 높이 채우기 · "
    "<h1> <h2> <h3> <p> <p class=\"sub\">\n"
    "표: <table><tr><th>이름</th><th class=\"num\">값</th></tr>… 숫자 칸엔 class=\"num\" "
    "(모노·자릿수 맞춤). 글 안 숫자는 <span class=\"mono\">\n"
    "색: var(--ink) 본문 · var(--ink-2) 보조 · var(--muted) 라벨 · var(--line) 선. "
    "차트 계열색 넷은 뜻이 정해져 있다 — var(--c-gongsi) 공시지가 · var(--c-real) 실거래 · "
    "var(--c-rent) 임대 · var(--c-ad) 그 밖\n"
    "차트·그림은 <svg> 로 직접 그린다. 축·눈금·값 라벨을 넣고 계열색을 쓴다.\n"
    "부품 둘만 우리가 그린다: <bt-map pk=\"건물번호\"></bt-map> 지적도(둘레 필지·도로·축척 막대, "
    "draw=\"wide\" 면 더 넓게) · <bt-photo pk=\"건물번호\"></bt-photo> 올린 사진.\n"
    "한 장에 큰 그림 하나 · 중간 둘 · 작은 값 넷까지. 글이 그림에 있는 숫자를 되풀이하지 않는다.\n"
    "로고·인장은 넣지 않는다. 중개인이 손님에게 주는 자료지 우리 자료가 아니다."
)
_MAKE_DESC = (
    "자료를 만든다. 슬라이드나 문서를 HTML 로 써서 넘기면 링크가 나온다. PDF 는 그 링크에서 인쇄한다. "
    "숫자는 먼저 search·invest·develop 으로 받아 쓴다. " + _HOWTO
)
_FIX_DESC = (
    "만든 자료를 고친다. **바꿀 토막만** 「옛글」에 그대로 옮기고 「새글」을 준다. 통째로 다시 쓰지 않는다. "
    "옛글이 지금 자료에 없거나 여러 군데면 거절하고 알려 준다. 지금 글은 「보기」로 읽는다"
)


def _make_schema(_e: dict[str, list[str]]) -> tuple[dict, list[str]]:
    return {
        "type": "object",
        "properties": {
            "제목": {"type": "string", "description": "자료 이름. 목록에 이것으로 선다"},
            "html": {"type": "string", "description": "자료 본문 HTML"},
            "갈래": {"type": "string", "enum": ["slides", "doc"],
                   "description": "slides=가로 16:9 발표용 · doc=세로 A4 문서. 안 주면 slides"},
        },
        "required": ["제목", "html"],
    }, []


def _fix_schema(_e: dict[str, list[str]]) -> tuple[dict, list[str]]:
    return {
        "type": "object",
        "properties": {
            "자료번호": {"type": "integer"},
            "보기": {"type": "boolean", "description": "참이면 고치지 않고 지금 HTML 을 돌려준다"},
            "옛글": {"type": "string", "description": "바꿀 토막. 지금 자료에 있는 그대로"},
            "새글": {"type": "string", "description": "그 자리에 들어갈 글. 빈 문자열이면 지운다"},
        },
        "required": ["자료번호"],
    }, []


async def _run_make(args: dict[str, Any], user: CurrentUser) -> Any:
    from ..domains import artifacts as art
    body = art.CreateIn(title=str(args.get("제목") or "").strip() or "자료",
                        html=str(args.get("html") or ""),
                        kind=str(args.get("갈래") or "slides"))
    if not body.html.strip():
        raise ValueError("html 이 비었다. 자료 본문을 HTML 로 써서 넘긴다")
    got = await art.create(body, user.account_id)
    return {"자료번호": got["id"], "제목": got["제목"], "판": got["ver"],
            "그린 부품": got["부품"] or "없음", "링크": f"/artifacts/{got['id']}"}


async def _run_fix(args: dict[str, Any], user: CurrentUser) -> Any:
    from ..domains import artifacts as art
    aid = args.get("자료번호")
    if not aid:
        raise ValueError("「자료번호」가 없다. 만들 때 돌려준 번호를 넣는다")
    if args.get("보기"):
        await art._own(int(aid), user)
        last = await art._last(int(aid)) or {}
        return {"자료번호": aid, "판": last.get("ver"), "html": last.get("src_html")}
    if args.get("옛글") is None:
        raise ValueError("「옛글」이 없다. 바꿀 토막을 지금 자료에 있는 그대로 옮긴다. "
                         "지금 글을 모르면 「보기」로 먼저 읽는다")
    got = await art.edit(int(aid), art.EditIn(old=str(args["옛글"]), new=str(args.get("새글") or "")), user)
    return {"자료번호": got["id"], "판": got["ver"], "링크": f"/artifacts/{got['id']}"}


# ── 되묻기(2026-09-25) ──────────────────────────────────────────────────────
#
# 글로도 되물을 수 있지만 화면이 「답이 끝났는지 기다리는지」를 모르고, 고를 것이 있어도
# 형식이 없어 사용자가 타이핑해야 한다. 도구로 만들면 화면이 **칩**으로 그린다.
#
# **이 도구는 값을 안 돌려주고 바퀴를 끊는다.** 답이 사용자에게서 오기 때문이다
# (`agent.Exec.asked` → 벤더 고리가 멈춤 → `ask()` 가 조각으로 냄).
# 물음은 **한 번에 넷까지** 담는다. 하나씩 물으면 여러 바퀴가 되고, 물을 게 여럿이면
# 한 번에 묻는 것이 사람의 어법이다(대표 2026-09-25).

_ASK_DESC = "사용자에게 되묻는다. 사용자가 말하지 않은 것을 지어내지 않는다"


def _ask_schema(_e: dict[str, list[str]]) -> tuple[dict, list[str]]:
    return {
        "type": "object",
        "properties": {
            "물음": {
                "type": "array",
                "description": "한 번에 넷까지. 물을 게 여럿이면 나눠 부르지 말고 여기 담는다",
                "items": {
                    "type": "object",
                    "properties": {
                        "묻는것": {"type": "string", "description": "한 문장"},
                        "고르기": {"type": "array", "items": {"type": "string"},
                                "description": "누를 수 있는 보기. 없어도 된다(사용자가 직접 친다)"},
                        "여러개": {"type": "boolean", "description": "여럿 고를 수 있나. 기본 거짓"},
                    },
                    "required": ["묻는것"],
                },
            },
        },
        "required": ["물음"],
    }, []


async def _run_ask(args: dict[str, Any], _user: CurrentUser) -> Any:
    raw = args.get("물음")
    if isinstance(raw, dict):
        raw = [raw]
    items = [q for q in (raw or []) if isinstance(q, dict) and str(q.get("묻는것") or "").strip()]
    if not items:
        raise ValueError("물을 것이 없다. 「물음」에 {\"묻는것\": \"…\"} 를 하나 이상 넣는다")
    if len(items) > 4:
        raise ValueError(f"한 번에 넷까지 묻는다. {len(items)}개는 많다 — 지금 꼭 필요한 것만 남긴다")
    out = []
    for q in items:
        picks = [str(x).strip() for x in (q.get("고르기") or []) if str(x).strip()]
        out.append({"묻는것": str(q["묻는것"]).strip(),
                    "고르기": picks[:8] or None,       # 여덟 넘으면 칩이 줄을 먹는다
                    "여러개": bool(q.get("여러개"))})
    return {"__ask__": out}


REGISTRY: tuple[Tool, ...] = (
    Tool("search", _SEARCH_DESC, _search_schema, _run_search),
    Tool("building", _BUILDING_DESC, _building_schema, _run_building),
    Tool("invest", _INVEST_DESC, _invest_schema, _run_invest),
    Tool("develop", _DEVELOP_DESC, _develop_schema, _run_develop),
    Tool("make", _MAKE_DESC, _make_schema, _run_make),
    Tool("fix", _FIX_DESC, _fix_schema, _run_fix),
    Tool("ask", _ASK_DESC, _ask_schema, _run_ask),
)


async def build() -> dict:
    """모델에게 그대로 넘길 도구 배열 + 무엇을 왜 뺐는지.

    뺀 것을 응답이 **말한다**. 조용히 거르면 그게 거짓말이라는 규칙을 지역 처리에 이미
    써 놨다(`_with_match`). 스키마도 같다."""
    enums = await enum_values()
    tools, hidden = [], {}
    # **도구를 지우지 않고 감춘다.** `조건` 안에 묶음을 넣은 뒤 바퀴가 줄었는지 보려면
    # 둘 중 하나만 보여야 한다 — 둘 다 주면 모델이 아는 쪽(`building`)만 쓴다(실측:
    # 두 물음 다 `building` 을 불렀고 `조건` 안 묶음은 한 번도 안 썼다, 2026-09-21).
    # 핸들러와 `/ai/buildings` 라우트는 그대로라 env 하나로 되돌아온다.
    for t in REGISTRY:
        if t.name == "building" and not settings.ai_building_tool:
            continue
        schema, dropped = t.schema(enums)
        tools.append({"name": t.name, "description": t.description, "input_schema": schema})
        if dropped:
            hidden[t.name] = dropped
    from . import agent                      # 늦게 들여온다 — agent 가 우리를 들여온다
    return {
        "vendor": agent.vendor(),
        "model": agent.model_name(),
        "tools": tools,
        "hidden": {"filters": hidden, "params": ["sort", "per_page"]},
        "counts": {
            "tools": len(tools),
            "filters": len(tools[0]["input_schema"]["properties"]["조건"]["items"]["properties"]),
            "hidden": sum(len(v) for v in hidden.values()),
            "fields": len(_FIELDS_MODEL),
        },
    }
