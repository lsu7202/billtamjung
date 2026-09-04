#!/usr/bin/env python3
"""master.building_legal — 건물별 법정 건폐율·용적률(필지 원장에서).

## 왜 만드는가
같은 값을 세 곳이 다르게 냈다(2026-09-04).

  건물 상세·리포트·매력도  →  필지 원장 `parcels.legal_bcr/legal_far` (토지이음 산식, 0153)
  **검색 필터**            →  `use_zone` 으로 박아 둔 CASE 문. 필지를 안 본다

CASE 문은 「일반상업지역이면 800%」로 잘라 놓아서, 같은 건물이 상세에서는 1,570%,
검색에서는 800% 였다. 검색이 원장을 읽으면 되는데 건물마다 서브쿼리를 걸면 58만 동을
훑는다 — 그래서 배치로 한 번 펴 둔다.

## 산식 — 건물 상세와 **같은 것**
`building_parcels` 로 건물이 걸친 필지를 다 모아, **병기(값 둘 이상)는 빼고** 가장 큰 값.
병기 필지는 어느 값이 이 건물에 걸리는지 원장이 말해 주지 않는다. 견줄 수 없으면 안 쓴다.
(0153 전에는 text 에 max() 를 걸어 '50%' 가 '245%' 보다 컸다.)

**건물 상세가 못 내는 값은 여기서도 안 낸다.** `pnu` 는 있는데 `building_parcels` 에 줄이
없는 건물이 47,879 동 있다. 건물의 pnu 로 직접 붙이면 메워지지만, 그러면 검색은 값을 내고
상세는 빈 칸인 화면이 된다. 구멍은 원장 연결에서 메운다 — 여기서 우회하지 않는다.

    BT_DATABASE_URL=... backend/.venv/bin/python scripts/build_building_legal.py
"""
import asyncio
import os

import asyncpg

DSN = os.environ.get("BT_DATABASE_URL") or os.environ.get(
    "DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")

SQL = """
DROP TABLE IF EXISTS master.building_legal;
CREATE TABLE master.building_legal AS
SELECT bp.building_pk,
       max(p.legal_bcr[1]) FILTER (WHERE array_length(p.legal_bcr, 1) = 1)::int AS legal_bcr,
       max(p.legal_far[1]) FILTER (WHERE array_length(p.legal_far, 1) = 1)::int AS legal_far,
       -- 병기 필지에 걸친 건물. 값이 비는 이유를 화면이 말할 수 있게 남긴다
       bool_or(array_length(p.legal_far, 1) > 1 OR array_length(p.legal_bcr, 1) > 1) AS has_mixed
  FROM master.building_parcels bp
  JOIN master.parcels p ON p.pnu = bp.pnu
 GROUP BY bp.building_pk
HAVING max(p.legal_bcr[1]) FILTER (WHERE array_length(p.legal_bcr, 1) = 1) IS NOT NULL
    OR max(p.legal_far[1]) FILTER (WHERE array_length(p.legal_far, 1) = 1) IS NOT NULL
    OR bool_or(array_length(p.legal_far, 1) > 1 OR array_length(p.legal_bcr, 1) > 1);
ALTER TABLE master.building_legal ADD PRIMARY KEY (building_pk);
CREATE INDEX ON master.building_legal(legal_far) WHERE legal_far IS NOT NULL;
CREATE INDEX ON master.building_legal(legal_bcr) WHERE legal_bcr IS NOT NULL;
"""


async def main() -> None:
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=3600)
    try:
        await c.execute(SQL)
        r = await c.fetchrow("""SELECT count(*) n, count(legal_bcr) b, count(legal_far) f,
                                      count(*) FILTER (WHERE has_mixed) m
                                 FROM master.building_legal""")
        print(f"  행 {r['n']:,} · 건폐율 {r['b']:,} · 용적률 {r['f']:,} · 병기 필지에 걸친 건물 {r['m']:,}")
        cov = await c.fetchval("""
            SELECT round(100.0 * count(l.legal_far) / count(*), 1)
              FROM master.buildings b LEFT JOIN master.building_legal l USING (building_pk)""")
        print(f"  커버리지 용적률 {cov}%")
        # 건물 상세와 **같은 값**을 내는가 — 상세가 읽는 그 문(building_parcels)으로 대조한다.
        # 직접 pnu 로 붙인 건물은 상세가 아직 값을 못 내므로 대조 대상이 아니다(아래 따로 센다).
        bad = await c.fetchval("""
            WITH s AS (SELECT l.building_pk FROM master.building_legal l
                        WHERE EXISTS (SELECT 1 FROM master.building_parcels bp
                                       WHERE bp.building_pk = l.building_pk) LIMIT 1000)
            SELECT count(*) FROM s
              JOIN master.building_legal l USING (building_pk)
             WHERE l.legal_far IS DISTINCT FROM
                   (SELECT p.legal_far[1] FROM master.building_parcels bp
                      JOIN master.parcels p ON p.pnu = bp.pnu
                     WHERE bp.building_pk = s.building_pk AND array_length(p.legal_far, 1) = 1
                     ORDER BY p.legal_far[1] DESC LIMIT 1)""")
        print(f"  ✓ 건물 상세 산식과 대조 — 어긋난 건물 {bad}동 / 1,000" if not bad
              else f"  ✗ 건물 상세와 다른 값 {bad}동 / 1,000")
        # 원장 연결이 없어 값을 못 내는 건물. 건물 상세도 똑같이 못 낸다 — 여기서 메우지 않는다.
        ex = await c.fetchval("""
            SELECT count(*) FROM master.buildings b
             WHERE b.pnu IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM master.building_parcels bp
                                WHERE bp.building_pk = b.building_pk)""")
        print(f"  pnu 는 있는데 building_parcels 에 줄이 없는 건물 {ex:,}동 — 원장 연결의 구멍이다(별건)")
    finally:
        await c.close()


asyncio.run(main())
