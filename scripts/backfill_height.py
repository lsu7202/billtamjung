#!/usr/bin/env python3
"""건물 높이(master.buildings_v2.height) 백필 — 원천 CSV → UPDATE.

왜 필요한가:
  0034_building_height.sql은 컬럼만 추가하고 값은 안 채운다. 값은 buildings CSV에 실려
  loader가 buildings를 **재적재**할 때 들어온다. 그런데 프로덕션 buildings는 0034 이전 세대라
  컬럼만 생기고 전부 NULL이 됐다(2026-08-09 발견 · 로컬 32.7만동 / 프로덕션 0).

  buildings 전체(56만행)를 재적재하려면 원천부터 다시 빌드해야 해서, 이미 값이 있는 DB에서
  (building_pk, height)만 뽑아 옮긴다. 1회성 백필이고, 다음 정기 적재부터는 CSV에 실려 자동으로 맞는다.

사용:
  # 1) 값이 있는 DB에서 뽑기
  BT_DATABASE_URL=<원본DSN> python3 scripts/backfill_height.py dump  > /tmp/height.csv
  # 2) 대상 DB에 넣기
  BT_DATABASE_URL=<대상DSN> python3 scripts/backfill_height.py load  < /tmp/height.csv

임시테이블 → UPDATE ... FROM 이라 기존 값은 덮지 않는다(height IS NULL 인 행만).
"""
import asyncio
import os
import sys

import asyncpg

DSN = os.environ.get("BT_DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")


async def dump() -> None:
    c = await asyncpg.connect(DSN)
    try:
        rows = await c.fetch(
            "SELECT building_pk, height FROM master.buildings_v2 WHERE height IS NOT NULL")
        out = sys.stdout
        for r in rows:
            out.write(f"{r['building_pk']},{r['height']}\n")
        print(f"{len(rows):,}행 추출", file=sys.stderr)
    finally:
        await c.close()


async def load() -> None:
    pairs = []
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        pk, h = line.rsplit(",", 1)
        pairs.append((pk, float(h)))
    if not pairs:
        print("입력 없음", file=sys.stderr)
        return

    c = await asyncpg.connect(DSN)
    try:
        before = await c.fetchval("SELECT count(height) FROM master.buildings_v2")
        async with c.transaction():
            await c.execute("CREATE TEMP TABLE _h(building_pk text PRIMARY KEY, height numeric) ON COMMIT DROP")
            await c.copy_records_to_table("_h", records=pairs)
            # 이미 값이 있는 행은 건드리지 않는다 — 백필이지 덮어쓰기가 아니다.
            n = await c.execute("""UPDATE master.buildings_v2 b SET height = h.height
                                     FROM _h h
                                    WHERE b.building_pk = h.building_pk AND b.height IS NULL""")
        after = await c.fetchval("SELECT count(height) FROM master.buildings_v2")
        print(f"입력 {len(pairs):,}행 · {n} · height 보유 {before:,} → {after:,}", file=sys.stderr)
    finally:
        await c.close()


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "dump":
        asyncio.run(dump())
    elif mode == "load":
        asyncio.run(load())
    else:
        print(__doc__)
        sys.exit(1)
