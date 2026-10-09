#!/usr/bin/env python3
"""지번 단위 MV 셋을 새로 고친다 — master.parcel_rep(0230) · master.vacant_parcels(0131) · master.parcel_spot(0258).

## 왜 따로 필요한가 (2026-10-07)

둘 다 대장 · 필지 · 건물↔필지 연결 위에 선 MV 인데 **아무도 새로 고치지 않았다.**
적재기가 갱신하는 MV 는 region_index 하나다(sales_agg 는 load_trades.py). 그래서 대장을 다시 실어도

  - parcel_rep(지번 대표 동 · 연면적 합 · 최고층) 은 옛 동 목록으로 남고
  - vacant_parcels(건물 없는 필지) 는 새로 지은 건물을 여전히 나대지로 센다.

vacant_parcels 는 building_parcels 를 읽으므로 **적재 뒤 되붙임(fill_building_parcels)이 끝난 다음**이라야
한다. 그래서 적재기 안이 아니라 파생 단계에 둔다.

    BT_DATABASE_URL=... backend/.venv/bin/python scripts/refresh_parcel_mvs.py
"""
import asyncio
import os
import time

import asyncpg

DSN = os.environ.get("BT_DATABASE_URL") or os.environ.get(
    "DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")

# 셋 다 유일 색인이 있어 CONCURRENTLY 로 돈다 — 화면 조회를 막지 않는다.
# parcel_spot(검색 출발점)은 앞의 둘을 읽으므로 **맨 뒤**다
MVS = ("master.parcel_rep", "master.vacant_parcels", "master.parcel_spot")


async def main() -> None:
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=3600)
    try:
        for mv in MVS:
            t = time.time()
            await c.execute(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {mv}")
            n = await c.fetchval(f"SELECT count(*) FROM {mv}")
            print(f"  · {mv} {n:,}줄 ({time.time() - t:.1f}s)", flush=True)
    finally:
        await c.close()


if __name__ == "__main__":
    asyncio.run(main())
