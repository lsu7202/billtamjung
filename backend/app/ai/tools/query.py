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
from . import Ctx, tool

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
      "읽기 전용 SQL. 화면이 쓰는 길(읽기 API)이 없는 질문에만. 세대 표(_v9)가 아니라 뷰(master.buildings)를 본다. "
      "결과는 개수와 앞 다섯 줄만 오고 나머지는 result_id 로 넘긴다.",
      {"type": "object",
       "properties": {"sql": {"type": "string"},
                      "purpose": {"type": "string", "description": "이 쿼리로 무엇을 알려는지 한 줄"}},
       "required": ["sql", "purpose"]})
async def query(ctx: Ctx, *, sql: str, purpose: str) -> dict:
    s = sql.strip().rstrip(";")
    head = (_FIRST.match(s) or [None, ""])[1].upper() if _FIRST.match(s) else ""
    if head not in ("SELECT", "WITH"):
        return {"error": "SELECT 만 된다. 쓰기는 API 로 한다.", "rows": [], "count": 0}
    if ";" in s:
        return {"error": "문장은 하나만.", "rows": [], "count": 0}
    if _GEN.search(s):
        return {"error": "세대 표 이름을 직접 쓰지 말고 뷰를 본다. buildings_v9 → master.buildings",
                "rows": [], "count": 0}

    p = await ai_db.pool()
    t0 = time.monotonic()
    try:
        async with p.acquire() as c:
            async with c.transaction(readonly=True):
                recs = await c.fetch(f"SELECT * FROM ({s}) _q LIMIT {CAP + 1}")
    except asyncpg.QueryCanceledError:
        return {"error": "10초를 넘겼다. 인덱스가 있는 칸(describe 의 indexed)으로 먼저 거르거나 범위를 좁힌다.",
                "rows": [], "count": 0}
    except asyncpg.InsufficientPrivilegeError as e:
        return {"error": f"권한이 없다: {e}", "rows": [], "count": 0}
    except asyncpg.PostgresError as e:
        return {"error": f"{e.__class__.__name__}: {e}", "rows": [], "count": 0}
    ms = int((time.monotonic() - t0) * 1000)

    rows = scrub_obj(_rows(recs))
    more = len(rows) > CAP
    rows = rows[:CAP]
    out: dict[str, Any] = {"count": len(rows), "truncated": more, "ms": ms,
                           "rows": rows[:HEAD], "source": "master (bt_ai)"}
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
        return {"error": "그런 결과가 없다", "rows": [], "count": 0}
    rows = json.loads(row["rows"])
    return {"result_id": result_id, "count": row["n"], "offset": offset,
            "rows": rows[offset:offset + limit], "source": "master (bt_ai)"}
