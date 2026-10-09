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
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from ..core.db import pool
from ..core.deps import CurrentUser
from ..domains import buildings as bld
from ..domains import floors as flr
from ..domains import market as mkt
from ..domains import parcels as par
from ..domains.prices import rents_for
from ..domains.parcels import listings_of
from ..domains.search import (_FIELDS_OK, _VACANT_ANY, _VACANT_COL,
                              _VACANT_FIELDS, Filters, SearchIn, pks_by_addr, search, search_vacant)
from . import calc, catalog, names, people

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
# 칸을 안 더해도 줄 하나에 드는 토큰 — 주소 · 매매가 한두 건 · 추정가 묶음(0224 어림: 옛 71 + 매매가 건 · 추정가 묶음 40)
_ROW_BASE = 110
_PER_COL = 9        # 칸 하나가 줄마다 더 먹는 토큰
_ROWS_MIN = 5       # 이보다 적게 주면 검색한 뜻이 없다
_CHARS_PER_TOK = 2.5   # 한국어 JSON 실측(14,927자 = 6,022토큰)
# 묶음 하나가 한 채에 더하는 자릿수 — 실측 중앙값(2026-09-21, 강남구 삼성동 160-22).
# **퍼 오기 전에 몇 채가 들어갈지 셈하는 데 쓴다.** 어림이라도 있어야 버릴 것을
# 퍼 오지 않는다. 무거운 셋(주변동향·주변매각·주변실거래)이 나머지를 다 합친 것보다 크다.
_SEC_CHARS: dict[str, int] = {
    "짝": 380, "임대료": 700,                   # 11b · 0224(어림)
    "주변매각": 2932, "주변동향": 2525, "주변실거래": 1268, "층별": 1006,
    "공시지가추이": 640, "버스정류장": 559, "필지": 448, "시간대별유동인구": 150,
    "지하철역": 260, "실거래이력": 33,
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
_BUILDINGS_DESC = (
    "건물 조회 — 매물을 찾고, 한 채를 보고, 묶음(층별 · 주변 등)을 붙인다. 모든 건물 읽기가 이 하나다. "
    "응답은 `검색` 목록이고 **한 줄 = 매물 하나**다. 매물마다 매매가는 하나다. 한 건물에 매물이 여럿이면(내 매물 · 다른 사무소 · 네이버) 줄도 여럿이고, 1번 매물이 먼저 온다. "
    "줄의 뼈대는 `주인` · 주소 · `매매가`다. 주인은 「내 매물」 · 사무소 이름 · 「네이버」(수집한 매물). "
    "주인마다 딸린 칸이 붙는다 — 내 매물: 담당 · 상태 등 / 다른 사무소: 중개사 · 관심 / 네이버: 수집일 · 광고수. "
    "`매물`을 안 주면 매물만 보고, 매물이 아닌 건물은 **걸린 수만** `일반`으로 같이 온다 — 매물이 적으면 `매물: 전체`로 다시 찾거나 구해요로 이어갈 수 있다. "
    "**건물은 주소로 가리킨다** — 한 채는 `주소`(지번 · 도로명)로 짚는다. "
    "**줄은 지번 하나다.** 한 지번에 건물(동)이 여럿이면 `동수`와 동들의 `주용도`가 붙고, 연면적 · 주차 · 승강기는 동들의 합, 층수는 가장 높은 동이다. "
    "추정가는 **사람이 그것을 물을 때만** 부른다 — 매매가가 아니다. 매매가를 물으면 부르지 않는다. `임대료`는 실제 임대료 목록(내 매물 · 네이버 임대시세)이다. "
    "**이름을 대면 줄에 보이고, 손잡이를 달면 걸린다.** 보기만 할 거면 빈 묶음을 준다 — "
    "`{\"대지면적\":{\"이상\":200}, \"구조\":{}}` 는 대지 200㎡ 이상을 거르고 줄에 대지면적과 구조를 낸다. "
    "손잡이: 수 `이상`·`이하` · 날짜 `이후`·`이전` · 목록 `값`·`없음` · 하나와 글 `값`. 묶음도 이름으로 댄다(`{\"층별\":{}}`). "
    "`조건`은 늘 목록이고 목록 사이는 「또는」, 항목 안은 「그리고」다. "
    "「신축 가능한 곳」처럼 빈 땅과 헐 건물이 둘 다 답이면 조건마다 `대상`을 달리 건다. "
    "`값`은 `[\"A\",\"B\"]`(A 또는 B)이고, `주용도` · `입주업체`만 `[[\"A\",\"B\"],[\"C\"]]`((A 그리고 B) 또는 C)도 받는다. "
    "값은 `\"매매가\": {\"이상\": …, \"이하\": …}` 로 건다 — 그 매물의 매매가로 걸린다. 지난 실거래가는 매매가가 아니다. "
    "명도 · 상태 · 급함 · 소유자처럼 **사무소가 적은 값**은 내 매물에만 있어, 걸면 내 매물만 남고 내 매물 줄에만 보인다. "
    "`고객`(이름) · `저장조건`(이름) 을 주면 그 조건을 서버가 펼쳐 건다(같이 준 `조건` 은 펼친 갈래마다 그리고로 붙는다). "
    f"단위는 {names.UNITS}."
)


def mode_of(user: CurrentUser) -> str:
    """모드는 **토큰이 정한다**(11 §2-1). 요청엔 모드 칸이 없다 — 바꿀 길이 없다."""
    return "broker" if (user.kind == "중개사" and user.team_id is not None) else "customer"


# ── 화면 지도용 핀 ─────────────────────────────────────────────────────────
# 검색 원본 줄엔 좌표가 있는데 모델에게 가기 전에 걷는다(names.DROP). 그 자리에서 핀만
# 따로 빼 **화면으로만** 보낸다 — 제미나이처럼 답 옆에 지도가 서고, 글이 가리키는 건물엔
# 카드가 선다(2026-09-21 대표). 모델은 이걸 못 본다. `agent.Exec` 가 도구를 돌리기 전에
# 빈 목록을 걸고, 돌린 뒤 걷어 도구 기록에 붙인다.
_PINS: contextvars.ContextVar[list[dict] | None] = contextvars.ContextVar("bt_pins", default=None)
# 오른쪽 판 열기 신호(0235). **핀(데이터)이 있다고 판을 열지 않는다** — 도구가 「보여 준다」고 정했을 때만 판이 열린다.
# {view: "map", pks: [...]} · {view: "artifact", id, ver}. Exec 가 받아 라우트가 `panel` 조각으로 흘린다
_PANEL: contextvars.ContextVar[dict | None] = contextvars.ContextVar("bt_panel", default=None)
# 사용자가 고른 자료 템플릿(0235). 요청마다 정해지고 모델은 바꿀 수 없다 — make 가 읽는다
_TEMPLATE: contextvars.ContextVar[str | None] = contextvars.ContextVar("bt_template", default=None)


def _panel(d: dict) -> None:
    box = _PANEL.get()
    if box is not None:
        box.clear(); box.update(d)


def _collect_pins(items: list[dict], vacant: bool) -> None:
    """핀은 건물마다 하나 — 그 건물의 **1번 매물**(줄이 순번대로 온다)의 주인 색 · 매매가(0226).
    매물이 아니면 추정가 색. 화면이 탐색 지도와 같은 규칙으로 그린다."""
    sink = _PINS.get()
    if sink is None:
        return
    num = lambda v: (float(v) if v is not None else None)   # noqa: E731 — NUMERIC(Decimal) → 숫자
    have = {p["pk"] for p in sink}
    # 줄은 물은 정렬대로 온다 — 건물마다 순번(listing_rank)이 가장 앞선 줄을 고른다
    first: dict[str, dict] = {}
    for r in items:
        pk = r.get("pnu") if vacant else r.get("building_pk")
        if r.get("lng") is None or r.get("lat") is None or pk in have:
            continue
        if pk not in first or (r.get("listing_rank") or 1) < (first[pk].get("listing_rank") or 1):
            first[pk] = r
    for pk, r in first.items():
        lng, lat = r["lng"], r["lat"]
        sink.append({
            "pk": pk, "pnu": r.get("pnu"),   # pnu = 지도에서 고르는 열쇠(지번 · 10-08)
            "vacant": vacant, "addr": r.get("addr"), "lng": float(lng), "lat": float(lat),
            "col": "normal" if vacant else (r.get("kind") or "normal"), "sale_est": num(r.get("sale_est")),
            "price": num(r.get("price")),
            "land_area": num(r.get("land_area")), "total_area": num(r.get("total_area")),
        })


def _buildings_schema(ctx: dict) -> tuple[dict, list[str]]:
    """모드마다 **다른 스키마**가 나간다(11b §1-1). 이름 · 갈래 · 값은 전부 선언 표(catalog)와 정본에서 나온다."""
    mode = ctx["mode"]
    props = catalog.schema_props(mode, ctx)
    saved = {"type": "string", "description": "저장한 조건 이름. 서버가 그 조건을 펼쳐 건다"
                                              + (" (내 것만)" if mode == "customer" else "")}
    if ctx.get("saved"):
        saved["enum"] = ctx["saved"]
    p: dict[str, Any] = {
        # **모양은 하나다 — 늘 목록이다.** 목록 사이는 「또는」, 한 항목 안은 「그리고」
        "조건": {"type": "array", "items": {"type": "object", "properties": props}},
        "저장조건": saved,
        # 정렬이 없으면 임의 문턱을 지어낸다. **기본값을 두지 않는다** — 무엇으로 세우느냐가 곧 무엇을 보느냐다
        "정렬": {"type": "string", "description": "이 이름으로 세운다. 결과는 잘려 나가니 물음에 맞는 것을 골라라",
                 "enum": sorted(catalog.sortable(mode))},
        "차순": {"type": "string", "enum": ["내림차순", "오름차순"],
                 "description": "내림차순은 큰 것부터, 오름차순은 작은 것부터"},
    }
    if mode == "broker":
        p["고객"] = {"type": "string", "description": "고객 이름. 그 고객에게 붙은 조건을 서버가 펼쳐 「또는」 갈래로 건다. "
                                                   "같은 이름이 둘이면 「이름 · 등록일(YYYY-MM-DD)」로 준다"}
    return {"type": "object", "properties": p, "required": ["조건", "정렬", "차순"]}, []


_TEAM_COLS = catalog.TEAM_COLS | frozenset(names.LISTING)


def _won(v):
    return int(v) if v is not None else None


async def _ad_info(ad_ids: list[int]) -> dict[int, dict]:
    """다른 사무소 매물에 붙일 광고 칸 — 중개사 · 관심(저장 수 · 오늘 연 수). 광고 번호는 안 낸다"""
    ids = [i for i in ad_ids if i]
    if not ids:
        return {}
    rows = await pool().fetch(
        """SELECT a.id,
                  (SELECT x.name FROM app.accounts x WHERE x.id = COALESCE(a.contact_account_id, a.created_by)) AS agent,
                  (SELECT count(*) FROM app.saves sv WHERE sv.ad_id = a.id) AS saves,
                  (SELECT count(*) FROM app.ad_views v WHERE v.ad_id = a.id
                     AND v.viewed_on = (now() AT TIME ZONE 'Asia/Seoul')::date) AS today
             FROM app.ads a WHERE a.id = ANY($1::bigint[])""", ids)
    return {r["id"]: {"중개사": r["agent"], "관심": {"저장": r["saves"], "오늘": r["today"]}} for r in rows}


_OWNER_KO = {"mine": "내 매물"}


def _row(r: dict, ads: dict[int, dict], biz_names: dict, word: str | None,
         who: dict[int, str], want: frozenset[str] = frozenset()) -> dict:
    """검색 원본 줄 하나(매물 하나) → 모델 줄. 뼈대(주인 · 주소 · 매매가) + 주인마다 딸린 칸 + 물어본 칸.
    **내부 번호(건물번호 · 필지번호 · 매물 번호 · 계정 번호)는 키조차 없다**(11b, 10-04 대표) — 건물은 주소로, 담당자는 이름으로.
    `_pk` 는 묶음을 붙이는 동안만 쓰고 내보내기 전에 걷는다.
    **팀 칸은 내 매물 줄에만 키를 만든다**(11b §4).
    want = 부를 때만 붙는 것(추정가)."""
    pk = r.get("building_pk") or r.get("pnu")
    owner = r.get("owner")
    mine = owner == "mine"
    row: dict[str, Any] = {"_pk": pk}
    if owner:
        row["주인"] = _OWNER_KO.get(owner) or r.get("office")
    if r.get("addr"):
        row["주소"] = r["addr"]
    if r.get("price") is not None:
        row["매매가"] = _won(r["price"])
    if owner == "office" and (a := ads.get(r.get("ad_id"))):
        row.update({k: v for k, v in a.items() if v is not None})
    if owner == "crawl":
        if r.get("mk_on"):
            row["수집일"] = r["mk_on"]
        if r.get("mk_n"):
            row["광고수"] = r["mk_n"]
    if "추정가" in want and r.get("sale_est") is not None:
        row["추정가"] = {k: v for k, v in (("값", _won(r["sale_est"])), ("평단가대지", r.get("pp_land")),
                                         ("평단가연면적", r.get("pp_total")), ("공시비율", r.get("gongsi_ratio")))
                       if v is not None}
    for k, v in r.items():
        if k in ("building_pk", "pnu", "addr", "sale_est", "is_listing") or k in names.DROP or v is None or v == []:
            continue
        if not mine and k in _TEAM_COLS:
            continue
        if k == "assignee_account_id":                # 담당자는 이름으로(계정 번호는 안 낸다)
            if who.get(v):
                row["담당자"] = who[v]
            continue
        if k == "biz_n":
            if v and word:
                row[word] = v
            continue
        if k == "float_pop":
            row["유동인구"] = {"주간": round(v), "야간": round(r["float_pop_night"])
                            if r.get("float_pop_night") is not None else None}
            continue
        row[names.ko(k)] = v
    # 지번(0230) — 한 줄 = 지번. 동이 여럿이면 동 수와 동들의 주용도를 싣는다(건물 칸은 지번 값 · 스펙 §5-2)
    if (r.get("n_bldg") or 1) > 1:
        row["동수"] = r["n_bldg"]
        if r.get("uses"):
            row["주용도"] = r["uses"]
    for w, by_pk in biz_names.items():
        if (got := by_pk.get(pk)):
            row[w] = got
    return row


# 나대지에 되는 묶음. 층별·필지는 건물 것이다.
_VACANT_SEC = frozenset({"시간대별유동인구", "주변동향", "주변실거래", "주변매각"})

# 팔 수 없는 땅의 지목. **모델용 검색에서만 기본으로 뺀다**(2026-09-22 대표).
# 「용적여유 큰 순」에 봉익동 67(지목 공원, 대지 3,027㎡·건물 253㎡)이 1등으로 올라
# 「신축 알짜」로 소개됐다. 모델이 `지목` 을 직접 걸면(있음이든 없음이든) 그 말을 따른다.
# 학교용지·종교용지는 안 뺀다 — 가끔 거래된다. 검색 화면은 이 규칙이 없다(사람이 칩으로 거른다).
_PUBLIC_JIMOK = ("공원", "도로", "하천", "제방", "구거", "유지", "철도용지", "묘지", "수도용지", "사적지")


async def _attach(block: dict, secs: dict[str, dict], vacant: bool,
                  user: CurrentUser) -> None:
    """검색 줄에 묶음을 붙인다. 줄마다 질의가 도니 예산이 이미 줄 수를 줄여 놓았다. 한 줄이 죽어도 나머지는 준다."""
    blocks = [block]
    rows = list(block.get("목록", []))
    keys = [k for k in secs if not vacant or k in _VACANT_SEC]
    if not rows or not keys:
        return

    async def fill(r: dict) -> None:
        pk = r.get("_pk")
        for k in keys:
            try:
                if v := await _section(pk, k, secs[k], user, vacant=vacant):
                    r[k] = v
            except Exception as e:                  # noqa: BLE001
                r[k] = {"오류": str(e)[:120]}

    await asyncio.gather(*(fill(r) for r in rows))
    # **어림이 틀려도 예산은 지킨다.** 붙인 뒤 다시 재서 넘치면 줄을 버리고 말한다
    limit = int(_BUDGET * _CHARS_PER_TOK)
    used = 0
    for b in blocks:
        keep = []
        for r in b.get("목록") or []:
            n = len(json.dumps(r, ensure_ascii=False, default=str))
            if keep and used + n > limit:
                break
            keep.append(r); used += n
        if len(keep) < len(b.get("목록") or []):
            b["보여준수"] = len(keep)
        b["목록"] = keep


async def _expand(args: dict[str, Any], user: CurrentUser, mode: str) -> list[tuple[str, dict, dict]]:
    """`고객` · `저장조건` → 저장한 조건들을 **서버가 펼친다**(모델이 옮겨 적다 틀릴 자리가 없다).
    반환 [(라벨, Filters 인자, 아님)]. 화면 조건 창이 저장한 모양(filters · regions) 그대로 읽는다.
    **같은 이름이 둘이면 섞지 않는다** — 후보를 등록일로 돌려주고 「이름 · 등록일」로 다시 받는다."""
    rows = []
    if args.get("고객"):
        if mode != "broker":
            raise ValueError("「고객」은 없는 손잡이다")
        raw = str(args["고객"]).strip()
        nm, _, day = (x.strip() for x in raw.partition("·"))
        cands = await pool().fetch(
            "SELECT id, created_at::date AS d FROM app.buyers WHERE team_id = $1 AND name = $2 AND deleted_at IS NULL ORDER BY created_at",
            user.team_id, nm)
        if day:
            cands = [c for c in cands if str(c["d"]) == day]
        if not cands:
            raise ValueError(f"「{raw}」 고객이 없다")
        if len(cands) > 1:
            raise ValueError(f"「{nm}」 고객이 {len(cands)}명이다: " + " · ".join(f"{c['d']} 등록" for c in cands)
                             + f". 「{nm} · 등록일」로 준다")
        rows += await pool().fetch(
            """SELECT s.name, s.conditions_json FROM app.saved_searches s
                WHERE s.buyer_id = $1 AND s.closed_at IS NULL ORDER BY s.id""", cands[0]["id"])
        if not rows:
            raise ValueError(f"「{nm}」 고객에게 붙은 조건이 없다")
        rows = [{"name": f"{nm} · {r['name']}", "conditions_json": r["conditions_json"]} for r in rows]
    if args.get("저장조건"):
        nm = str(args["저장조건"]).strip()
        got = await pool().fetch(
            """SELECT name, conditions_json FROM app.saved_searches
                WHERE name = $1 AND closed_at IS NULL
                  AND (account_id = $2 OR ($3::bigint IS NOT NULL AND team_id = $3 AND buyer_id IS NULL))""",
            nm, user.account_id, user.team_id if mode == "broker" else None)
        if not got:
            raise ValueError(f"「{nm}」 저장조건이 없다")
        if len(got) > 1:
            raise ValueError(f"「{nm}」 저장조건이 {len(got)}개다 — 이름이 겹친다")
        rows += got
    out = []
    ok = set(Filters.model_fields)
    for r in rows:
        cj = r["conditions_json"]
        cj = json.loads(cj) if isinstance(cj, str) else (cj or {})
        f = {k: v for k, v in (cj.get("filters") or {}).items() if v not in (None, [], "") and k in ok}
        if mode != "broker":                       # 고객 조건에 팀 칸이 있어도 안 건다
            f = {k: v for k, v in f.items() if k not in catalog.TEAM_FILTERS}
        codes = [g.get("bjd_code") for g in (cj.get("regions") or []) if g.get("bjd_code")]
        if codes:
            f["bjd_code"] = codes
        nots = f.pop("nots", None) or {}
        out.append((r["name"], f, nots))
    return out


def _where(flat: dict) -> bool:
    return bool(flat.get("region") or flat.get("bjd_code") or flat.get("addr"))


async def _run_buildings(args: dict[str, Any], user: CurrentUser) -> Any:
    """건물 조회(11b §2). 화면과 **같은 함수**(search.search)를 부른다 — 매물 탐색 · 매물 찾기와 답이 갈라질 자리가 없다.
    한 건물은 한 줄이고, 매매가는 매매가 표(0224)에서 출처째 통째로 붙인다. 이름 · 갈래 · 값은 선언 표(catalog) 하나에서 온다."""
    mode = mode_of(user)
    ctx = await catalog.context(user, mode)
    raw_c = args.get("조건")
    conds = raw_c if isinstance(raw_c, list) else ([raw_c] if isinstance(raw_c, dict) else [])
    conds = [c for c in conds if isinstance(c, dict)]
    expanded = await _expand(args, user, mode)
    if not conds and not expanded:
        raise ValueError("조건이 없다. 조건 없이 전체를 훑으려면 `[{}]` 라고 줘라")
    if not conds:
        conds = [{}]
    if len(conds) > 1 and any(not c for c in conds):
        raise ValueError("조건 하나가 비어 있다. 빈 조건은 나머지를 다 삼키니 따로 걸 것이 없으면 조건을 하나만 줘라")
    seen_c: list[dict] = []
    for c in conds:
        if c in seen_c:
            raise ValueError(f"같은 조건을 두 번 달랬다: {c}. 같은 답이 두 벌 온다")
        seen_c.append(c)

    if "출처" in args:
        raise ValueError("「출처」는 없다 — 한 건물은 한 줄이고 매매가 건마다 출처가 붙는다. 어느 건물까지 볼지는 조건의 「매물」로 건다")
    # 「어디」는 조건마다 요구하지 않는다 — 넓은 검색이 문제가 되는 건 서울 전역을 훑는 `매물: 전체` 하나라서,
    # 그 막이(TOO_WIDE)는 아래 one() 에서 거기에만 건다. 매물은 범위가 작다(10-04 대화 515)
    parsed = [catalog.parse(c, mode, ctx, need_where=False) for c in conds]
    jobs: list[tuple[dict, str | None, tuple]] = []
    for c, pr in zip(conds, parsed, strict=True):
        if not expanded:
            jobs.append((c, None, pr))
            continue
        flat, nots, fs, target, secs, cc = pr
        for label, ef, en in expanded:
            jobs.append((c, label, ({**ef, **flat}, {**en, **nots}, fs, target, secs, cc)))
    if len(jobs) > _SEARCH_MAX:
        raise ValueError(f"한 번에 검색 {_SEARCH_MAX}개까지다({len(jobs)}개)")

    fields = sorted({f for _c, _l, (_fl, _n, fs, _t, _s, _cc) in jobs for f in fs})
    srt = args.get("정렬") or ""
    sort_col = catalog.sortable(mode)
    if not srt:
        raise ValueError(f"정렬이 없다. 결과는 잘려 나가니 무엇으로 세울지 골라야 한다. 고를 수 있는 이름: {sorted(sort_col)}")
    if srt not in sort_col:
        near = difflib.get_close_matches(srt, sort_col, n=3, cutoff=0.5)
        raise ValueError(f"「{srt}」로는 못 센다." + (f" 혹시 {' · '.join(near)}?" if near else
                                                     f" 고를 수 있는 이름: {sorted(sort_col)}"))
    asc = args.get("차순") or ""
    if asc not in ("내림차순", "오름차순"):
        raise ValueError("차순이 없다. 「내림차순」(큰 것부터) 또는 「오름차순」(작은 것부터)")
    _V_OK = set(_VACANT_ANY) | set(_VACANT_COL) | {"region", "bjd_code"}
    sec_tok = max((sum(_sec_chars(k, o) for k, o in pr[4].items()) for *_x, pr in jobs), default=0) / _CHARS_PER_TOK
    per = _rows_for(len(fields), len(jobs), int(sec_tok))
    who = {r["account_id"]: r["name"] for r in await pool().fetch(
        "SELECT m.account_id, a.name FROM app.team_members m JOIN app.accounts a ON a.id = m.account_id"
        " WHERE m.team_id = $1", user.team_id)} if user.team_id is not None else {}
    age = catalog.BY_KO[srt].age if srt in catalog.BY_KO else False

    async def one(asked: dict, label: str | None, got: tuple) -> dict:
        flat, nots, my_fields, target, my_secs, _cc = got
        flat = dict(flat)
        scope = flat.pop("_scope", "any")
        # 추정가는 **부를 때만**(10-05 대표 — 매매가와 다른 개념이다)
        want = frozenset(k for k in ("추정가",) if k in my_secs)
        my_secs = {k: v for k, v in my_secs.items() if k != "추정가"}
        if target == "vacant" and (bad := sorted({catalog.BY_FILTER.get(k, k) for k in flat if k not in _V_OK})):
            ok = sorted({catalog.BY_FILTER[k] for k in _V_OK if k in catalog.BY_FILTER})
            raise ValueError(f"나대지에는 {bad} 가 없다. 걸 수 있는 이름: {ok}")
        if flat.get("assignees"):                 # 담당자 이름 → 계정(서버 안에서만 풀린다)
            by_name = {v: k for k, v in who.items()}
            flat = {**flat, "assignees": [by_name[str(n)] for n in flat["assignees"] if str(n) in by_name]}
        if target == "building" and "jimoks" not in flat and "jimoks" not in nots:
            nots = {**nots, "jimoks": list(_PUBLIC_JIMOK)}
        # 넓은 검색 막이(11b ③) — 매물이 아닌 건물까지(서울 전 건물)는 어디를 볼지가 있어야 돈다
        if scope == "all" and not _where(flat):
            raise ValueError("TOO_WIDE: 「매물: 전체」는 어디를 볼지가 있어야 한다. 「지역」·「주소」·「법정동코드」를 걸거나 「매물」을 뺀다")
        f_ok = fields if target == "building" else [f for f in fields if f in _VACANT_FIELDS]
        s_ok = sort_col[srt]
        col_asc = (asc == "오름차순") != age        # 나이 이름은 날짜 칸을 거꾸로
        if target == "vacant" and s_ok not in _VACANT_FIELDS:
            s_ok = "price"
        okc = _FIELDS_OK if target == "building" else set(_VACANT_FIELDS)
        if s_ok in okc and s_ok not in f_ok:
            f_ok = [*f_ok, s_ok]
        if target == "building":
            # 뼈대(주인 · 매매가 · 주인마다 딸린 칸) · 핀 · 같은 지번 구분(주용도 · 연면적 · 층수)에 쓰는 칸 —
            # 물어본 칸이 아니면 줄에서 다시 걷는다
            need = ["lng", "lat", "kind", "price", "listing_rank", "owner", "office", "ad_id", "mk_on", "mk_n", "is_listing",
                    "main_use_name", "total_area", "floors_above", "n_bldg", "uses"]
            if "추정가" in want:
                need += ["pp_land", "pp_total", "gongsi_ratio"]
            extra = [c for c in need if c not in f_ok]
            f_ok = [*f_ok, *extra]
            if "float_pop" in f_ok:
                f_ok = [*f_ok, "float_pop_night"]
        else:
            extra = []
        quiet = {names.ko(c) for c in extra if c in ("main_use_name", "total_area", "floors_above")}
        out: dict[str, Any] = {}
        if label:
            out["펼친조건"] = label
        sold = bool(flat.get("addr"))                # 한 채를 짚었으면 매각된 내 매물도 내 매물(10-04 「가」)
        mk = lambda sc, n: SearchIn(filters=Filters(nots=nots or None, **flat), fields=f_ok, sort=s_ok,  # noqa: E731
                                    sort_asc=col_asc, target=target, per_page=n, scope=sc if target == "building" else "",
                                    for_model=True, sold_mine=sold)
        tasks = [search(mk(scope, per), user)]
        # 매물만 봤으면 **매물이 아닌 건물(일반)은 수만** 같이 준다(11b ③) — 매물이 적을 때 「조건에 맞는 건물은 N채」가
        # 응답에 있어야 넓혀 찾기 · 구해요로 이어갈 근거가 생긴다. 세기 한 번이라 싸다(per_page 1 — 0 은 쪽수 셈에서 0 나누기)
        count_normal = target == "building" and scope == "any" and _where(flat)
        if count_normal:
            tasks.append(search(mk("none", 1), user))
        raws = await asyncio.gather(*tasks)
        raw = raws[0]
        if raw.get("matched"):
            out["지역"] = raw["matched"]
        blk = raw.get(scope) if target == "building" else raw.get("normal")
        items = (blk or {}).get("items") or []
        _collect_pins(items, target == "vacant")
        biz_names = raw.get("biz_names") or {}
        word = next((m.get("낱말") for m in (raw.get("biz") or []) if m.get("낱말")), None)
        out["전체"] = (blk or {}).get("total", 0)
        if count_normal:
            out["일반"] = (raws[1].get("none") or {}).get("total", 0)
        ads = await _ad_info([r.get("ad_id") for r in items if r.get("owner") == "office"])
        rows = [_row(r, ads, biz_names, word, who, want) for r in items]
        # 같은 지번에 **건물이** 여럿이면 구분 칸(주용도 · 연면적 · 지상층수)을 남긴다. 아니면 물어본 칸만.
        # 같은 건물의 매물 여럿은 건물 여럿이 아니다 — 건물 번호로 센다
        pks_at: dict[str, set] = {}
        for r in rows:
            pks_at.setdefault(r.get("주소", ""), set()).add(r.get("_pk"))
        seen = {a: len(v) for a, v in pks_at.items()}
        for r in rows:
            if seen.get(r.get("주소", ""), 0) < 2:
                for k in quiet:
                    if k == "주용도" and "동수" in r:     # 여러 동 지번의 동 주용도 목록은 남긴다(0230)
                        continue
                    r.pop(k, None)
        if len(rows) < out["전체"]:
            out["보여준수"] = len(rows)
        out["목록"] = rows
        if my_secs:
            await _attach(out, my_secs, target == "vacant", user)
        for row in out.get("목록", []):               # 묶음을 다 붙였으니 내부 번호를 걷는다
            row.pop("_pk", None)
        if len(jobs) > 1:
            return {"조건": asked, **out}
        return out

    got = await asyncio.gather(*(one(c, l, pr) for c, l, pr in jobs), return_exceptions=True)
    if len(jobs) == 1 and isinstance(got[0], BaseException):
        raise got[0]
    rows = [g if isinstance(g, dict) else {"조건": c, "오류": str(g)[:300]}
            for (c, _l, _p), g in zip(jobs, got, strict=True)]
    return {"단위": names.UNITS, "검색": rows}


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
    return f"B{-n}" if n < 0 else f"{n}층"      # 지하는 「B1」(10-01, 화면과 같게)


def _floors_for_model(raw: dict) -> dict:
    """층별 — 대장과 업체 원장만(2026-09-26 나눔). 모든 건물에 같은 모양으로 온다.

      층 · 바닥면적 · 용도 · 전유부   대장(층별개요 + 전유부)
      업체                            지금 있는 업체(카카오 장소 크롤링, master.biz). 누가 있다는 것만

    임대료·공실은 여기 없다 — 「임대료」 목록에 있다(내 매물 · 네이버 임대시세). 빈 칸 투성이 임대 칸을
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


# ── 묶음 퍼 오기 ────────────────────────────────────────────────────────────
# `_run_building` 안에 갇혀 있던 것을 꺼냈다(2026-09-21). 검색 줄에도 묶음을 붙이려면
# 두 곳에서 같은 함수를 불러야 하고, 복제하면 한쪽만 고쳐질 자리가 생긴다.
_LIST_MAX = 20      # 한 묶음이 낼 줄 수. 소식·매각 둘 다


def _held(key: str, v, o: dict):
    """대장에 실려 오던 목록 넷 — 부르면 전부 주고, 좁히는 건 손잡이가 한다."""
    if key in ("버스정류장", "지하철역"):
        rows = list(v or [])
        if (r := o.get("반경")):
            rows = [x for x in rows if (x.get("거리") or 0) <= int(r)]
        # 같은 이름이 여러 번 온다(「삼성역7번출구」가 셋). 가장 가까운 것만 남긴다
        seen: set = set()
        out = []
        for x in sorted(rows, key=lambda x: x.get("거리") or 0):
            nm = x.get("정류장명") or x.get("역명")
            if nm in seen:
                continue
            seen.add(nm)
            out.append(x)
        return out[:int(o.get("줄수") or len(out))]
    rows = list(v or [])
    if (y := o.get("연수")):
        cut = dt.date.today().year - int(y)
        # 공시는 [연도, 값], 실거래는 {"ym": "202108", …} 다
        rows = [x for x in rows
                if int(str(x[0] if isinstance(x, list) else x.get("ym", x.get("계약월", "")))[:4] or 0) >= cut]
    return rows[-int(o["줄수"]):] if o.get("줄수") else rows


_HELD = ("버스정류장", "지하철역", "공시지가추이", "실거래이력")


def _rents_for_model(items: list[dict]) -> list[dict] | None:
    """임대료 목록(0224) — 출처 · 범위(건물 전체 · 층) · 보증금 · 월세 · ㎡당월세. 실제 값만이다(추정임대는 0239 에서 삭제)"""
    out = []
    for x in items:
        d = {"출처": x["source"], "범위": _floor_label(x["scope"]) if x["scope"] not in ("건물 전체", "층 모름") else x["scope"],
             "호수": x.get("unit_no"), "상호": x.get("tenant"), "면적": x.get("area"),
             "보증금": _won(x.get("deposit")), "월세": _won(x.get("rent")), "관리비": _won(x.get("mgmt")),
             "㎡당월세": x.get("ppm"), "공실면적": x.get("vacant_area"), "날짜": x.get("on_date"), "광고수": x.get("n_ads")}
        out.append({k: v for k, v in d.items() if v is not None})
    return out[:_LIST_MAX] or None


async def _sec_pairs(pk: str, user: CurrentUser) -> dict | None:
    """짝 묶음(11b, 중개사만) — 이 매물에 담긴 우리 고객 · 매수희망가 · 채택 · 계약(0222 짝 칸)"""
    if user.team_id is None:
        return None
    rows = await pool().fetch(
        """SELECT p.buyer_id, y.name, p.hope_price, p.deal_price, p.picked_at, p.dropped_at,
                  p.contract_on, p.mid_on, p.mid_amount, p.balance_on
             FROM app.proposals p JOIN app.buyers y ON y.id = p.buyer_id AND y.deleted_at IS NULL
             JOIN app.listing_parcels lp ON lp.listing_id = p.listing_id AND lp.main
            WHERE p.team_id = $1 AND lp.pnu = $2 ORDER BY p.picked_at NULLS LAST, p.updated_at DESC""",
        user.team_id, await _pnu(pk, False))
    if not rows:
        return None
    out = []
    for r in rows:
        d = {"고객": r["name"], "매수희망가": r["hope_price"],
             "채택": r["picked_at"] is not None, "안산다": r["dropped_at"] is not None or None,
             "계약가": r["deal_price"] if r["picked_at"] else None,
             "계약일": r["contract_on"], "중도금일": r["mid_on"], "중도금": r["mid_amount"], "잔금일": r["balance_on"]}
        out.append({k: v for k, v in d.items() if v is not None})
    return {"전체": len(out), "목록": out[:_LIST_MAX]}


async def _pnu(pk: str, vacant: bool) -> str:
    """동 번호 → 지번(지번 경로가 받는 열쇠). 나대지는 이미 지번이다"""
    return pk if vacant else await pool().fetchval("SELECT app.pnu_of($1)", pk)


async def _section(pk: str, key: str, o: dict, user: CurrentUser,
                   vacant: bool = False):
    # 중개사만 보는 묶음 — 고객 스키마엔 이름이 없고, 우회해도 여기서 빈다(11b §4)
    if key in names.BROKER_SECTIONS and mode_of(user) != "broker":
        return None
    if key == "임대료":
        return _rents_for_model(await rents_for(user, await _pnu(pk, vacant)))
    if key == "짝":
        return None if vacant else await _sec_pairs(pk, user)   # 나대지 짝은 아직 지도 열쇠가 없어 안 낸다
    if key in _HELD:
        # 대장 원본(상세보기와 같은 공개 사실, 10-02 raw)에서 뗀다. 위치 인자로 부르다 user 자리에
        # raw 가 들어가 매번 죽었다(10-04) — 이름으로 넘긴다
        raw = await (par.get_parcel(pk, user) if vacant else bld.get_building(pk, raw=True, user=user))
        led = _clean(raw)
        return _held(key, led.get(key), o) or None
    if key == "시간대별유동인구":
        # 생활인구 격자. 주간·야간은 「유동인구」 칸이 준다. 상권구성 묶음은 2026-10-07 에 뺐다
        r = dict(await par.parcel_pop(await _pnu(pk, vacant), user))
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
                       # 「영업」은 신고상이다. 폐업 신고를 안 하면 남는다. **지금 있는지는 크롤링으로만 본다** —
                       # 확인되면 「지금 있음」, 안 되면 「모름」. 인허가 「영업」을 그대로 넘기지 않는다
                       "상태": x["state"] if x["state"] in ("폐업", "휴업")
                               else ("지금 있음" if x.get("now") else "모름")} for x in rows[:_LIST_MAX]]
        sec["목록"] = [{k: v for k, v in d.items() if v is not None} for d in sec["목록"]]
        if r["ecommerce"]:
            sec["통신판매업"] = r["ecommerce"]      # 줄로 안 세운다 — 주소만 올린 것이 섞인다
        return sec
    if key == "층별":
        return _floors_for_model(await flr.building_floors(pk, user))
    if key == "필지":
        return _clean(await par.get_lands(await _pnu(pk, vacant), user=user), nested=True, sec=key)
    if key == "주변실거래":
        return _clean(await par.nearby_trades(await _pnu(pk, vacant), int(o.get("반경") or 500),
                                              int(o.get("연수") or 5), 8, user),
                      nested=True, sec=key)
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
                            pnu=await _pnu(pk, vacant))
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
        raw = await par.parcel_events(await _pnu(pk, vacant), int(o.get("반경") or 700), o.get("갈래"),
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


@dataclass(frozen=True)
class Tool:
    """도구 하나. 스키마와 실행이 같은 줄에 있어야 어긋나지 않는다."""
    name: str
    description: str
    schema: Callable[[dict[str, list[str]]], tuple[dict, list[str]]]
    run: Callable[[dict[str, Any], CurrentUser], Awaitable[Any]]


# ── 투자 셈 두 도구(2026-09-24) ─────────────────────────────────────────────
#
# **이 도구의 값은 산수가 아니라 이름이다.** 곱셈은 모델도 한다. 그런데 「투자 시나리오를
# 짜 줘」에 모델이 낸 금전 정보는 추정가 한 줄뿐이었다(2026-09-22 관악구 병원 실측) —
# 총투자비·대출·자기자본 수익률은 생각이 거기까지 안 갔다. 주차도 「기준이 엄격하니 검토가
# 필요합니다」라고 **말로 때웠다.** 사전에 이름이 있어야 모델이 그걸 셈한다.
#
# 모르는 값은 기본값을 깔지 않고 **필수로 받는다.** 우리 추정을 넣었으면 나가는 이름에
# 「추정」이 붙는다 — 화면의 0134 규칙(추정 임대료로 ROE 를 안 센다)을 뒤집지 않고 푸는 길이다.

# 건물 고르기 — **건물 조회의 조건 항목과 같은 모양**(11b ②). 주소가 유일하지 않은 지번(서울 23,465곳)은
# 주용도 · 연면적 · 지상층수를 더 걸어 좁힌다. 여러 채가 걸리면 셈은 그 채들을 다 센다.
_PICK_ITEM = {"type": "object", "properties": {
    "주소": {"type": "string", "description": "건물 조회 줄의 주소(지번 · 도로명)"},
    "주용도": {"type": "object", "properties": {"값": {"type": "array", "items": {"type": "string"}}}},
    "연면적": {"type": "object", "properties": {"이상": {"type": "number"}, "이하": {"type": "number"}}},
    "지상층수": {"type": "object", "properties": {"이상": {"type": "number"}, "이하": {"type": "number"}}},
}, "required": ["주소"]}
_MONEY_PK = {
    "description": "셀 건물. 건물 조회 줄의 주소를 그대로 넣는다. 같은 지번에 건물이 여럿이면 주용도 · 연면적으로 좁힌다. 여러 채면 목록",
    "anyOf": [_PICK_ITEM, {"type": "array", "items": _PICK_ITEM}],
}
_MONEY_DEAL = {"type": "number",
               "description": "원. 얼마에 사느냐. 안 주면 매매가마다 한 줄씩 센다(출처가 달라 여럿일 수 있다). 매매가가 없으면 추정가"}

_INVEST_DESC = (
    "사는 셈. 한 해짜리다 — 총투자비·대출·연 이자·연 순수익·자기자본 수익률을 낸다. "
    "임대료는 실측이면 「연임대료」, 실측이 아니면 「추정연임대」로 넣는다(둘 중 하나 필수). "
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
            "건물": _MONEY_PK,
            "자기자본": {"type": "number", "description": "원"},
            "금리": {"type": "number", "description": "연 %. 지어내지 말고 사용자에게 받는다"},
            "연임대료": {"type": "number",
                      "description": "원/년. **실측**일 때만 — 층별 합계이거나 팀이 적은 총액"},
            "추정연임대": {"type": "number",
                       "description": "원/년. 실측이 아닌 값(예: 주변 임대료로 셈한 값). "
                                      "넣으면 나가는 이름이 전부 「추정 …」이 된다"},
            "거래금액": _MONEY_DEAL,
            "부대비용률": {"type": "number", "description": f"%. 안 주면 {calc.FEE_PCT_DEFAULT}"},
        },
        "required": ["건물", "자기자본", "금리"],
    }, []


def _develop_schema(_enums: dict[str, list[str]]) -> tuple[dict, list[str]]:
    return {
        "type": "object",
        "properties": {
            "건물": _MONEY_PK,
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
        "required": ["건물", "추정공사단가", "추정완성단가"],
    }, []


async def _pks(args: dict[str, Any], user: CurrentUser) -> list[str]:
    """건물 고르기 → 건물들. 건물 조회와 **같은 사전 · 같은 주소 해석**으로 푼다(catalog.parse · search). 내부 번호는 모델이 모른다."""
    raw = args.get("건물")
    picks = raw if isinstance(raw, list) else [raw]
    picks = [p for p in picks if isinstance(p, dict) and str(p.get("주소") or "").strip()]
    if not picks:
        raise ValueError("「건물」이 없다. 건물 조회 줄의 주소를 넣는다: {\"주소\": \"종로구 누상동 94\"}")
    mode = mode_of(user)
    ctx = await catalog.context(user, mode)
    pks: list[str] = []
    for p in picks[:20]:
        flat, nots, *_r = catalog.parse(p, mode, ctx)
        got = await pks_by_addr(flat["addr"])
        if len(got) > 1 and len(p) > 1:            # 주소 말고 좁히는 조건이 있으면 검색으로 거른다
            raw_s = await search(SearchIn(filters=Filters(nots=nots or None, **flat), fields=[], sort="land_area",
                                          per_page=20, for_model=True), user)
            got = [r["building_pk"] for c in ("mine", "normal") for r in (raw_s.get(c) or {}).get("items") or []]
        if not got:
            raise ValueError(f"「{p['주소']}」에 맞는 건물을 못 찾았다")
        pks += got
    return pks[:20]


async def _ours(pks: list[str], user: CurrentUser) -> dict[str, dict]:
    """셈에 쓸 우리 값. **검색을 그대로 부른다** — 도구가 낸 숫자와 검색 줄이 갈리면 안 된다.
    매매가는 그 건물의 보이는 매물(0226)에서 붙인다(listings). 나대지(필지번호 19자리)는 표가 달라 따로 부른다."""
    want = ["land_area", "legal_far", "legal_bcr", "sale_est"]
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
    # 매물은 지번에 붙는다(0255) — 줄마다 그 지번의 보이는 매물(매각된 내 매물도)
    lmap = await listings_of(user, [str(v.get("pnu")) for v in out.values() if v.get("pnu")], keep_sold=True)
    for v in out.values():
        v["listings"] = lmap.get(str(v.get("pnu")), [])
    return out


def _one(v: Any) -> tuple[float | None, list]:
    """법정 건폐·용적은 나대지 쪽이 **배열**이다 — 용도지역이 걸친 필지는 값이 둘 이상이다(0153).
    하나면 풀어 쓰고, 여럿이면 **고르지 않는다.** 둘 중 하나를 몰래 고르면 답이 통째로 갈린다."""
    if isinstance(v, (list, tuple)):
        vals = [x for x in v if x is not None]
        return (float(vals[0]), []) if len(vals) == 1 else (None, list(vals))
    return (float(v), []) if v is not None else (None, [])


def _deals(args: dict[str, Any], row: dict) -> list[tuple[float, str]]:
    """거래금액과 그 출처들. 받은 것이 먼저, 없으면 **매물마다 하나씩**(매물 하나에 매매가 하나 · 0226), 그것도 없으면 추정가."""
    if (v := args.get("거래금액")) is not None:
        return [(float(v), "받은 값")]
    got = [(float(m["price"]), f"매매가({'내 매물' if m['owner'] == 'mine' else m['office']})")
           for m in row.get("listings") or [] if m.get("price")]
    if got:
        return got
    if (v := row.get("sale_est")) is not None:
        return [(float(v), "추정가")]
    raise ValueError("거래금액이 없다. 매매가도 추정가도 없는 건물이라 「거래금액」을 직접 넣어야 한다")


def _tag(out: dict, est: bool) -> dict:
    """우리 추정을 깔고 셌으면 나가는 이름에 「추정」을 박는다. 이름이 그걸 지고 있어야 한다."""
    if not est:
        return out
    return {(k if k.startswith("추정") else f"추정 {k}"): v for k, v in out.items()}


async def _run_invest(args: dict[str, Any], user: CurrentUser) -> Any:
    real, est_rent = args.get("연임대료"), args.get("추정연임대")
    if real is None and est_rent is None:
        raise ValueError("임대료가 없다. 실측이면 「연임대료」, 실측이 아니면 「추정연임대」에 "
                         "연 임대료(원)를 넣는다. 레버리지가 오차를 키워서 임대료 없이는 안 센다")
    for k in ("자기자본", "금리"):
        if args.get(k) is None:
            raise ValueError(f"「{k}」가 없다. 기본값을 지어내지 않는다 — 사용자에게 받아 넣는다")
    rent = float(real if real is not None else est_rent)
    pks = await _pks(args, user)
    rows, ours = [], await _ours(pks, user)
    for pk in pks:
        row = ours.get(pk)
        if row is None:
            rows.append({"안 찾음": "우리 자료에 없는 건물이다"})
            continue
        # **한 채가 막혀도 나머지는 낸다.** 봉익동 67(추정가 없음) 하나로 세 채가 통째로
        # 죽었다(2026-09-24). 막힌 줄은 막혔다고 그 줄에 적는다 — 조용히 빠지지 않는다.
        try:
            deals = _deals(args, row)
        except ValueError as e:
            rows.append({"주소": row.get("addr"), "안 셈": str(e)})
            continue
        for deal, src in deals:
            est = real is None or src == "추정가"
            got = calc.buy(거래금액=deal, 자기자본=float(args["자기자본"]), 금리=float(args["금리"]),
                           연임대료=rent, 부대비용률=args.get("부대비용률"))
            rows.append({"주소": row.get("addr"),
                         "기준": f"거래금액 {src} · 임대 {'추정연임대' if real is None else '연임대료'}",
                         **_tag(got, est)})
    return {"단위": names.UNITS, "투자": rows}


async def _run_develop(args: dict[str, Any], user: CurrentUser) -> Any:
    for k in ("추정공사단가", "추정완성단가"):
        if args.get(k) is None:
            raise ValueError(f"「{k}」가 없다. 원/평으로 넣는다. 기본값을 지어내지 않는다 — "
                             f"평당 얼마로 볼지가 답을 지배하므로 그 숫자가 드러나야 한다")
    pks = await _pks(args, user)
    rows, ours = [], await _ours(pks, user)
    for pk in pks:
        row = ours.get(pk)
        if row is None:
            rows.append({"안 찾음": "우리 자료에 없는 건물이다"})
            continue
        area = row.get("land_area")
        far, far_many = _one(row.get("legal_far"))
        bcr, _ = _one(row.get("legal_bcr"))
        if far_many:
            rows.append({"주소": row.get("addr"),
                         "안 셈": f"용도지역이 걸쳐 있어 법정용적률이 여럿이다({'·'.join(map(str, far_many))}%). "
                                f"어느 쪽으로 볼지 정해야 한다"})
            continue
        if not area or not far:
            rows.append({"주소": row.get("addr"),
                         "안 셈": "대지면적이나 법정용적률이 없어 규모를 못 낸다"})
            continue
        try:
            deals = _deals(args, row)
        except ValueError as e:
            rows.append({"주소": row.get("addr"), "안 셈": str(e)})
            continue
        for deal, src in deals:
            got = calc.build(대지면적=float(area), 법정용적률=far, 법정건폐율=bcr,
                             거래금액=deal, 추정공사단가=float(args["추정공사단가"]),
                             추정완성단가=float(args["추정완성단가"]),
                             부대비용률=args.get("부대비용률"))
            rows.append({"주소": row.get("addr"),
                         "기준": f"대지 {float(area):,.0f}㎡ · 법정용적률 {float(far):g}% · 거래금액 {src}",
                         **got})
    return {"단위": names.UNITS, "신축": rows}


# ── 자료 만들기(2026-09-24) ─────────────────────────────────────────────────
#
# **우리가 주는 건 .slide 한 클래스뿐이다**(대표 10-06) — 한 장 크기와 인쇄 장 나눔.
# 차트·표·그림은 **모델이 SVG·HTML 로 직접 그린다.** 부품(지적도·사진) · 색 토큰 · 표 · 나눔 틀은 없앴다(2026-10-06 대표) —
# 있으니 모델이 물음과 상관없이 늘 끼워 넣었다. 부품이 울타리가 되면 자유가 깎인다.
#
# 글과 판단은 우리가 안 쓴다. 「신축용으로 좋다」는 자료를 보는 사람의 몫이다.

_HOWTO = (
    "HTML 을 그대로 쓴다. 한 장은 <section class=\"slide\"> 다(slides 는 1280×720, doc 은 A4 폭). "
    "굽는 쪽이 이 크기와 인쇄 장 나눔만 박아 준다. 색 · 글꼴 · 표 · 배치는 직접 쓴다.\n"
    "차트·그림은 <svg> 로 직접 그린다. 축·눈금·값 라벨을 넣는다.\n"
    "한 장에 큰 그림 하나 · 중간 둘 · 작은 값 넷까지. 글이 그림에 있는 숫자를 되풀이하지 않는다.\n"
    "로고·인장은 넣지 않는다. 중개인이 손님에게 주는 자료지 우리 자료가 아니다."
)
_MAKE_DESC = (
    "자료를 만든다. 슬라이드나 문서를 HTML 로 써서 넘기면 화면 오른쪽에 뜬다. PDF 는 거기서 인쇄한다. "
    "숫자는 먼저 buildings · invest · develop 으로 받아 쓴다. " + _HOWTO
)


def _make_desc_t(t: dict, have: dict[str, int] | None = None) -> str:
    """사용자가 템플릿을 고른 요청의 make 설명 — 그 템플릿의 작성 규격이 그대로 붙는다(0235).
    have = 이 사무소가 가진 재료 수(홍보 사진 · 로고) — 사실로만 알린다"""
    parts = ", ".join(f"<bt-{p}>" for p in t.get("parts") or []) or "없음"
    own = ""
    if have is not None:
        own = f" 이 사무소가 가진 것: 홍보 사진 {have.get('promo', 0)}장 · 로고 {'있음' if have.get('logo') else '없음'}."
    return (f"자료를 만든다. **사용자가 「{t['name']}」 템플릿을 골랐다** — 아래 규격대로 HTML 을 써서 넘긴다. "
            f"지면 {t.get('size') or ''} · 쓸 수 있는 부품 {parts}.{own} 숫자는 먼저 buildings · invest · develop 으로 받아 쓴다. "
            "굽는 쪽이 이 템플릿의 틀(색 · 글꼴 · 지면)을 머리에 박아 준다.\n\n"
            "**대표 규칙** — 아래 규격은 기본 모양이다. 사용자가 고쳐 달라고 하면 fix 로 그 부분을 고친다. "
            "사용자가 규격과 다른 모양을 원하면 그 요청대로 바꾸고, 지면에 custom 클래스를 붙인다"
            "(`<section class=\"slide custom\">` — 틀이 막아 둔 모양이 풀린다).\n\n" + t["guide"])
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
                        kind=str(args.get("갈래") or "slides"),
                        template=_TEMPLATE.get())      # 고른 템플릿은 요청이 정한다 — 모델 인자가 아니다
    if not body.html.strip():
        raise ValueError("html 이 비었다. 자료 본문을 HTML 로 써서 넘긴다")
    got = await art.create(body, user.account_id)
    _panel({"view": "artifact", "id": got["id"], "ver": got["ver"]})
    return {"자료번호": got["id"], "제목": got["제목"], "판": got["ver"], "보임": "화면 오른쪽"}


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
    _panel({"view": "artifact", "id": got["id"], "ver": got["ver"]})
    return {"자료번호": got["id"], "판": got["ver"], "보임": "화면 오른쪽"}


# ── 지도(2026-10-06 · 0235) ───────────────────────────────────────────────────
#
# 오른쪽 판에 지도를 띄우는 **유일한 길**이다. 건물을 읽었다고 지도가 뜨지 않는다 — 읽기는 핀을 남길 뿐,
# 판을 여는 건 이 도구(또는 사람이 건물 카드의 지도 아이콘을 누를 때)다.

_MAP_DESC = ("화면 오른쪽에 지도를 띄운다. **자리가 답일 때만** 부른다 — 「어디에 있나」 「주변 매물 비교」 「이 구역 매물들」처럼 "
             "위치 · 거리 · 분포를 보여 줘야 이해되는 물음. 값 하나 · 표로 충분한 물음에는 부르지 않는다. "
             "띄울 땅을 주소(지번 · 도로명)로 준다. 먼저 buildings 로 찾은 주소를 그대로 쓴다")


def _map_schema(_e: dict[str, list[str]]) -> tuple[dict, list[str]]:
    return {"type": "object",
            "properties": {"주소": {"type": "array", "items": {"type": "string"}, "maxItems": 50,
                                   "description": "띄울 땅의 주소들"}},
            "required": ["주소"]}, []


async def _run_map(args: dict[str, Any], user: CurrentUser) -> Any:
    addrs = [str(a).strip() for a in (args.get("주소") or []) if str(a).strip()][:50]
    if not addrs:
        raise ValueError("「주소」가 없다. 띄울 땅의 주소를 목록으로 준다")
    reps: list[str] = []
    miss: list[str] = []
    for a in addrs:
        got = await pks_by_addr(a)
        b = [x for x in got if not (len(x) == 19 and x.isdigit())]     # 나대지 필지는 지도 핀이 아직 없다
        if not b:
            miss.append(a); continue
        # 그 동의 지번 대표 동으로 맞춘다(지번 하나에 핀 하나)
        r = await pool().fetchval(
            """SELECT pr.rep_pk FROM master.buildings x JOIN master.parcel_rep pr ON pr.pnu = x.pnu
                WHERE x.building_pk = $1""", b[0]) or b[0]
        if r not in reps:
            reps.append(r)
    rows = await pool().fetch(
        """SELECT b.building_pk, pr.pnu, b.addr, ST_X(b.geom) AS lng, ST_Y(b.geom) AS lat, b.land_area, pr.total_area,
                  se.sale_est   -- 지번 추정가(0250)
             FROM master.buildings b JOIN master.parcel_rep pr ON pr.rep_pk = b.building_pk
             LEFT JOIN master.parcel_sale_est se ON se.pnu = pr.pnu
            WHERE b.building_pk = ANY($1::text[])""", reps)
    lst = await listings_of(user, [r["pnu"] for r in rows])
    col = {"mine": "mine", "office": "ad", "crawl": "market"}
    items = []
    for r in rows:
        first = (lst.get(r["pnu"]) or [None])[0]
        items.append({**dict(r), "kind": col.get(first["owner"]) if first else "normal",
                      "price": first["price"] if first else None})
    _collect_pins(items, False)
    _panel({"view": "map", "pks": [r["building_pk"] for r in rows]})
    return {"지도에 띄움": len(rows), **({"못 찾음": miss} if miss else {})}


_MAP = Tool("map", _MAP_DESC, _map_schema, _run_map)


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


# ── 모델 SQL(0238 · 2026-10-06 시험) ─────────────────────────────────────────
# 손잡이 밖의 물음(칸끼리 · 줄끼리 견주기 · 모으기)을 모델이 SQL 로 직접 푼다.
# **벽은 권한이다.** 서버가 그 사무소의 매물 줄(ai.listing_rows)을 뽑아 bt_query 접속의 임시 표 「매물」에 넣고,
# 모델 SQL 은 그 접속에서 읽기 전용으로 돈다. bt_query 는 어떤 스키마에도 권한이 없다 — 남의 사무소 · 원본 표를
# 써도 DB 가 거절한다. 여러 문장은 asyncpg 의 준비문이 거절한다. 설명 글엔 표 이름과 칸 이름만 싣는다.
_QUERY_FN = "ai.listing_rows(bigint, boolean)"


def _query_dsn() -> str:
    from ..core.config import settings
    if settings.query_database_url:
        return settings.query_database_url
    head, _, tail = settings.database_url.partition("://")
    return f"{head}://bt_query:bt_query_dev@{tail.rpartition('@')[2]}"


async def _query_cols() -> list[tuple[str, str]]:
    """함수가 내는 칸 이름과 형 — 표를 손으로 적지 않는다(설명 · 임시 표 둘 다 여기서)."""
    r = await pool().fetchrow(       # proargmodes 는 "char"[] 라 글로 바꿔 읽는다
        """SELECT proargnames AS n, proargmodes::text[] AS m, proallargtypes AS t FROM pg_proc
            WHERE oid = $1::regprocedure""", _QUERY_FN)
    types = {o: await pool().fetchval("SELECT format_type($1::oid, NULL)", o) for o in set(r["t"])}
    return [(n, types[t]) for n, m, t in zip(r["n"], r["m"], r["t"], strict=True) if m == "t"]


async def _query_desc() -> str:
    return "매물(" + ", ".join(n for n, _t in await _query_cols()) + ")"


def _query_schema(_e: dict[str, list[str]]) -> tuple[dict, list[str]]:
    return {"type": "object", "properties": {"sql": {"type": "string"}}, "required": ["sql"]}, []


def _qv(v: Any) -> Any:
    if isinstance(v, (dt.date, dt.datetime)):
        return v.isoformat()
    if isinstance(v, list):
        return [_qv(x) for x in v]
    if v is not None and not isinstance(v, (str, int, float, bool)):
        f = float(v)                                   # NUMERIC(Decimal)
        return int(f) if f.is_integer() else f
    return v


async def _run_query(args: dict[str, Any], user: CurrentUser) -> Any:
    import asyncpg
    if mode_of(user) != "broker":
        raise ValueError("「query」는 없는 도구다")
    sql = str(args.get("sql") or "").strip().rstrip(";").strip()
    if not sql:
        raise ValueError("sql 이 비었다")
    cols = await _query_cols()
    rows = await pool().fetch(f"SELECT * FROM {_QUERY_FN.split('(')[0]}($1, TRUE)", user.team_id)
    conn = await asyncpg.connect(_query_dsn(), server_settings={"statement_timeout": "10000", "timezone": "Asia/Seoul"})
    try:
        ddl = ", ".join(f'"{n}" {t}' for n, t in cols)
        await conn.execute(f'CREATE TEMP TABLE "매물" ({ddl})')
        await conn.copy_records_to_table("매물", records=[tuple(r) for r in rows], schema_name="pg_temp")
        try:
            async with conn.transaction(readonly=True):
                stmt = await conn.prepare(sql)
                got = await stmt.fetch()
                names_ = [a.name for a in stmt.get_attributes()]
        except asyncpg.exceptions.QueryCanceledError:
            raise ValueError("10초 안에 안 끝났다") from None
        except asyncpg.PostgresError as e:
            pos = getattr(e, "position", None)
            raise ValueError(f"{e}" + (f" (자리 {pos})" if pos else "")) from None
    finally:
        await conn.close()
    budget = _BUDGET * _CHARS_PER_TOK
    out, used = [], 0
    for r in got:
        row = [_qv(v) for v in r]
        used += len(json.dumps(row, ensure_ascii=False))
        if out and used > budget:
            break
        out.append(row)
    return {"전체": len(got), "보낸수": len(out), "칸": names_, "줄": out}


_INVEST = Tool("invest", _INVEST_DESC, _invest_schema, _run_invest)
_DEVELOP = Tool("develop", _DEVELOP_DESC, _develop_schema, _run_develop)
_ASK = Tool("ask", _ASK_DESC, _ask_schema, _run_ask)
# 모드마다 **도구 목록이 따로다**(11 §2-2). 선언도 디스패치도 그 모드 목록 안에서만 한다 —
# 고객 모델은 `customers` · `make` 를 선언받지 못하고, 이름을 지어내 불러도 「없는 도구」다.
TOOLS: dict[str, tuple[Tool, ...]] = {
    "broker": (
        Tool("buildings", _BUILDINGS_DESC, _buildings_schema, _run_buildings),
        Tool("customers", people.CUSTOMERS_DESC, people.customers_schema, people.run_customers),
        Tool("query", "", _query_schema, _run_query),
        _INVEST, _DEVELOP, _MAP,
        Tool("make", _MAKE_DESC, _make_schema, _run_make),
        Tool("fix", _FIX_DESC, _fix_schema, _run_fix),
        _ASK,
    ),
    "customer": (
        Tool("buildings", _BUILDINGS_DESC, _buildings_schema, _run_buildings),
        Tool("me", people.ME_DESC, people.me_schema, people.run_me),
        _INVEST, _DEVELOP, _MAP, _ASK,
    ),
}


def tools_for(user: CurrentUser) -> tuple[Tool, ...]:
    return TOOLS[mode_of(user)]


async def build(user: CurrentUser, template: str | None = None) -> dict:
    """모델에게 그대로 넘길 도구 배열. **모드 · 사무소 · 사람마다 다르다** — 이름 · 갈래 · 값을 선언 표와 정본에서 만든다
    (상태 이름 · 팀원 · 저장조건이 그 사람 것으로 들어간다).
    **요청마다도 다르다**(0235): 사용자가 자료 템플릿을 고른 요청에서만 make 설명이 그 템플릿의 작성 규격이 된다.
    고르지 않은 요청에서 모델은 템플릿 · 부품 · 색 토큰이 있다는 것조차 모른다."""
    from ..render import templates as tpl
    mode = mode_of(user)
    ctx = await catalog.context(user, mode)
    chosen = tpl.get(template)
    tools, hidden = [], {}
    for t in TOOLS[mode]:
        schema, dropped = t.schema(ctx)
        desc = t.description
        if t.name == "query":
            desc = await _query_desc()
        if t.name == "make" and chosen:
            have = None
            if user.team_id is not None and {"promo", "office"} & set(chosen.get("parts") or []):
                r = await pool().fetchrow(
                    """SELECT (SELECT count(*) FROM app.team_promo_photos WHERE team_id = $1) AS promo,
                              (SELECT logo_path IS NOT NULL FROM app.teams WHERE id = $1) AS logo""", user.team_id)
                have = {"promo": r["promo"], "logo": bool(r["logo"])}
            desc = _make_desc_t(chosen, have)
            schema = {**schema, "properties": {k: v for k, v in schema["properties"].items() if k != "갈래"}}
        tools.append({"name": t.name, "description": desc, "input_schema": schema})
        if dropped:
            hidden[t.name] = dropped
    from . import agent                      # 늦게 들여온다 — agent 가 우리를 들여온다
    return {
        "mode": mode,
        "vendor": agent.vendor(),
        "model": agent.model_name(),
        "tools": tools,
        "hidden": {"filters": hidden, "params": ["sort", "per_page"]},
        "counts": {
            "tools": len(tools),
            "filters": len(tools[0]["input_schema"]["properties"]["조건"]["items"]["properties"]),
            "hidden": sum(len(v) for v in hidden.values()),
            "names": len(catalog.names_for(mode)),
        },
    }
