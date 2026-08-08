#!/usr/bin/env python3
"""건물 높이(m) 백필 — 표제부 42번을 master.buildings.height로. 멱등.

다음 전체 파이프라인 재빌드 때는 build_building_master._height → export → loader 경로로
자동 적재된다(schema_buildings.COLUMNS). 이 스크립트는 그 전에 한 번 채우기 위한 것이다.

정리 규칙은 build_building_master._height와 같아야 한다 — 여기서만 바꾸면 재빌드 때 값이 달라진다.
  h≤1m·h>600m 버림 · 층수 있으면 층당 2~8m 밖은 버림(실측: 0.1m·13438m 원본 오류)

사용: python3 scripts/backfill_height.py [DSN]
"""
import asyncio
import os
import sys

import asyncpg

DSN = sys.argv[1] if len(sys.argv) > 1 else os.environ.get(
    "BT_DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")
MART = os.environ.get("BT_MART_DJY03", "data/raw/seoul/mart_djy_03_seoul.txt")


def _f(s: str) -> float:
    try:
        return float((s or "").strip() or 0)
    except ValueError:
        return 0.0


def rows():
    with open(MART, "rb") as f:
        for line in f:
            c = line.decode("utf-8", "replace").rstrip("\n").split("|")
            if len(c) < 62:
                continue
            pk, h, fl = c[0].strip(), _f(c[42]), int(_f(c[43]))
            if not pk or h <= 1 or h > 600:
                continue
            if fl > 0 and not (fl * 2 <= h <= fl * 8):
                continue
            yield pk, round(h, 1)


async def main() -> None:
    c = await asyncpg.connect(DSN)
    await c.execute("SET statement_timeout = 0")
    await c.execute("CREATE TEMP TABLE _h(building_pk text, height numeric)")
    n = 0
    batch = []
    for r in rows():
        batch.append(r); n += 1
        if len(batch) >= 50_000:
            await c.copy_records_to_table("_h", records=batch); batch = []
    if batch:
        await c.copy_records_to_table("_h", records=batch)
    print(f"표제부 유효 높이 {n:,}건")

    await c.execute("CREATE INDEX ON _h(building_pk)")
    live = await c.fetchval("""SELECT 'buildings_v' || max(substring(table_name from '_v(\\d+)$')::int)
                               FROM information_schema.tables
                               WHERE table_schema='master' AND table_name ~ '^buildings_v\\d+$'""")
    upd = await c.execute(f"""
        UPDATE master.{live} b SET height = h.height
        FROM (SELECT building_pk, max(height) height FROM _h GROUP BY 1) h
        WHERE b.building_pk = h.building_pk AND b.height IS DISTINCT FROM h.height""")
    row = await c.fetchrow("""SELECT count(*) n, count(height) h, round(avg(height),1) avg
                              FROM master.buildings""")
    print(f"{live}: {upd} · 높이 확보 {row['h']:,}/{row['n']:,} "
          f"({row['h'] / row['n'] * 100:.1f}%) · 평균 {row['avg']}m")
    await c.close()


if __name__ == "__main__":
    asyncio.run(main())
