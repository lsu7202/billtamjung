#!/usr/bin/env python3
"""master.buildings 의 교통 세 칸(station_dist · subway_json · bus_json)을 되붙인다 — 교통 단위.

## 왜 따로 떼었나 (2026-09-07)

역사마스터·버스정류소는 **반기**마다 오는 별도 원천인데, 값이 `build_transit.py` → `build_integrated`
→ `buildings.csv` 로 대장 빌드 안에 구워져 있었다. 교통만 갱신하려 해도 대장 28단계를 다 돌아야 했다.
승강기(`load_elevator_ext.py`)·공시지가(`fill_gongsi_latest.py`)와 같은 자리다.

`build_transit.py ALL` 이 낸 `data/tools/_transit_ALL.jsonl`(PNU 키)을 읽어 살아 있는 세대 표에
UPDATE 한다. 산식은 빌더 그대로 — 여기서 다시 재지 않는다.

대장을 새로 실을 때는 이 되붙임이 **필요 없다** — `build_integrated` 가 같은 jsonl 을 CSV 에 굽는다.
그래서 `ledger` 단위 적재 줄에는 안 건다(되붙임 두 곳 규칙의 예외).

    BT_DATABASE_URL=... backend/.venv/bin/python scripts/fill_transit.py
"""
import asyncio
import json
import os
import sys

import asyncpg

DSN = os.environ.get("BT_DATABASE_URL") or os.environ.get(
    "DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")
SRC = "data/tools/_transit_ALL.jsonl"


async def main() -> int:
    if not os.path.exists(SRC):
        sys.exit(f"✗ {SRC} 가 없습니다 — data/tools/build_transit.py ALL 을 먼저")

    rows = []
    with open(SRC, encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            pnu = r.get("PNU")
            if not pnu:
                continue
            rows.append((pnu, r.get("역과의거리"),
                         json.dumps(r.get("주변지하철") or [], ensure_ascii=False),
                         json.dumps(r.get("주변버스") or [], ensure_ascii=False)))
    print(f"  _transit_ALL.jsonl 필지 {len(rows):,}")

    c = await asyncpg.connect(DSN, timeout=60, command_timeout=3600)
    try:
        # 살아 있는 세대를 뷰에서 찾는다. **세대 이름을 박지 않는다**(2026-09-06 parcels_v6 사고)
        tbl = await c.fetchval(
            r"""SELECT regexp_replace(pg_get_viewdef(c.oid), '.*FROM master\.([a-z_0-9]+).*', '\1', 'ns')
                  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'master' AND c.relname = 'buildings'""")
        if not tbl or not tbl.startswith("buildings"):
            sys.exit(f"✗ master.buildings 가 가리키는 표를 못 찾았습니다 — {tbl!r}")

        await c.execute("CREATE TEMP TABLE tr_in(pnu text primary key, sd int, sub text, bus text)")
        await c.copy_records_to_table("tr_in", records=rows)
        r = await c.execute(f"""
            UPDATE master.{tbl} b
               SET station_dist = t.sd, subway_json = t.sub::jsonb, bus_json = t.bus::jsonb
              FROM tr_in t
             WHERE t.pnu = b.pnu
               AND (b.station_dist IS DISTINCT FROM t.sd
                    OR b.subway_json IS DISTINCT FROM t.sub::jsonb
                    OR b.bus_json IS DISTINCT FROM t.bus::jsonb)""")
        got, tot = await c.fetchrow(f"SELECT count(station_dist), count(*) FROM master.{tbl}")
        print(f"  master.{tbl} · 고친 줄 {r.split()[-1]} · 역거리 있는 건물 {got:,} / {tot:,}")
        return 0
    finally:
        await c.close()


sys.exit(asyncio.run(main()))
