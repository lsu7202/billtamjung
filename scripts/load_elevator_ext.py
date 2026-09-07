#!/usr/bin/env python3
"""master.buildings.elevator_ext — 한국승강기안전공단 설치현황을 도로명으로 붙인다.

## 왜 따로 떼었나 (2026-09-07)

승강기공단은 **별도 원천**이다. 출처(공공데이터포털 15112638)도 파일도 갱신 주기(분기)도
건축HUB 대장과 다르다. 그런데 값이 `build_building_master.py` 안에 대장의 한 칸으로 박혀
있어서, 승강기만 갱신하려 해도 대장 28단계를 통째로 다시 조립해야 했다.

원천별 증분 파이프라인의 원칙에 어긋난다(specs/07-architecture/07). 그래서 자기 단위로 뗀다.
`load_parcel_luris.py`·`load_road_width.py` 와 같은 자리다 — **대장 CSV 에 없는 값을 적재 뒤에
붙이고, 대장을 다시 실으면 그 붙이기도 같이 돈다**(units.py 의 ledger 적재 줄에 들어 있다).

## 규칙 — build_building_master._elev_ext 와 같은 것

  · 서울 · 「운행중」「휴지」만 · 에스컬레이터·자동차용 제외. 승강기고유번호 한 줄 = 1대
  · 건물주소를 정규화(괄호 제거·공백 제거)해 대장 도로명주소와 맞춘다
  · 한 도로명에 건물이 여럿이면 대수를 못 가르므로 **「있음」의 뜻으로 1**(과다계상 방지)

**본값은 대장뿐이다**(0156). 이 값은 대장이 비었을 때 화면 옆에 참조로만 선다.

    BT_DATABASE_URL=... backend/.venv/bin/python scripts/load_elevator_ext.py
"""
import asyncio
import collections
import csv
import os
import re
import sys

import asyncpg

DSN = os.environ.get("BT_DATABASE_URL") or os.environ.get(
    "DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")

FILES = ["data/raw/한국승강기안전공단_승강기 설치 현황_2016년 이후.csv",
         "data/raw/한국승강기안전공단_승강기 설치 현황_2015년 이전.csv"]
EXCLUDE = ("에스컬레이터", "자동차용")     # 사람 승강기가 아니다
STATUS = ("운행중", "휴지")               # 폐지 제외

_paren = re.compile(r"\(.*?\)")
_ws = re.compile(r"\s+")


def norm_road(a: str | None) -> str | None:
    if not a:
        return None
    return _ws.sub("", _paren.sub("", a)) or None


def load_kelisa() -> collections.Counter:
    cnt: collections.Counter = collections.Counter()
    for fn in FILES:
        if not os.path.exists(fn):
            sys.exit(f"✗ 원천이 없습니다 — {fn}")
        with open(fn, encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                if row.get("시도") != "서울":
                    continue
                if any(t in (row.get("승강기종류") or "") for t in EXCLUDE):
                    continue
                if (row.get("승강기상태") or "") not in STATUS:
                    continue
                k = norm_road(row.get("건물주소"))
                if k:
                    cnt[k] += 1
    if not cnt:
        sys.exit("✗ 서울 줄을 하나도 못 읽었습니다 — 칸 이름이 바뀌었는지 보세요")
    return cnt


async def main() -> int:
    kel = load_kelisa()
    print(f"  승강기공단 정규화 주소 {len(kel):,}건 · 총 {sum(kel.values()):,}대")

    c = await asyncpg.connect(DSN, timeout=60, command_timeout=3600)
    try:
        # 살아 있는 세대를 뷰에서 찾는다. **세대 이름을 박지 않는다**(2026-09-06 parcels_v6 사고).
        tbl = await c.fetchval(
            """SELECT regexp_replace(pg_get_viewdef(c.oid), '.*FROM master\\.([a-z_0-9]+).*',
                                     '\\1', 'ns')
                 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'master' AND c.relname = 'buildings'""")
        if not tbl or not tbl.startswith("buildings"):
            sys.exit(f"✗ master.buildings 가 가리키는 표를 못 찾았습니다 — {tbl!r}")
        print(f"  살아 있는 세대: master.{tbl}")

        await c.execute("CREATE TEMP TABLE kel_in(road text primary key, n int)")
        await c.copy_records_to_table("kel_in", records=kel.items())

        # 한 도로명에 건물이 여럿이면 대수를 못 가른다 → 「있음」의 뜻으로 1
        r = await c.execute(f"""
            WITH b AS (
              SELECT building_pk,
                     regexp_replace(regexp_replace(road_addr, '\\(.*?\\)', '', 'g'),
                                    '\\s+', '', 'g') AS road
                FROM master.{tbl} WHERE road_addr IS NOT NULL AND road_addr <> ''),
                 m AS (SELECT road, count(*) AS n_bldg FROM b GROUP BY road)
            UPDATE master.{tbl} t
               SET elevator_ext = CASE WHEN m.n_bldg <= 1 THEN k.n ELSE 1 END
              FROM b JOIN m USING (road) JOIN kel_in k USING (road)
             WHERE t.building_pk = b.building_pk""")

        got, tot = await c.fetchrow(
            f"SELECT count(elevator_ext), count(*) FROM master.{tbl}")
        both = await c.fetchval(
            f"SELECT count(*) FROM master.{tbl} WHERE elevator IS NULL AND elevator_ext IS NOT NULL")
        print(f"  붙임 {r.split()[-1]} · elevator_ext {got:,} / {tot:,}")
        print(f"  대장이 비어 화면에 참조로 설 건물 {both:,}동")
        return 0
    finally:
        await c.close()


sys.exit(asyncio.run(main()))
