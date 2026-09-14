"""SQL 도구 넷 + 결과 넘기기 — 아무도 안 만든 질문을 위한 길. 정본 §9-3 · §23-1

## 언제 이걸 쓰나

화면이 쓰는 길(읽기 API)이 있으면 그걸 쓴다(§3-1). SQL 은 집계·복합 조건·상대 비교처럼
**아무도 미리 안 만든 질문**에만 쓴다. 지시문이 그렇게 말한다.

## 막는 것은 여기가 아니다

이 파일은 문법을 검사하지만 **진짜 벽은 bt_ai 롤**이다(0167). 여기서 SELECT 만 통과시키는
것은 「10초 기다렸다 거절당하는」 시간을 아끼려는 것이지 보안이 아니다. 여기를 뚫어도
포스트그레스가 막는다. `qa/ai/walls.py` 가 그걸 매번 확인한다.

## 결과는 참조로 (§23-1)

50줄을 문맥에 부으면 그다음 모든 질문에 2,000토큰이 실린다. 그래서
개수 + 앞 몇 줄 + result_id 만 주고, 나머지는 `app.ai_result` 에 둔다.
더 필요하면 `result_page` 로 가져간다.
"""
from __future__ import annotations

import json
import re
import time
from decimal import Decimal
from typing import Any

import asyncpg

from ...core.db import pool as app_pool
from .. import db as ai_db
from ..scrub import scrub_obj
from . import REGISTRY, Ctx, tool

HEAD = 5          # 모델에게 바로 보이는 줄
CAP = 200         # 결과 상한. 넘으면 자르고 「더 있다」를 값으로
PAGE_MAX = 50     # result_page 한 번에

# 세대 표 이름(buildings_v9 같은 것)을 직접 치면 다음 스왑에서 끊긴다. 뷰를 보게 한다
_GEN = re.compile(r"\b(buildings|parcels|gongsi_series|sales_history|ledger_basic|building_\w+?)_v\d+\b")
_FIRST = re.compile(r"^\s*(?:--[^\n]*\n|/\*.*?\*/\s*)*\s*(\w+)", re.S)


def _plain(v: Any) -> Any:
    if isinstance(v, Decimal):
        return float(v)
    if hasattr(v, "isoformat"):
        return v.isoformat()
    if isinstance(v, (bytes, memoryview)):
        return None                       # geom 같은 것. 모델에게 줄 게 아니다
    return v


def _rows(records) -> list[dict]:
    return [{k: _plain(v) for k, v in r.items()} for r in records]


# ── list_tables ─────────────────────────────────────────────────────
_TABLES: str | None = None


async def tables_brief() -> str:
    """표 지도 — 지시문에 늘 실린다. DB 의 표 설명(0169)에서 만든다.

    **왜 지시문에 싣나.** 없을 때 모델은 「성수동2가 병원 건물」 한 물음에 바퀴를 일곱 돌았다
    (2026-09-09). 첫 SQL 은 없는 칸 이름을 지어냈고, list_tables → describe → codes → skill 을
    차례로 부르며 더듬었다. **한 바퀴가 1만 토큰이다.** 지도는 1,000 토큰쯤이고 캐시가 받아
    10분의 1로 돈다. 넷을 아끼고 하나를 낸다.

    **왜 손으로 안 적나.** 표가 바뀌면 지시문이 따로 논다. DB 에 두면 표를 옮기는 사람이
    설명도 같이 옮긴다(칸 설명 0167·0168 과 같은 자리).
    """
    global _TABLES
    if _TABLES is not None:
        return _TABLES
    p = await ai_db.pool()
    rows = await p.fetch(
        """SELECT n.nspname || '.' || c.relname AS name, obj_description(c.oid) AS note
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname IN ('master', 'ref') AND c.relkind IN ('r', 'm', 'v')
              AND has_table_privilege(c.oid, 'SELECT') AND obj_description(c.oid) IS NOT NULL
            ORDER BY 1""")
    if not rows:
        return ""
    # **물음이 어느 표로 가나.** 표가 어디 있는지만 알려 주면 모자란다 — 「병원 건물 찾아줘」에
    # 모델은 아는 자 하나(대장 주용도)로 갔고 42지번을 놓쳤다(2026-09-09 대표). 짝을 박아 둔다.
    # 이건 표의 성질이 아니라 길 안내라 DB 가 아니라 여기 산다.
    route = """## 값의 단위 — 표 안은 전부 ㎡ · 원이다

**평 = ㎡ / 3.3058.  200평 = 661.16㎡.  1억 = 1e8원.**
지도가 생기고부터 모델이 자신 있어져 예제를 안 읽고 짜다가 200평을 1,860㎡ 로 바꿨다
(2026-09-09 · 415동이 186동이 됐다). 단위는 거의 모든 쿼리에 쓰이니 여기 둔다.

## 물음이 어느 표로 가나

- **업종으로 건물 찾기**(「병원 건물」·「카페 많은 건물」) → **query 를 짜지 말고
  call_api POST /search 의 `filters.biz` 를 쓴다**(0170). 「병원 건물」은 biz:"의료"(갈래) 또는 biz:"카페" 처럼 낱말.
  대장 주용도(main_use)는 통째로 그 용도인 건물만이라 대부분을 놓친다
  (성수동2가 의료시설 2동 vs 실제 의료 업체가 든 177동)
- **몇 개인가** → count(*). LIMIT 은 보여 줄 줄만 자른다
- **지역 이름** → master.region_index 로 bjd_code 를 먼저 찾는다
- **건물 하나·주변 소식·층별 임대** → query 보다 API 가 싸고 화면과 같은 답이 나온다"""
    _TABLES = ("## 우리 표 (query 로 읽는다 · SELECT 만)\n"
               + "\n".join(f"- {r['name']}  {r['note']}" for r in rows)
               + "\n\n칸이 더 궁금하면 describe. 없는 표는 없다 — 여기 없으면 API 나 웹으로 간다.\n\n"
               + route)
    return _TABLES


@tool("list_tables",
      "읽을 수 있는 표 목록과 한 줄 설명. SQL 을 짜기 전에 먼저 본다.",
      {"type": "object", "properties": {}, "required": []})
async def list_tables(ctx: Ctx) -> dict:
    p = await ai_db.pool()
    rows = await p.fetch("""
        SELECT n.nspname || '.' || c.relname AS name,
               CASE c.relkind WHEN 'v' THEN '뷰' WHEN 'm' THEN 'MV' ELSE '표' END AS kind,
               obj_description(c.oid) AS about
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname IN ('master','ref') AND c.relkind IN ('r','v','m')
           AND has_table_privilege(c.oid, 'SELECT')
           AND c.relname !~ '_v[0-9]+$'
         ORDER BY 1""")
    return {"tables": [{"name": r["name"], "kind": r["kind"],
                        "about": (r["about"] or "").split("\n")[0][:120]} for r in rows],
            "source": "information_schema"}


# ── describe ────────────────────────────────────────────────────────
@tool("describe",
      "표 하나의 칸 이름·형·주석·예시값·인덱스. 인덱스가 있는 칸으로 거르면 빠르다.",
      {"type": "object",
       "properties": {"table": {"type": "string", "description": "예: master.buildings"}},
       "required": ["table"]})
async def describe(ctx: Ctx, *, table: str) -> dict:
    if "." not in table:
        table = f"master.{table}"
    schema, name = table.split(".", 1)
    p = await ai_db.pool()
    # 뷰면 밑의 세대 표를 먼저 찾는다. **주석도 인덱스도 세대 표에 붙어 있다** — 뷰의 칸은
    # 주석을 물려받지 않아서, 뷰만 보면 0165 에서 단 「정밀도」 주석이 안 보였다.
    # 세대 이름은 모델에게 안 알려준다(스왑되면 바뀐다).
    base = await p.fetchval(r"""
        SELECT CASE c.relkind WHEN 'v'
               THEN regexp_replace(pg_get_viewdef(c.oid), '.*FROM\s+(?:master\.)?([a-z_0-9]+).*', '\1', 'ns')
               ELSE c.relname END
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relname = $2""", schema, name)
    if not base:
        return {"error": f"{table} 이 없거나 읽을 수 없다", "columns": []}
    cols = await p.fetch("""
        SELECT a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type,
               col_description(a.attrelid, a.attnum) AS about
          FROM pg_attribute a
         WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
         ORDER BY a.attnum""", table)
    if not cols:
        return {"error": f"{table} 이 없거나 읽을 수 없다", "columns": []}
    # 주석은 세대 표 것으로 덮는다(뷰 칸에 직접 단 게 있으면 그것이 우선)
    about: dict[str, str | None] = {r["col"]: r["about"] for r in cols}
    try:
        for r in await p.fetch("""
            SELECT a.attname AS col, col_description(a.attrelid, a.attnum) AS about
              FROM pg_attribute a
             WHERE a.attrelid = ($1 || '.' || $2)::regclass AND a.attnum > 0 AND NOT a.attisdropped""",
                               schema, base):
            if r["about"] and not about.get(r["col"]):
                about[r["col"]] = r["about"]
    except asyncpg.PostgresError:
        pass                                  # 세대 표를 직접 못 읽어도 뷰 주석으로 간다
    names = {r["col"] for r in cols}
    idx = await p.fetch("SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND tablename=$2", schema, base)
    indexed: set[str] = set()
    for r in idx:
        m = re.search(r"\((.+?)\)", r["indexdef"])
        if m:
            for c in m.group(1).split(","):
                col = re.sub(r"\s.*|::.*", "", c.strip()).strip('"')
                if col in names:              # 식 인덱스(dong_jibun(addr))는 칸이 아니라 뺀다
                    indexed.add(col)

    # 예시값 한 줄. 뷰라도 LIMIT 1 은 빠르다
    try:
        sample = await p.fetchrow(f"SELECT * FROM {table} LIMIT 1")
        ex = {k: _plain(v) for k, v in (sample or {}).items()}
    except asyncpg.PostgresError:
        ex = {}

    return {
        "table": table,
        "columns": [{"col": r["col"], "type": r["type"],
                     "about": (about.get(r["col"]) or "")[:160] or None,
                     "indexed": r["col"] in indexed,
                     "example": ex.get(r["col"])} for r in cols
                    if r["col"] not in ("geom",)],
        "indexed": sorted(indexed - {"geom"}),
        "source": "pg_catalog",
    }


# ── codes ───────────────────────────────────────────────────────────
@tool("codes",
      "코드 사전. 갈래를 코드로 주는 칸의 뜻을 본다. group 없이 부르면 갈래 목록만.",
      {"type": "object",
       "properties": {"group": {"type": "string", "description": "예: biz_category · main_use · use_zone"}},
       "required": []})
async def codes(ctx: Ctx, *, group: str | None = None) -> dict:
    p = await ai_db.pool()
    if group == "biz_category":
        rows = await p.fetch("SELECT * FROM ref.biz_category ORDER BY 1 LIMIT 300")
        return {"group": group, "codes": _rows(rows), "source": "ref.biz_category"}
    # 칸 이름은 enum_key 다. group_key 로 짜 놓고 겨루기 6번에서 처음 밟았다(2026-09-08)
    if not group:
        rows = await p.fetch("SELECT DISTINCT enum_key FROM ref.enums ORDER BY 1")
        return {"groups": [r["enum_key"] for r in rows] + ["biz_category"], "source": "ref.enums"}
    rows = await p.fetch(
        "SELECT code, label, tier, parent_code FROM ref.enums WHERE enum_key=$1 AND active ORDER BY sort_order, code LIMIT 300",
        group)
    return {"group": group, "codes": _rows(rows), "source": "ref.enums"}


# ── query ───────────────────────────────────────────────────────────
@tool("query",
      "읽기 전용 SQL. 화면이 쓰는 길(읽기 API)이 없는 질문에만(집계·복합 조건·상대 비교). "
      "세대 표(_v9)가 아니라 뷰(master.buildings)를 본다. 결과는 개수와 앞 다섯 줄만 오고 나머지는 result_id 로 넘긴다. "
      "**짜기 전에 describe(표) 로 칸 주석을 본다** — 연면적·대지면적처럼 뜻이 갈리는 칸이 있다. "
      "지역 이름은 master.region_index 에서 bjd_code 를 찾아 접두 LIKE 로 거른다. 면적은 ㎡, 돈은 원이다.",
      {"type": "object",
       "properties": {"sql": {"type": "string"},
                      "purpose": {"type": "string", "description": "이 쿼리로 무엇을 알려는지 한 줄"}},
       "required": ["sql", "purpose"]})
async def query(ctx: Ctx, *, sql: str, purpose: str) -> dict:
    s = sql.strip().rstrip(";")
    head = (_FIRST.match(s) or [None, ""])[1].upper() if _FIRST.match(s) else ""
    if head not in ("SELECT", "WITH"):
        return {"error": "SELECT 만 된다. 쓰기는 API 로 한다.", "rows": [], "돌아온 줄": 0}
    if ";" in s:
        return {"error": "문장은 하나만.", "rows": [], "돌아온 줄": 0}
    if _GEN.search(s):
        return {"error": "세대 표 이름을 직접 쓰지 말고 뷰를 본다. buildings_v9 → master.buildings",
                "rows": [], "돌아온 줄": 0}

    p = await ai_db.pool()
    t0 = time.monotonic()
    try:
        async with p.acquire() as c:
            async with c.transaction(readonly=True):
                recs = await c.fetch(f"SELECT * FROM ({s}) _q LIMIT {CAP + 1}")
    except asyncpg.QueryCanceledError:
        return {"error": "10초를 넘겼다. 인덱스가 있는 칸(describe 의 indexed)으로 먼저 거르거나 범위를 좁힌다.",
                "rows": [], "돌아온 줄": 0}
    except asyncpg.InsufficientPrivilegeError as e:
        return {"error": f"권한이 없다: {e}", "rows": [], "돌아온 줄": 0}
    except asyncpg.PostgresError as e:
        return {"error": f"{e.__class__.__name__}: {e}", "rows": [], "돌아온 줄": 0}
    ms = int((time.monotonic() - t0) * 1000)

    rows = scrub_obj(_rows(recs))
    more = len(rows) > CAP
    rows = rows[:CAP]
    # **`count` 를 「전체 개수」로 읽던 사고**(2026-09-09). 모델이 `LIMIT 10` 을 스스로 붙여 놓고
    # 돌아온 10줄을 세어 「성수동1가에 200평 넘는 건물은 모두 10동」이라고 답했다(참값 415).
    # 이름을 「돌아온 줄」로 바꾸고, 자기가 건 상한에 딱 걸리면 그렇다고 말해 준다
    out: dict[str, Any] = {"돌아온 줄": len(rows), "truncated": more, "ms": ms,
                           "rows": rows[:HEAD], "source": "master (bt_ai)"}
    m = re.search(r"\blimit\s+(\d+)\s*;?\s*$", s, re.I)
    if m and len(rows) == int(m.group(1)):
        out["상한"] = (f"직접 건 LIMIT {m.group(1)} 에 딱 찼다. 이 수는 전체 개수가 아니다 — "
                     "몇 개인지 물었으면 count(*) 로 따로 센다")
    if len(rows) > HEAD:
        rid = await app_pool().fetchval(
            """INSERT INTO app.ai_result(chat_id, sql, purpose, n, rows)
               VALUES($1,$2,$3,$4,$5::jsonb) RETURNING id""",
            ctx.chat_id, s, purpose, len(rows), json.dumps(rows, ensure_ascii=False, default=str))
        out["result_id"] = rid
        out["note"] = (f"{len(rows)}줄 중 {HEAD}줄만 보인다. 더 보려면 result_page(result_id={rid}). "
                       + ("상한 200줄에 잘렸다. 답에 「더 있다」고 말한다." if more else ""))
    return out


# ── result_page ─────────────────────────────────────────────────────
@tool("result_page",
      "query 결과의 나머지 줄을 가져온다.",
      {"type": "object",
       "properties": {"result_id": {"type": "integer"},
                      "offset": {"type": "integer", "default": 5},
                      "limit": {"type": "integer", "default": 20}},
       "required": ["result_id"]})
async def result_page(ctx: Ctx, *, result_id: int, offset: int = HEAD, limit: int = 20) -> dict:
    limit = max(1, min(limit, PAGE_MAX))
    row = await app_pool().fetchrow(
        "SELECT n, rows FROM app.ai_result WHERE id=$1 AND chat_id=$2", result_id, ctx.chat_id)
    if not row:
        return {"error": "그런 결과가 없다", "rows": [], "돌아온 줄": 0}
    rows = json.loads(row["rows"])
    return {"result_id": result_id, "돌아온 줄": row["n"], "offset": offset,
            "rows": rows[offset:offset + limit], "source": "master (bt_ai)"}


# 표 지도는 지시문에 이미 실린다. 모델이 습관처럼 부르던 바퀴를 없앤다(길 목록과 같은 수)
REGISTRY["list_tables"].hidden = True
