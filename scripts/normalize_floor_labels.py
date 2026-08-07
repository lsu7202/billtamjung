#!/usr/bin/env python3
"""master.floor_outline.floor 를 정규 표기로 통일(0031 백필). 멱등 — 몇 번 돌려도 같다.

원본은 floor_raw에 보존되므로 항상 raw에서 다시 계산한다.
새로 적재되는 데이터는 data/tools/build_floor_outline.py가 이미 정규화해서 넣는다.

사용: python3 scripts/normalize_floor_labels.py [DSN]
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "tools"))
import asyncpg  # noqa: E402
from floor_label import normalize  # noqa: E402

DSN = sys.argv[1] if len(sys.argv) > 1 else os.environ.get(
    "BT_DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")


async def main() -> None:
    c = await asyncpg.connect(DSN)
    raws = [r["floor_raw"] for r in await c.fetch(
        "SELECT DISTINCT floor_raw FROM master.floor_outline WHERE floor_raw IS NOT NULL")]
    mapping = []
    kinds = {}
    for r in raws:
        lb, kind = normalize(r)
        kinds[kind] = kinds.get(kind, 0) + 1
        if lb and lb != r:
            mapping.append((r, lb))
    print(f"표기 {len(raws):,}종 · 바뀔 것 {len(mapping):,}종 · 종류별 {kinds}")

    if mapping:
        await c.execute("CREATE TEMP TABLE _fl(raw text PRIMARY KEY, norm text)")
        await c.copy_records_to_table("_fl", records=mapping)
        n = await c.fetchval("""
            WITH u AS (
              UPDATE master.floor_outline fo SET floor = m.norm
              FROM _fl m WHERE fo.floor_raw = m.raw AND fo.floor IS DISTINCT FROM m.norm
              RETURNING 1)
            SELECT count(*) FROM u""")
        print(f"갱신 {n:,}행")

    left = await c.fetchval(
        "SELECT count(*) FROM master.floor_outline WHERE floor !~ '^(내)?(지하|옥탑|중)?[0-9]+층$'")
    print(f"정규 표기 아닌 잔여 {left:,}행 — 판정 불가라 원본 유지(2층이상·지하1층.1층 등)")

    for mv in ("master.floor_est_by_floor", "master.floor_est_total"):
        try:
            await c.execute(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {mv}")
            print(f"  · {mv} 갱신")
        except Exception as e:
            print(f"  ⚠️ {mv} 갱신 실패: {e}")
    await c.close()


if __name__ == "__main__":
    asyncio.run(main())
