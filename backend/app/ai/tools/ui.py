"""부품 지목 — 모델은 부품 이름과 인자만 낸다. 값은 서버가 채운다. 정본 §12-1 · §12-1-1

## 그릇 다섯 (2단계)

    kv     라벨·값 쌍       제원 · 개요 · 조건
    stats  큰 숫자 타일     한눈에 들어오는 자리
    table  행·열           마크다운 표가 하던 자리
    chart  선 · 막대        추이 · 견주기
    list   태그·제목·꼬리   소식 · 업체 · 이력

전용 부품(facts·sales·events…)을 안 만든다. **데이터만 있으면 채워지는 그릇**이라 새 자료가 와도
부품을 안 만들고, 모델이 조합해서 처음 보는 요청도 짠다(대표 2026-09-09).

## 데이터가 오는 두 길

    ui("table", {"source": "sales#1"})            도구가 가져온 것을 가리킨다. 토큰 0
    ui("table", {"head": […], "rows": [[…]]})     모델이 쓴다. 웹에서 찾은 것처럼 우리 자료에 없는 값

`source` 가 있으면 store 의 격자를 집어 쓰고 등급·출처를 발에 단다. 없으면 모델이 준 것을
그대로 그리되 발에 「대화·웹」이라고 적는다. 어느 쪽이든 **부품이 등급을 스스로 그린다**(§16 과 같은 수).
"""
from __future__ import annotations

from typing import Any

from . import Ctx, tool

NAMES = ("kv", "stats", "table", "chart", "list")
# 상한. **source 로 채우는 값은 모델 토큰이 0 이라 이 수는 화면 길이만 정한다.**
# 14 였을 때 건물 제원 20줄 중 15번째인 승강기가 잘렸고, 하필 사용자가 물은 게 승강기였다
# (2026-09-09 대표). 잘린 건 아래에서 모델에게 말해 준다
LIMIT = {"kv": 24, "stats": 6, "table": 20, "list": 20}


def _rows_pick(rows: list, props: dict) -> list:
    """`rows: [0, 3, 7]` 로 줄을 고른다. 「이 중에서 몇 개만」이 되는 자리 —
    없으면 모델은 스무 줄을 통째로 다시 그리는 수밖에 없다(2026-09-09 대표)."""
    want = props.get("rows")
    if not isinstance(want, list) or not all(isinstance(i, int) for i in want):
        return rows
    return [rows[i] for i in want if 0 <= i < len(rows)] or rows


def _from_store(ctx: Ctx, name: str, props: dict) -> dict | None:
    sid = props.get("source")
    if not sid:
        return None
    ent = ctx.store.get(sid)
    if not ent:
        return {"error": f"{sid} 는 이 대화에서 가져온 자료가 아니다. 도구 결과의 id 를 쓴다."}
    grid = (ent.get("grids") or {}).get(name)
    if grid is None:
        have = ", ".join((ent.get("grids") or {}).keys()) or "없음"
        return {"error": f"{sid} 는 {name} 로 못 그린다. 되는 것: {have}"}
    data: dict[str, Any] = {}
    if name == "kv":
        rows = grid
        pick = props.get("pick")
        if pick:
            want = [p.strip() for p in pick]
            rows = [r for r in rows if r[0] in want]
        data["_cut"] = max(0, len(rows) - LIMIT["kv"])
        data["rows"] = rows[:LIMIT["kv"]]
        data["cols"] = int(props.get("cols") or 2)
    elif name == "stats":
        items = grid
        pick = props.get("pick")
        if pick:
            items = [i for i in items if i.get("label") in pick]
        data["_cut"] = max(0, len(items) - LIMIT["stats"])
        data["items"] = items[:LIMIT["stats"]]
    elif name == "table":
        head, rows = grid["head"], grid["rows"]
        cols = props.get("cols")
        if cols:
            idx = [head.index(c) for c in cols if c in head]
            head = [head[i] for i in idx]
            rows = [[r[i] for i in idx] for r in rows]
        rows = _rows_pick(rows, props)
        cap = int(props.get("limit") or LIMIT["table"])
        data["_cut"] = max(0, len(rows) - cap)
        data["head"], data["rows"] = head, rows[:cap]
    elif name == "list":
        items = _rows_pick(grid, props)
        cap = int(props.get("limit") or LIMIT["list"])
        data["_cut"] = max(0, len(items) - cap)
        data["items"] = items[:cap]
    elif name == "chart":
        data.update(grid)
        if props.get("kind") in ("line", "bar"):
            data["kind"] = props["kind"]
    # 발에는 **등급과 출처만.** note(「비어 있으면 아직 안 적은 층」류)는 조건·요약이라
    # 화면에 붙이지 않는다(CLAUDE.md 설명글씨 금지 · 2026-09-09 대표). 모델은 도구 결과에서 계속 읽는다
    data["foot"] = {"grade": ent.get("grade"), "source": ent.get("source")}
    return data


def _from_model(name: str, props: dict) -> dict | None:
    """모델이 값을 직접 준 경우. 최소한의 모양만 검사한다."""
    data: dict[str, Any] = {}
    if name == "kv":
        rows = props.get("rows")
        if not isinstance(rows, list) or not all(isinstance(r, list) and len(r) == 2 for r in rows):
            return {"error": 'kv 는 rows: [["라벨","값"], …] 다'}
        data["rows"], data["cols"] = rows[:LIMIT["kv"]], int(props.get("cols") or 2)
    elif name == "stats":
        items = props.get("items")
        if not isinstance(items, list) or not all(isinstance(i, dict) and "label" in i and "value" in i for i in items):
            return {"error": 'stats 는 items: [{"label","value","unit"?,"note"?}, …] 다'}
        data["items"] = items[:LIMIT["stats"]]
    elif name == "table":
        head, rows = props.get("head"), props.get("rows")
        if not isinstance(head, list) or not isinstance(rows, list):
            return {"error": "table 은 head: […] 와 rows: [[…], …] 다"}
        data["head"], data["rows"] = head, rows[:LIMIT["table"]]
    elif name == "list":
        items = props.get("items")
        if not isinstance(items, list) or not all(isinstance(i, dict) and "title" in i for i in items):
            return {"error": 'list 는 items: [{"title","sub"?,"tag"?}, …] 다'}
        data["items"] = items[:LIMIT["list"]]
    elif name == "chart":
        if not isinstance(props.get("x"), list) or not isinstance(props.get("series"), list):
            return {"error": 'chart 는 kind: "line"|"bar", x: […], series: [{"name","data":[…]}] 다'}
        data.update({k: props[k] for k in ("kind", "x", "series", "unit", "mark") if k in props})
        data.setdefault("kind", "line")
    data["foot"] = {"grade": props.get("grade") or "모델", "source": props.get("source_note") or "대화 · 웹"}
    return data


@tool("ui",
      "화면에 부품을 세운다. 도구 결과의 id 를 source 로 주면 서버가 값을 채운다. 그게 가장 싼 길이다. "
      "숫자 여럿·표·목록·추이는 글로 옮기지 말고 이걸로 보인다. "
      "kv(라벨·값) · stats(큰 숫자) · table(행·열) · chart(선·막대) · list(태그·제목·꼬리).",
      {"type": "object",
       "properties": {
           "name": {"type": "string", "enum": list(NAMES)},
           "props": {"type": "object", "additionalProperties": True,
                     "description": '{"source": "facts#1", "pick": [...]} 처럼 참조하거나, '
                                    '값을 직접: kv rows / stats items / table head+rows / list items / chart x+series'},
           "title": {"type": "string", "description": "부품 위 한 줄. 없어도 된다"}},
       "required": ["name"]})
async def ui(ctx: Ctx, *, name: str, props: dict | None = None, title: str | None = None,
             **loose: Any) -> dict:
    """인자를 너그럽게 받는다. 모델이 `{"name":"kv","source":"facts#1"}` 처럼 props 를 빼고
    부르는 일이 잦았고(2026-09-09 하이쿠), 그때마다 TypeError 가 나서 한 바퀴를 버렸다.
    **한 바퀴가 1만 토큰이라 되돌려 보내는 것보다 받아 주는 게 싸다.**"""
    props = dict(props or {})
    for k, v in loose.items():                # props 밖으로 흘린 인자를 주워 담는다
        props.setdefault(k, v)
    if name not in NAMES:
        return {"error": f"{name} 은 없다. 되는 것: {', '.join(NAMES)}"}
    data = _from_store(ctx, name, props) if props.get("source") else _from_model(name, props)
    if data is None or "error" in data:
        return data or {"error": "인자가 비었다"}
    # **빈 그릇은 세우지 않는다.** 줄 0 짜리 표는 화면에 빈 테두리만 남기고,
    # 모델은 「보여 드렸다」고 여겨 답에서 그 사실을 안 짚는다(2026-09-09 대화 #124)
    if not (data.get("rows") or data.get("items") or data.get("series")):
        return {"error": f"{name} 에 그릴 값이 없다. 자료가 비었으면 부품 없이 answer 로 말한다"}
    if title:
        data["title"] = title.strip()[:60]
    out = {"_ui": {"name": name, "props": data}, "ok": True, "shown": name}
    if cut := data.pop("_cut", 0):
        out["잘림"] = f"{cut}줄이 상한에 걸려 빠졌다. 필요한 줄만 pick 으로 고른다"
    return out
