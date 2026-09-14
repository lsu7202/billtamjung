#!/usr/bin/env python3
"""검색 전용 계산값 — master.building_calc (0143).

대장이 0으로 준 용적률·건폐율을 **검색에서만** 쓰려고 채운다.
화면 값은 건축물대장과 일치해야 한다 — 계약서·중개대상물 확인설명서·브리핑으로 그대로 이어진다.
그래서 master.buildings 는 안 건드리고 이 표에만 담는다. search.py 의 필터만 COALESCE 한다.

## 왜 필요한가
지금 용적률로 거르면 89,418동(15.3%)이 통째로 사라진다. 「여유 용적률」로 신축 부지를 찾는
필터가 정작 옛 저층 건물을 빠뜨린다 — 가장 유망한 물건들이다.

## 산식 — 필지 단위 합산
용적률·건폐율은 **건물이 아니라 필지의 값**이다. 대장은 그 필지의 값을 각 동에 똑같이 적는다.
  관악구 남현동 1136번지(12동): 한 동만 보면 0.43%, 12동 합치면 205.95% = 대장 값
검산: 대장에 값이 있는 427,107 필지 대조 → 99.1% 일치.

## 채우는 순서
  ① parcel_copy — 같은 필지 다른 동에 **대장 값**이 있으면 그대로 옮긴다(계산이 아니다)
  ② computed    — 필지의 면적 합 ÷ 대지면적
대장에 값이 있는 건물은 **아예 안 담는다**(NULL) — 대장이 언제나 이긴다.

    BT_DATABASE_URL=... backend/.venv/bin/python scripts/build_building_calc.py
"""
import asyncio
import os
import sys

import asyncpg

DSN = os.environ.get("BT_DATABASE_URL") or os.environ.get(
    "DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")

SQL = """
WITH pn AS (      -- 필지별 재료. 대장값(max)과 면적 합(sum)을 같이 본다
  SELECT pnu,
         max(far) AS p_far, max(bcr) AS p_bcr, count(*) AS n,
         sum(far_area) AS p_fa, sum(build_area) AS p_ba, max(land_area) AS p_la
    FROM master.buildings WHERE pnu IS NOT NULL GROUP BY pnu),
calc AS (
  SELECT b.building_pk,
         CASE WHEN b.far IS NOT NULL THEN NULL          -- 대장이 이긴다
              WHEN pn.p_far IS NOT NULL THEN pn.p_far
              WHEN pn.p_fa > 0 AND pn.p_la > 0 THEN round((pn.p_fa / pn.p_la * 100)::numeric, 2)
         END AS far_calc,
         CASE WHEN b.far IS NOT NULL THEN NULL
              WHEN pn.p_far IS NOT NULL THEN 'parcel_copy'
              WHEN pn.p_fa > 0 AND pn.p_la > 0 THEN 'computed'
         END AS far_src,
         CASE WHEN b.bcr IS NOT NULL THEN NULL
              WHEN pn.p_bcr IS NOT NULL THEN pn.p_bcr
              WHEN pn.p_ba > 0 AND pn.p_la > 0 THEN round((pn.p_ba / pn.p_la * 100)::numeric, 2)
         END AS bcr_calc,
         CASE WHEN b.bcr IS NOT NULL THEN NULL
              WHEN pn.p_bcr IS NOT NULL THEN 'parcel_copy'
              WHEN pn.p_ba > 0 AND pn.p_la > 0 THEN 'computed'
         END AS bcr_src,
         -- 면적 두 칸은 **단독 필지에서만** 되돌린다(대지면적 × 대장 비율).
         -- 다동 필지는 비율이 필지 것이라 한 동 면적으로 못 쪼갠다.
         CASE WHEN b.build_area IS NULL AND pn.n = 1 AND b.bcr > 0 AND b.land_area > 0
              THEN round((b.bcr / 100 * b.land_area)::numeric, 2) END AS build_area_calc,
         CASE WHEN b.far_area IS NULL AND pn.n = 1 AND b.far > 0 AND b.land_area > 0
              THEN round((b.far / 100 * b.land_area)::numeric, 2) END AS far_area_calc
    FROM master.buildings b LEFT JOIN pn ON pn.pnu = b.pnu)
INSERT INTO master.building_calc(building_pk, far_calc, bcr_calc, far_src, bcr_src,
                                 build_area_calc, far_area_calc)
SELECT building_pk, far_calc, bcr_calc, far_src, bcr_src, build_area_calc, far_area_calc
  FROM calc WHERE far_calc IS NOT NULL OR bcr_calc IS NOT NULL
              OR build_area_calc IS NOT NULL OR far_area_calc IS NOT NULL
"""


async def main() -> None:
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=3600)
    try:
        await c.execute("TRUNCATE master.building_calc")
        res = await c.execute(SQL)
        print(f"적재: {res}")
        r = await c.fetchrow("""
            SELECT count(*) n,
                   count(far_calc) f, count(bcr_calc) b,
                   count(*) FILTER (WHERE far_src='parcel_copy') fc,
                   count(*) FILTER (WHERE far_src='computed')    fp,
                   count(*) FILTER (WHERE bcr_src='parcel_copy') bc,
                   count(*) FILTER (WHERE bcr_src='computed')    bp,
                   count(build_area_calc) ba, count(far_area_calc) fa
              FROM master.building_calc""")
        print(f"  행 {r['n']:,}")
        print(f"  용적률 {r['f']:,}  (필지값 복사 {r['fc']:,} · 계산 {r['fp']:,})")
        print(f"  건폐율 {r['b']:,}  (필지값 복사 {r['bc']:,} · 계산 {r['bp']:,})")
        print(f"  건축면적 {r['ba']:,} · 용적산정연면적 {r['fa']:,}  (단독 필지만)")

        # **대장을 덮지 않았는지** — 이 표에 담긴 건물이 대장에 값을 갖고 있으면 안 된다
        bad = await c.fetchval("""
            SELECT count(*) FROM master.building_calc c JOIN master.buildings b USING (building_pk)
             WHERE (c.far_calc IS NOT NULL AND b.far IS NOT NULL)
                OR (c.bcr_calc IS NOT NULL AND b.bcr IS NOT NULL)
                OR (c.build_area_calc IS NOT NULL AND b.build_area IS NOT NULL)
                OR (c.far_area_calc IS NOT NULL AND b.far_area IS NOT NULL)""")
        if bad:
            print(f"✗ 대장에 값이 있는데 계산값도 담긴 건물 {bad:,}동 — 대장이 이겨야 합니다")
            sys.exit(1)
        print("  ✓ 대장에 값이 있는 건물은 담지 않았습니다")

        cov = await c.fetchrow("""
            SELECT round(100.0*count(*) FILTER (WHERE b.far IS NOT NULL)/count(*),1) f0,
                   round(100.0*count(*) FILTER (WHERE b.far IS NOT NULL OR c.far_calc IS NOT NULL)/count(*),1) f1,
                   round(100.0*count(*) FILTER (WHERE b.bcr IS NOT NULL)/count(*),1) b0,
                   round(100.0*count(*) FILTER (WHERE b.bcr IS NOT NULL OR c.bcr_calc IS NOT NULL)/count(*),1) b1
              FROM master.buildings b LEFT JOIN master.building_calc c USING (building_pk)""")
        print(f"  커버리지 용적률 {cov['f0']}% → {cov['f1']}% · 건폐율 {cov['b0']}% → {cov['b1']}%")
    finally:
        await c.close()


asyncio.run(main())
