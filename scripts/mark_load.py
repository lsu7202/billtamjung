#!/usr/bin/env python3
"""파생 배치가 돌았다는 사실을 master.master_loads 에 남긴다.

**왜 필요한가.** 적재 기록이 loader.py 의 5개 원천에만 남아서, 파생 배치(임대·적정가·점수·
규제 등)는 언제 무엇으로 돌았는지 알 길이 없었다. 층 표기가 두 달간 뒤집혀 있던 것을
늦게 안 이유 중 하나가 이것이다 — 「언제 덮였나」에 답할 자료가 없었다.

    scripts/mark_load.py <태그> <시작시각ISO> <success|failed> [사유]
"""
import datetime as dt
import os
import sys
import uuid

import asyncpg
import asyncio

DSN = os.environ.get("BT_DATABASE_URL") or os.environ.get("DATABASE_URL", "")


async def main() -> None:
    if not DSN or len(sys.argv) < 4:
        return                      # 기록은 곁다리다 — 못 남겨도 파이프라인을 멈추지 않는다
    tag, t0, status = sys.argv[1], sys.argv[2], sys.argv[3]
    err = sys.argv[4] if len(sys.argv) > 4 else None
    try:
        c = await asyncpg.connect(DSN, timeout=20)
        # asyncpg 는 ::timestamptz 캐스트를 안 봐 준다 — 파이썬에서 파싱해 넘긴다
        started = dt.datetime.fromisoformat(t0.replace("Z", "+00:00"))
        await c.execute(
            """INSERT INTO master.master_loads(run_id, source, started_at, finished_at, status, error)
               VALUES($1,$2,$3, now(), $4, $5)""",
            uuid.uuid4(), tag, started, status, err or None)
        await c.close()
    except Exception:
        pass


asyncio.run(main())
