#!/usr/bin/env python3
"""부동산원 상권 72칸 되붙이기 — **원본 SHP 이 유실됐을 때의 길**.

`load_sanggwon.py` 는 `data/raw/상권구획도(업로드용)/최종상권368.shp` 를 읽는데
그 폴더가 없어졌다(2026-08-30 확인). 원본은 공공데이터포털 15086933 이지만 자동 다운로드가
없고, `master.sanggwon` 72행은 DB 에 남아 있다. 그래서 **DB 에서 떠 둔 CSV** 를 정본으로 삼는다.

임대 추정이 `ST_Contains(sg.geom, b.geom)` 로 건물↔상권을 붙일 때 이 표를 읽는다.
비면 상권 보정이 통째로 빠져 추정이 조용히 나빠진다.

SHP 을 다시 구하면 `load_sanggwon.py` 가 정본으로 돌아간다 — 이건 그때까지의 보험이다.

    BT_DATABASE_URL=... backend/.venv/bin/python scripts/sanggwon/load_sanggwon_csv.py [파일]
"""
import asyncio
import csv
import gzip
import io
import os
import sys

import asyncpg

DSN = os.environ.get("BT_DATABASE_URL") or os.environ.get(
    "DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    ROOT, "data", "exports", "sanggwon", "sanggwon.csv.gz")


async def main() -> None:
    if not os.path.exists(SRC):
        print(f"✗ 파일이 없습니다: {SRC}")
        sys.exit(1)
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=600)
    try:
        before = await c.fetchval("SELECT count(*) FROM master.sanggwon")
        op = gzip.open if SRC.endswith(".gz") else open
        rows = []
        with op(SRC, "rt", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                rows.append((r["nm"], r["sido"], r["small"] == "t", r["mid"] == "t",
                             r["office"] == "t", r["jip"] == "t", r["wkt"]))
        if len(rows) < 50:
            print(f"✗ 행이 너무 적습니다({len(rows)}) — 파일을 확인하세요")
            sys.exit(1)

        async with c.transaction():
            await c.execute("TRUNCATE master.sanggwon RESTART IDENTITY")
            await c.executemany(
                """INSERT INTO master.sanggwon(nm, sido, small, mid, office, jip, geom)
                   VALUES($1,$2,$3,$4,$5,$6, ST_GeomFromText($7, 4326))""", rows)
        after = await c.fetchval("SELECT count(*) FROM master.sanggwon")
        print(f"sanggwon {before} → {after}행")
        if after != len(rows):
            print(f"✗ 넣은 수({len(rows)})와 표의 수({after})가 다릅니다")
            sys.exit(1)
    finally:
        await c.close()


asyncio.run(main())
