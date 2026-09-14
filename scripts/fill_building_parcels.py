#!/usr/bin/env python3
"""건물↔필지 연결의 구멍을 메운다 — `master.building_parcels` 에 줄이 하나도 없는 건물(2026-09-06 실측 57,228동).

## 왜 비었나
building_parcels 는 총괄표제부의 대표·부속 지번에서 만든다. 총괄표제부가 없는 건물(단독 표제부만 있는
일반 건물이 대부분)은 줄이 안 생긴다. 그런데 그 건물도 표제부의 대지 pnu 는 갖고 있고,
57,228 중 47,975(84%) 는 그 pnu 가 필지 원장에 실재한다. 나머지 9,253 은 좌표도 없는 건물이라 필지도 없다.

## 무엇을 하나
연결이 하나도 없는 건물에 **자기 대지 pnu 를 「대표」 로** 한 줄 넣는다. 실재하는 필지만. 이미 있는 건 안 건드린다.
건물 상세의 필지 셀렉터·공시지가·용도지역·규제가 전부 이 표를 읽는다 — 줄이 없으면 그 칸이 통째로 빈다.

    BT_DATABASE_URL=... backend/.venv/bin/python scripts/fill_building_parcels.py
"""
import asyncio
import os
import sys

import asyncpg

DSN = os.environ.get("BT_DATABASE_URL") or os.environ.get(
    "DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")


async def main() -> int:
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=3600)
    try:
        before = await c.fetchval(
            """SELECT count(*) FROM master.buildings b
                WHERE NOT EXISTS (SELECT 1 FROM master.building_parcels bp WHERE bp.building_pk = b.building_pk)""")
        r = await c.execute(
            """INSERT INTO master.building_parcels (building_pk, pnu, role)
               SELECT b.building_pk, b.pnu, '대표'
                 FROM master.buildings b
                 JOIN master.parcels p ON p.pnu = b.pnu
                WHERE b.pnu IS NOT NULL AND b.pnu <> ''
                  AND NOT EXISTS (SELECT 1 FROM master.building_parcels bp WHERE bp.building_pk = b.building_pk)
               ON CONFLICT (building_pk, pnu) DO NOTHING""")
        after = await c.fetchval(
            """SELECT count(*) FROM master.buildings b
                WHERE NOT EXISTS (SELECT 1 FROM master.building_parcels bp WHERE bp.building_pk = b.building_pk)""")
        print(f"  building_parcels 구멍 {before:,} → {after:,} (넣음 {r.split()[-1]}) · 남은 것은 필지 원장에 없는 pnu(좌표 없는 건물)")
        return 0
    finally:
        await c.close()


sys.exit(asyncio.run(main()))
