#!/usr/bin/env python3
"""bt_ai 롤 벽 — 모델 없이, 롤이 실제로 막는지. 정본 10-AI-어시스턴트 §18-3

## 막혀서 통과해야 한다

모델이 「알려드릴 수 없습니다」라고 착하게 굴어서 통과하면 그건 **미시험**이다.
다음 판에서 모델이 마음을 바꾸면 뚫린다. 여기서는 모델을 안 부르고 bt_ai 로 직접 접속해
**시도하고 거절당하는 것**을 센다. 시도 자체가 안 되면(접속 실패) 그것도 실패다.

## 언제

커밋마다. 모델도 안 부르고 DB 만 보니 공짜고 1초다.

    python qa/ai/walls.py                    로컬 기본값(bt_ai:bt_ai_dev@localhost:55432)
    BT_AI_DATABASE_URL=… python qa/ai/walls.py

끝 코드 0 = 전부 막혔다. 1 = 하나라도 뚫렸거나 열려야 할 게 닫혔다.
"""
from __future__ import annotations

import asyncio
import os
import sys

import asyncpg

DSN = os.environ.get("BT_AI_DATABASE_URL") or "postgresql://bt_ai:bt_ai_dev@localhost:55432/billtamjung"

# ── 열려 있어야 한다 ── 없으면 모델이 아무것도 못 읽는다
MUST_READ = [
    "master.buildings", "master.parcels", "master.building_parcels", "master.building_ledger_raw",
    "master.building_legal", "master.gongsi_series", "master.sales_history", "master.sales_agg",
    "master.localdata_permit", "master.sbiz_store", "master.urban_notice", "master.area_event",
    "master.subway_stations", "master.trade_area", "master.region_index",
    "ref.biz_category", "ref.enums", "ref.error_msg",
]

# ── 닫혀 있어야 한다 ── 하나라도 열리면 출시 못 한다
MUST_NOT_READ = [
    # 우리 주장 (§16-1: 가중치를 우리가 고른 것)
    "master.building_score", "master.building_sale_est", "master.building_rent_est",
    "master.floor_rent_est", "master.floor_est_by_floor", "master.floor_est_total",
    "master.building_calc", "master.income_cap", "master.sale_price_index",
    "ref.formula_params", "ref.formula_sets",
    # 내부 · 장부 · 크롤
    "master._crawl_clean", "master._crawl_rent", "master._resnap",
    "master.source_version", "master.derive_run", "master.master_loads",
    # 세대 표 직접 — 뷰를 봐야 한다. 스왑되면 이름이 바뀐다
    "master.buildings_v9", "master.parcels_v10", "master.gongsi_series_v10",
    # app 은 스키마째 닫혀야 하지만 대표적인 것을 이름으로도 찍는다
    "app.accounts", "app.owners", "app.contacts", "app.buyers", "app.listings",
    "app.memos", "app.schedules", "app.ai_chat", "app.ai_message",
]

# ── 쓰기는 무엇이든 거절 ── SELECT 만 GRANT 했으니 권한으로 막힌다
MUST_NOT_WRITE = [
    ("INSERT",   "INSERT INTO master.living_pop SELECT * FROM master.living_pop LIMIT 0"),
    ("UPDATE",   "UPDATE master.subway_stations SET name = name WHERE false"),
    ("DELETE",   "DELETE FROM master.living_pop WHERE false"),
    ("CREATE",   "CREATE TABLE master._ai_probe(x int)"),
    ("TRUNCATE", "TRUNCATE master.living_pop"),
    ("DROP",     "DROP TABLE master.living_pop"),
    ("app 쓰기", "INSERT INTO app.memos DEFAULT VALUES"),
]


def _ok(line: str) -> None:
    print(f"  ✓ {line}")


def _bad(line: str) -> None:
    print(f"  ✗ {line}")


async def main() -> int:
    bad = 0
    try:
        c = await asyncpg.connect(DSN, timeout=10)
    except Exception as e:  # noqa: BLE001
        _bad(f"bt_ai 로 접속이 안 된다 — {type(e).__name__}: {e}")
        print("      0167 이 적용됐는지, 로컬이면 ALTER ROLE bt_ai PASSWORD 를 했는지 보세요")
        return 1

    try:
        # ── 롤 설정 ──────────────────────────────────────────────
        print("▶ 롤 설정")
        for name, want in (("statement_timeout", "10s"), ("transaction_read_only", "on")):
            got = await c.fetchval(f"SHOW {name}")
            if got == want:
                _ok(f"{name} = {got}")
            else:
                _bad(f"{name} = {got} (바라는 값 {want})"); bad += 1

        usage = await c.fetchval("SELECT has_schema_privilege('app', 'USAGE')")
        if usage:
            _bad("app 스키마 USAGE 가 열려 있다"); bad += 1
        else:
            _ok("app 스키마 USAGE 닫힘")

        # ── 열려야 하는 것 ────────────────────────────────────────
        print("▶ 열려야 하는 것")
        for t in MUST_READ:
            try:
                await c.fetchval(f"SELECT 1 FROM {t} LIMIT 1")
                _ok(f"읽힘  {t}")
            except asyncpg.PostgresError as e:
                _bad(f"안 읽힘  {t} — {e.__class__.__name__}"); bad += 1

        # ── 닫혀야 하는 것 ────────────────────────────────────────
        print("▶ 닫혀야 하는 것 (시도하고 거절당해야 통과)")
        for t in MUST_NOT_READ:
            try:
                await c.fetchval(f"SELECT 1 FROM {t} LIMIT 1")
                _bad(f"뚫림  {t}"); bad += 1
            except (asyncpg.InsufficientPrivilegeError, asyncpg.UndefinedTableError):
                # UndefinedTable 도 통과다: 스키마 USAGE 가 없으면 표가 「없다」고 나온다
                _ok(f"막힘  {t}")
            except asyncpg.PostgresError as e:
                _bad(f"이상한 오류  {t} — {e.__class__.__name__}: {e}"); bad += 1

        # ── 쓰기 ─────────────────────────────────────────────────
        print("▶ 쓰기 (전부 거절)")
        for label, sql in MUST_NOT_WRITE:
            try:
                await c.execute(sql)
                _bad(f"뚫림  {label}"); bad += 1
            except (asyncpg.InsufficientPrivilegeError, asyncpg.ReadOnlySQLTransactionError,
                    asyncpg.UndefinedTableError):
                _ok(f"막힘  {label}")
            except asyncpg.PostgresError as e:
                _bad(f"이상한 오류  {label} — {e.__class__.__name__}: {e}"); bad += 1

        # ── 새 표는 기본이 닫힘인가 ─────────────────────────────
        # 허용 목록 밖의 master 표를 하나 골라 닫혀 있는지 본다. GRANT ON ALL 을 쓰면 여기서 걸린다
        print("▶ 허용 목록 밖")
        stray = await c.fetch("""
            SELECT n.nspname || '.' || c.relname AS rel
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname IN ('master','ref','app') AND c.relkind IN ('r','v','m')
               AND has_table_privilege('bt_ai', c.oid, 'SELECT')""")
        opened = {r["rel"] for r in stray}
        leaked = opened & set(MUST_NOT_READ)
        if leaked:
            _bad(f"닫혀야 할 것이 열림  {sorted(leaked)}"); bad += 1
        else:
            _ok(f"읽을 수 있는 표 {len(opened)}개 · 닫힌 목록과 겹침 없음")
    finally:
        await c.close()

    print()
    if bad:
        print(f"✗ 벽 {bad}곳이 무너졌다. 하나라도 있으면 출시 못 한다(§18-3 차단)")
        return 1
    print("✓ 벽 전부 섰다")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
