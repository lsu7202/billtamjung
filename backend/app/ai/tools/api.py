"""우리 API 를 부르는 도구 셋 — 화면이 쓰는 길. 정본 10-AI-어시스턴트 §3-1 · §9-4

## 왜 SQL 이 아니라 이 길인가

우리 읽기 API 안에는 SQL 에 없는 규칙이 들어 있다. 검색은 MV·랭킹·상업 게이트·평 환산을,
건물 상세는 buildings+parcels+legal+transit 조인과 팀 오버레이를 안고 있다.
모델이 그걸 SQL 로 다시 짜면 **화면과 다른 숫자가 나온다.** 채팅은 37동, 검색 화면은 35동.
그래서 화면이 쓰는 길이 있으면 그 길이 1급이고 SQL 은 그 길이 없을 때만이다.

## 등급 (§3-3)

    @router.get("/…", openapi_extra={"x-ai": "read"})

**선언이 없으면 못 부른다.** 새 API 는 기본이 금지다. 2단계는 read 만 연다. write 는 6단계.

## 사용자 권한을 빌린다 (§9-4)

`ctx.token` 을 그대로 붙여 **같은 프로세스 안에서** 부른다(ASGI). 그 중개인이 볼 수 있는 것만
보인다. 권한 검사를 새로 짜지 않는다. 이미 API 에 있다.

## 도구가 부품을 딸려 낸다 (§13)

검색 결과와 건물 상세는 `_ui` 를 함께 낸다. 모델이 `ui()` 를 기억할 필요가 없다.
"""
from __future__ import annotations

import json
import re
from typing import Any

import httpx

from ..scrub import scrub_obj
from . import REGISTRY, Ctx, tool

LIST_CAP = 20          # 응답 안의 목록은 이만큼만 모델에게. 나머지는 개수로
STAGE_OPEN = ("read",)  # 2단계. 6단계에서 ("read", "write")

# ── 우리 주장은 걷어낸다 (§16) ──────────────────────────────────────
# 화면용 API 는 적정가·임대추정·수익률·활용유형·매도가능성을 안고 있다. bt_ai 롤은 SQL 만
# 막고 이 길은 사용자 토큰으로 도니 여기서 걷어내야 한다. 첫 실측(2026-09-08 대화 #6)에서
# 「예상 매각가 154억 5,222만원」이 점 추정 그대로 새어 나왔다.
# 잣대(§16-1): 정부 규칙을 옮긴 계산은 사실, 우리가 가중치를 고른 점수는 주장.
# 주장은 나중에 get_estimate 가 **구간과 규칙을 붙여** 따로 낸다. 지금은 안 보인다.
_CLAIM_KEYS = {
    "sale_est",           # 적정가
    "est_annual_rent", "rent_est_m", "rent_est", "deposit_est",   # 임대추정
    "roi", "roi_est", "roi_exvac",   # 둘을 나눈 것. 오차가 곱해진다
    "price_is_est",       # 「위 price 가 추정이다」 표시. price 자체는 길별로 뺀다
    "pp_total", "pp_land", "pp_total_team", "pp_land_team",   # 평당가. price 가 추정이면 이것도 추정
    "gongsi_ratio", "gongsi_ratio_team", "sale_pnl",           # price 로 나눈 것
    "use_type",           # 활용유형
    "util_ratio",         # 활용률(활용유형의 재료)
    "sell_score", "sell_axes",   # 매도가능성
    "grade", "kindness", "nohudo", "meongdo", "ipji",   # 검색 줄의 점수 축(우리가 매긴 것)
    "float_pop",          # 「매우높음」 같은 등급. pop_day 원자료는 서울시 것이라 남긴다
}
# 화면 API 는 주장으로 두껍다. 검색 줄 하나에 60칸이고 그중 스물이 추정·점수였다(2026-09-08 실측).
# 이 목록은 손으로 지키는 게 아니라 qa/ai 가 「응답에 est·score 냄새 나는 칸이 새로 생겼나」로 지킨다(§18).
# 모델에게 쓸모없고 크기만 큰 것
_NOISE_KEYS = {"parcel_geom", "geom", "geom_json", "geometry"}

# 길마다 따로 걷어내는 것. **이름이 같은데 뜻이 다른 칸**이 있다.
# /search/suggest 의 price 는 「팀 수기 매매가 ?? 추정가」라 사실일 때도 주장일 때도 있고,
# 모델은 그걸 가를 수 없다(2026-09-08 대화 #7 에서 「시세 약 154.5억」으로 샜다).
# pk 를 푸는 길에 값은 필요 없으니 아예 뺀다.
_PEOPLE = {"phone", "owner_phone", "buyer_phone", "rrn", "email", "assignee_account_id"}
_STRIP_FOR: dict[tuple[str, str], set[str]] = {
    ("GET", "/search/suggest"): {"price"},
    # 검색 줄은 소유자 이름·전화까지 싣는다(팀 데이터). 건물을 찾는 길에 그건 필요 없다.
    # B 경로라 나가도 되는 값이지만, **필요 없는 개인정보를 습관처럼 보내지 않는다**(§22).
    ("POST", "/search"): {"price", "sale_price", "owner_name", "owner_phone", "assignee_account_id"},
    # 팀 것을 읽는 길. 이름은 가되 전화는 안 간다. 「김대표 번호 뭐야」는 6단계(쓰기·조작) 흐름이다
    ("GET", "/buyers"): _PEOPLE, ("GET", "/sales/sellers"): _PEOPLE, ("GET", "/sales/today"): _PEOPLE,
    ("GET", "/sales/schedule"): _PEOPLE, ("GET", "/listings"): _PEOPLE | {"price"},
    ("GET", "/listings/{building_pk}"): _PEOPLE | {"price"},
}


# 검색 줄은 걷어낸 뒤에도 40칸이라 스무 줄에 2만 토큰이 든다(2026-09-08 대화 #12: 29,397 in).
# 화면은 그 40칸이 다 필요하지만 모델은 아니다. **남길 칸을 고른다.** 나머지는 pk 로 상세를 부르면 된다.
_KEEP_FOR: dict[tuple[str, str], set[str]] = {
    ("POST", "/search"): {"building_pk", "addr", "col", "total_area", "land_area", "floors_above", "floors_below",
                          "use_zone", "building_use", "last_sale_price", "last_sale_ym", "legal_bcr", "legal_far",
                          "bcr_slack", "far_slack", "gongsi_total", "gongsi_up5", "gongsi_up10", "vacant_cnt", "sale_cnt"},
}


def _keep_rows(obj: Any, keep: set[str]) -> Any:
    """dict 목록(items)의 줄마다 keep 만 남긴다. 목록 밖(total·page)은 그대로."""
    if isinstance(obj, dict):
        return {k: _keep_rows(v, keep) for k, v in obj.items()}
    if isinstance(obj, list):
        return [{k: v for k, v in x.items() if k in keep} if isinstance(x, dict) else x for x in obj]
    return obj


def _strip(obj: Any, extra: set[str] = frozenset()) -> Any:
    drop = _CLAIM_KEYS | _NOISE_KEYS | extra
    if isinstance(obj, dict):
        return {k: _strip(v, extra) for k, v in obj.items() if k not in drop}
    if isinstance(obj, list):
        return [_strip(x, extra) for x in obj]
    return obj


# 지시문에 싣는 한 줄 설명. summary 가 「Search」뿐이라 손으로 쓴다.
# 처음엔 다섯만 열었다가 「이 주소 호재 있어?」에 모델이 표 일곱을 손으로 뒤지다 바퀴를 다 썼고,
# 다음 질문엔 「소식은 없다」고 지어냈다(2026-09-08). 화면이 쓰는 길이 안 보이면 그렇게 된다.
_HINT = {
    # 찾기
    ("GET", "/search/suggest"): "q=주소·지번·건물명 → pk 후보. **건물을 부르기 전에 먼저.** 여럿이면 ask 로 되묻는다",
    ("POST", "/search"): "조건 검색. 화면 검색과 같은 결과. body={filters:{bjd_code,total_area_min,…},sort,per_page}. 칸은 describe_endpoint",
    # 건물 하나
    ("GET", "/buildings/{building_pk}"): "건물 상세. 대장·필지·교통·공시지가·실거래",
    ("GET", "/buildings/{building_pk}/parcels"): "필지 목록과 각 필지의 지목·면적·용도지역",
    ("GET", "/buildings/{building_pk}/tenants"): "층별 업체(인허가·상가정보)",
    ("GET", "/buildings/{building_pk}/floor-rents"): "**층별 임대. 건물 상세 화면과 같은 목록** — 층·상호·업종·면적·보증금·월세. 팀이 적은 층은 팀 것, 나머지는 업체 원장. 층 임대를 물으면 이 길",
    ("GET", "/buildings/{building_pk}/events"): "**주변 소식 · 호재.** 정비·개발·기반시설·규제·정책·고시·보도자료. 반경 700m",
    ("GET", "/buildings/{building_pk}/pop"): "유동인구 250m 격자. 낮·밤·피크",
    ("GET", "/buildings/{building_pk}/wiki"): "이 건물에 사용자가 남긴 글",
    ("GET", "/market/nearby-sales/{building_pk}"): "반경 안 최근 매각 사례(실거래). 가까운 순",
    # 나대지
    ("GET", "/buildings/parcels/{pnu}"): "나대지 상세. 건물이 없는 필지",
    ("GET", "/buildings/parcels/{pnu}/pop"): "나대지 유동인구",
    # 소식
    ("GET", "/news"): "서울 전체 소식. 고시·공고·인허가·보도자료·정비. q·kind·page",
    ("GET", "/news/item"): "소식 하나 상세. id",
    # 우리 팀 것 (사용자 토큰으로 본다)
    ("GET", "/listings"): "**우리 팀 매물** 목록",
    ("GET", "/listings/{building_pk}"): "우리 팀 매물 하나",
    ("GET", "/buyers"): "우리 팀 매수자 목록과 담긴 매물 수",
    ("GET", "/sales/sellers"): "매물 단위 흐름 보드",
    ("GET", "/sales/schedule"): "달력. 그 달의 약속. year·month",
    ("GET", "/sales/today"): "오늘 할 일·밀린 약속·다가오는 일정",
    # 사전
    ("GET", "/enums"): "enum 사전. 코드 → 이름",
    ("GET", "/fields"): "칸 사전. 이름·단위·형",
}


def endpoints_brief() -> str:
    """지시문에 싣는 길 목록. 다섯이라 싣는 게 싸다 —
    매 대화마다 list_endpoints·describe_endpoint 두 바퀴 도는 것(3만 토큰)을 아낀다."""
    lines = ["## 우리 API (call_api 로 부른다)"]
    for o in _ops():
        if o["x_ai"] in STAGE_OPEN:
            lines.append(f"- {o['method']} {o['path']}  {_HINT.get((o['method'], o['path']), o['summary'])}")
    return "\n".join(lines)

# 부품을 딸려 내는 길. 화면이 그린다(§12·§13). 2단계에 둘만 당겨 왔다
_UI_FOR = {
    # /search 응답은 {mine:{total,items,…}, normal:{total,items,…}} 다. 목록이 아니라 dict 다 —
    # 처음에 목록인 줄 알고 + 했다가 TypeError 가 났고, 고리가 그걸 「인자가 안 맞는다」로 포장해
    # 모델이 본문을 네 번 바꿔 보다 바퀴를 다 썼다(2026-09-08 대화 #10). 응답 모양은 짐작하지 않는다
    ("POST", "/search"): lambda path, body, out: {
        "name": "search_result",
        "props": {"filters": (body or {}).get("filters") or {}, "polygon": (body or {}).get("polygon"),
                  "pks": [r.get("building_pk")
                          for col in ("mine", "normal")
                          for r in ((out.get(col) or {}).get("items") or []) if isinstance(out.get(col), dict)
                          if isinstance(r, dict) and r.get("building_pk")][:50]}},
    ("GET", "/buildings/{building_pk}"): lambda path, body, out: {
        "name": "building_card", "props": {"pk": path.rsplit("/", 1)[-1]}},
}


def _spec() -> dict:
    from ...main import app          # 순환 import 를 피해 부를 때 읽는다
    return app.openapi()


def _ops() -> list[dict]:
    """x-ai 선언이 있는 길만. /api/ 중복 등록은 뺀다."""
    spec = _spec()
    out = []
    for path, methods in spec.get("paths", {}).items():
        if path.startswith("/api/"):
            continue
        for method, op in methods.items():
            grade = op.get("x-ai")
            if grade not in ("read", "write"):
                continue
            out.append({"method": method.upper(), "path": path, "x_ai": grade,
                        "summary": (op.get("summary") or op.get("description") or "").split("\n")[0][:100],
                        "_op": op})
    return out


def _match(template: str, path: str) -> dict | None:
    """/buildings/{building_pk} 와 /buildings/1024123619 를 맞춘다."""
    a, b = template.strip("/").split("/"), path.strip("/").split("/")
    if len(a) != len(b):
        return None
    params = {}
    for x, y in zip(a, b):
        if x.startswith("{") and x.endswith("}"):
            params[x[1:-1]] = y
        elif x != y:
            return None
    return params


def _deref(node: Any, comps: dict, depth: int = 0) -> Any:
    """$ref 를 풀어 모델이 읽을 수 있는 평평한 스키마로. 깊이 상한을 둔다."""
    if depth > 6:
        return node
    if isinstance(node, dict):
        if "$ref" in node:
            name = node["$ref"].rsplit("/", 1)[-1]
            return _deref(comps.get(name, {}), comps, depth + 1)
        return {k: _deref(v, comps, depth + 1) for k, v in node.items()
                if k not in ("title", "examples")}
    if isinstance(node, list):
        return [_deref(x, comps, depth + 1) for x in node]
    return node


def _trim(obj: Any, cap: int = LIST_CAP) -> Any:
    """긴 목록은 앞 cap 개만. 화면용 응답을 모델 크기로 줄인다(§23-1 과 같은 뜻)."""
    if isinstance(obj, list):
        if len(obj) > cap:
            return [_trim(x, cap) for x in obj[:cap]] + [{"_more": len(obj) - cap}]
        return [_trim(x, cap) for x in obj]
    if isinstance(obj, dict):
        return {k: _trim(v, cap) for k, v in obj.items()}
    return obj


# ── list_endpoints ──────────────────────────────────────────────────
@tool("list_endpoints",
      "부를 수 있는 우리 API 목록. 화면이 쓰는 길이라 화면과 같은 답이 나온다. SQL 보다 먼저 본다.",
      {"type": "object", "properties": {}, "required": []})
async def list_endpoints(ctx: Ctx) -> dict:
    ops = [{k: v for k, v in o.items() if k != "_op"} for o in _ops() if o["x_ai"] in STAGE_OPEN]
    return {"endpoints": ops, "source": "openapi"}


# ── describe_endpoint ───────────────────────────────────────────────
@tool("describe_endpoint",
      "길 하나의 인자와 본문 스키마. 부르기 전에 본다.",
      {"type": "object",
       "properties": {"method": {"type": "string"}, "path": {"type": "string", "description": "템플릿 그대로. 예: /buildings/{building_pk}"}},
       "required": ["method", "path"]})
async def describe_endpoint(ctx: Ctx, *, method: str, path: str) -> dict:
    comps = _spec().get("components", {}).get("schemas", {})
    for o in _ops():
        if o["method"] == method.upper() and o["path"] == path:
            op = o["_op"]
            params = [{"name": p["name"], "in": p["in"], "required": p.get("required", False),
                       "schema": _deref(p.get("schema", {}), comps)} for p in op.get("parameters", [])]
            body = None
            rb = op.get("requestBody", {}).get("content", {}).get("application/json", {}).get("schema")
            if rb:
                body = _deref(rb, comps)
            return {"method": o["method"], "path": o["path"], "x_ai": o["x_ai"],
                    "summary": o["summary"], "params": params, "body": body, "source": "openapi"}
    return {"error": f"{method} {path} 는 없거나 x-ai 선언이 없다"}


# ── call_api ────────────────────────────────────────────────────────
@tool("call_api",
      "우리 API 를 부른다. 로그인한 사용자 권한으로 돈다. path 는 실제 값으로(/buildings/1024123619).",
      {"type": "object",
       "properties": {"method": {"type": "string", "enum": ["GET", "POST"]},
                      "path": {"type": "string"},
                      "query": {"type": "object", "description": "GET 쿼리스트링", "additionalProperties": True},
                      "body": {"type": "object", "description": "POST 본문", "additionalProperties": True}},
       "required": ["method", "path"]})
async def call_api(ctx: Ctx, *, method: str, path: str,
                   query: dict | None = None, body: dict | None = None) -> dict:
    method = method.upper()
    path = "/" + path.strip("/").split("?", 1)[0]
    hit = None
    for o in _ops():
        if o["method"] == method and _match(o["path"], path) is not None:
            hit = o
            break
    if hit is None:
        return {"error": f"{method} {path} 는 부를 수 없다. list_endpoints 에 있는 길만 된다."}
    if hit["x_ai"] not in STAGE_OPEN:
        return {"error": f"{method} {path} 는 {hit['x_ai']} 등급이라 아직 못 부른다(6단계)."}

    from ...main import app
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai",
                                 timeout=30.0) as c:
        r = await c.request(method, path, params=query or None, json=body if method == "POST" else None,
                            headers={"Authorization": f"Bearer {ctx.token}"})
    if r.status_code >= 400:
        try:
            detail = r.json().get("detail")
        except Exception:  # noqa: BLE001
            detail = r.text[:200]
        return {"error": f"{r.status_code} · {detail}", "path": path}
    try:
        data = r.json()
    except ValueError:
        return {"error": "JSON 이 아니다", "path": path}

    # 주장 걷어내기(§16) → 나가는 문(§3 ②) → 굽기(§9-9 · §23-1). 차례가 뜻이다
    extra = _STRIP_FOR.get((method, hit["path"]), set())
    slim = scrub_obj(_strip(data, extra))
    keep = _KEEP_FOR.get((method, hit["path"]))
    if keep:
        slim = _keep_rows(slim, keep)

    # 층별임대정보는 세 자료를 겹친 화면이다. 화면과 같은 목록을 서버가 만들어 준다(§12-4)
    if (method, hit["path"]) == ("GET", "/buildings/{building_pk}/floor-rents"):
        from ..floors import compose
        slim = await compose(ctx.token, _match(hit["path"], path)["building_pk"],
                             slim if isinstance(slim, dict) else {})
        if isinstance(slim, dict) and slim.get("_error"):
            return {"error": slim["_error"], "path": path}

    from ..shape import SHAPERS
    shaper = SHAPERS.get((method, hit["path"]))
    if shaper:
        # 모델은 단위·등급·출처가 박힌 요약과 id 만 읽는다. 원문과 격자는 store 에 두고
        # 부품이 id 로 집어 간다. 화면용 원문 2,400토큰이 100토큰이 되는 자리
        shaped = shaper(slim if isinstance(slim, (dict, list)) else {}, body)
        sid = ctx.remember(shaped["kind"], {"raw": slim, "grids": shaped.get("grids") or {},
                                            "grade": shaped["grade"], "source": shaped["source"],
                                            "note": shaped.get("note"), "path": path})
        out: dict[str, Any] = {"id": sid, "grade": shaped["grade"], "source": shaped["source"]}
        if shaped.get("note"):
            out["note"] = shaped["note"]
        out["data"] = shaped["data"]
        if shaped.get("show"):
            out["show"] = shaped["show"].replace("ID", f'"{sid}"')
    else:
        out = {"path": path, "data": _trim(slim), "source": f"api {method} {hit['path']}"}
    maker = _UI_FOR.get((method, hit["path"]))
    if maker:
        ui = maker(path, body, data if isinstance(data, dict) else {})
        if ui:
            out["_ui"] = ui
    return out


# 길 목록은 지시문(endpoints_brief)에 이미 실린다. 모델이 습관처럼 한 번 더 부르던 바퀴(3만 토큰)를 없앤다
REGISTRY["list_endpoints"].hidden = True
