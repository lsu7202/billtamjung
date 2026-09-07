#!/usr/bin/env python3
"""master.building_ledger_raw — 표제부 원문 48키를 건물마다 jsonb 한 줄로 보유한다(0164).

## 왜

대표 원칙: 「최근대수선구분·건물명·세대수·내진 같은 것은 **화면에 닿을 필요가 없어서** 안 보이게
한 것이다. 대신 **데이터로는 가지고 있어서** 추후 AI 가 활용할 수 있는 정보가 되어야 한다.」

빌더가 내는 48키 중 21개가 `build_integrated` 에서 끊기고, 그중 아홉은 포스트그레스 어디에도 없다:
내진적용 · 내진능력 · 지붕 · 기타구조 · 비상용승강기 · 최근대수선구분 · 대수선이력 ·
사용승인일_정밀도 · 총동연면적. 지금 살아남는 곳은 빌드 중간 파일 하나뿐이다.

## 무엇을 하나

`data/tools/_building_master.jsonl`(빌드 산출물) 을 그대로 읽어 `building_pk → rec(jsonb)` 로 싣는다.
**칸을 고르지 않는다** — 원천에 키가 늘어도 이 스크립트를 안 고친다.
세대 스왑을 안 쓰고 통째로 갈아끼운다(임시 표 → 이름 바꾸기). 실패하면 옛 표가 그대로 남는다.

    BT_DATABASE_URL=... backend/.venv/bin/python scripts/load_ledger_raw.py [jsonl]
"""
import asyncio
import json
import os
import sys

import asyncpg

DSN = os.environ.get("BT_DATABASE_URL") or os.environ.get(
    "DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")
SRC = sys.argv[1] if len(sys.argv) > 1 else "data/tools/_building_master.jsonl"
BATCH = 20_000


async def main() -> int:
    if not os.path.exists(SRC):
        sys.exit(f"✗ {SRC} 가 없습니다 — 대장 빌드(build_building_master)를 먼저")

    c = await asyncpg.connect(DSN, timeout=60, command_timeout=7200)
    try:
        # 통째로 갈아끼운다 — 새 표에 다 넣고 나서 이름을 바꾼다. 중간에 죽어도 옛 표가 산다
        await c.execute("DROP TABLE IF EXISTS master._ledger_raw_new")
        await c.execute("""CREATE TABLE master._ledger_raw_new
                             (building_pk text PRIMARY KEY, rec jsonb NOT NULL,
                              loaded_at timestamptz NOT NULL DEFAULT now())""")

        rows, n, keys = [], 0, set()
        with open(SRC, encoding="utf-8") as f:
            for line in f:
                r = json.loads(line)
                pk = (r.get("PK") or "").strip()
                if not pk:
                    continue
                keys.update(r)
                rows.append((pk, json.dumps(r, ensure_ascii=False)))
                if len(rows) >= BATCH:
                    await c.executemany(
                        "INSERT INTO master._ledger_raw_new(building_pk, rec) VALUES($1, $2::jsonb) "
                        "ON CONFLICT (building_pk) DO NOTHING", rows)
                    n += len(rows); rows = []
                    if n % 100_000 == 0:
                        print(f"  {n:,}")
        if rows:
            await c.executemany(
                "INSERT INTO master._ledger_raw_new(building_pk, rec) VALUES($1, $2::jsonb) "
                "ON CONFLICT (building_pk) DO NOTHING", rows)
            n += len(rows)

        got = await c.fetchval("SELECT count(*) FROM master._ledger_raw_new")
        live = await c.fetchval("SELECT count(*) FROM master.buildings")
        # 건물 표보다 크게 모자라면 갈아끼우지 않는다 — 빈 표로 덮는 것이 가장 나쁘다
        if got < live * 0.95:
            sys.exit(f"✗ {got:,}줄뿐입니다(건물 {live:,}) — 갈아끼우지 않습니다")

        async with c.transaction():
            await c.execute("DROP TABLE IF EXISTS master.building_ledger_raw")
            await c.execute("ALTER TABLE master._ledger_raw_new RENAME TO building_ledger_raw")
        print(f"  master.building_ledger_raw {got:,}줄 · 키 {len(keys)}종 · 건물 {live:,}")
        return 0
    finally:
        await c.close()


sys.exit(asyncio.run(main()))
