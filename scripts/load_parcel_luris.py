#!/usr/bin/env python3
"""필지 규제·용도지역을 되붙인다 — 토지이용계획정보(LURIS) 원장에서 온 값.

## 왜 이 스크립트가 있나

`parcels` 적재는 세대 스왑이다(v1↔v2 통째 교체). 그런데 용도지역·법정건폐율·법정용적률·
규제 네 칸은 **적재 CSV 에 없다.** 국토부 토지이용계획정보 원장(AL_D155)에서 따로 온 값이라
`parcels.csv` 에는 애초에 그 칸이 없다.

그래서 지금까지는 적재를 돌리면 이 네 칸이 **통째로 비었다.** 2026-08-28 에 손으로 한 번
채워 넣고 배선을 안 해서, 다음 전체 업데이트 한 번이면 89.7만 필지의 규제가 날아갈 참이었다.
건물 상세의 용도지역·건폐율·용적률·「규제·특례」가 전부 이 칸을 읽는다.

## 무엇이 정본인가

**용도지역·규제**는 원장이 정본이다. 원장은 필지마다 「무슨 지역·지구에 걸리는가」를
저촉여부(포함·접함·저촉)까지 적어 준다. 폴리곤 교차로 **계산**하던 옛 방식은 99.19%
까지밖에 못 갔고, 원장을 쓰면 100% 다(표본 2,857필지 대조 · 0136 주석).
용도지역 칸에는 「포함·저촉」만 센다. 「접함」은 토지이음도 그 칸에 안 넣는다.

**법정건폐율·법정용적률은 원장에 없다** — 칸 자체가 없다. 조례표를 붙여 계산하는데,
산식은 우리가 만들지 않고 **토지이음 것을 그대로 옮겨 쓴다**(`data/tools/eum_rule.py`).
중개인이 토지이음을 열어 놓고 대조하는 자리라 화면과 달라선 안 된다는 결정이다
(2026-09-02). 그래서 건폐율 110%·1,570% 같은 값도 그대로 실린다 — 저쪽 화면이 그렇다.

## 파일

`data/exports/luris/parcel_luris.csv.gz` (pnu·use_zone·legal_bcr·legal_far·regulations).
원천 CSV 는 1.97GB 라 저장소에 안 둔다. 용도지역·지구는 몇 달에 한 번 바뀌므로
**이 파일이 정본 노릇을 한다** — 원장을 새로 받으면 이 파일을 갈아 끼운다.

    BT_DATABASE_URL=... backend/.venv/bin/python scripts/load_parcel_luris.py [파일]
"""
import asyncio
import csv
import gzip
import io
import json
import os
import sys

import asyncpg

DSN = os.environ.get("BT_DATABASE_URL") or os.environ.get(
    "DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data", "exports", "luris", "parcel_luris.csv.gz")


async def main() -> None:
    if not os.path.exists(SRC):
        print(f"✗ 파일이 없습니다: {SRC}")
        sys.exit(1)
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=3600)
    try:
        before = await c.fetchrow(
            """SELECT count(*) n, count(use_zone) z, count(regulations) g
                 FROM master.parcels""")
        print(f"전: 필지 {before['n']:,} · 용도지역 {before['z']:,} · 규제 {before['g']:,}")

        # 임시 표에 부어 놓고 한 번에 조인한다. 89.7만 행을 UPDATE 로 하나씩 치면
        # 인덱스 갱신이 행마다 붙어 몇십 분이 된다(층 표기 백필 때 실측).
        await c.execute("""
            CREATE TEMP TABLE _luris(
              pnu text PRIMARY KEY, use_zone text, legal_bcr text,
              legal_far text, regulations jsonb)""")   # 세션과 함께 사라진다

        rows, n = [], 0
        op = gzip.open if SRC.endswith(".gz") else open
        with op(SRC, "rt", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                rows.append((r["pnu"] or None, r["use_zone"] or None,
                             r["legal_bcr"] or None, r["legal_far"] or None,
                             json.loads(r["regulations"]) if r["regulations"] else None))
                if len(rows) >= 50_000:
                    await c.copy_records_to_table(
                        "_luris", records=_enc(rows),
                        columns=["pnu", "use_zone", "legal_bcr", "legal_far", "regulations"])
                    n += len(rows); rows = []
                    print(f"  읽는 중 {n:,}", flush=True)
        if rows:
            await c.copy_records_to_table(
                "_luris", records=_enc(rows),
                columns=["pnu", "use_zone", "legal_bcr", "legal_far", "regulations"])
            n += len(rows)
        print(f"파일 {n:,}행")

        res = await c.execute("""
            -- **세대 이름(parcels_v2)을 박지 않는다.** 2026-09-01 적재가 v4 로 넘어가자
            -- 「relation master.parcels_v2 does not exist」로 깨졌다. master.parcels 는
            -- 한 표를 그대로 내보내는 단순 뷰라 UPDATE 가 그대로 통한다(is_updatable=YES).
            -- 뷰를 쓰면 세대가 몇 번으로 가든 따라간다.
            --
            -- **원장 값만 쓴다.** 예전엔 COALESCE(원장, 기존값) 이라 원장이 모르는 필지에
            -- 공간조인으로 계산한 옛 값이 남았다. 그 값들을 토지이음에서 직접 확인해 보니
            -- 지목이 하천·도로인 필지에 60%/800% 같은 값이 붙어 있었다(2026-09-01).
            -- 이제 export_parcels 가 이 칸들을 빈칸으로 내보내므로 덮을 옛 값도 없다.
            UPDATE master.parcels p SET
                use_zone    = l.use_zone,
                legal_bcr   = l.legal_bcr,
                legal_far   = l.legal_far,
                regulations = l.regulations
              FROM _luris l WHERE l.pnu = p.pnu""")
        print(f"되붙임: {res}")

        after = await c.fetchrow(
            """SELECT count(*) n, count(use_zone) z, count(regulations) g
                 FROM master.parcels""")
        print(f"후: 필지 {after['n']:,} · 용도지역 {after['z']:,} · 규제 {after['g']:,}")
        # 붙은 게 파일보다 적으면 PNU 가 안 맞는 것이다 — 조용히 넘기면 화면이 빈다
        if after["g"] < n * 0.95:
            print(f"⚠️  규제가 붙은 필지({after['g']:,})가 파일({n:,})의 95% 미만입니다 — PNU 대조 확인 필요")
            sys.exit(1)
    finally:
        await c.close()


def _enc(rows):
    """jsonb 는 문자열로 넘긴다 — copy_records_to_table 이 dict/list 를 직접 못 받는다."""
    return [(a, b, c_, d, json.dumps(e, ensure_ascii=False) if e is not None else None)
            for a, b, c_, d, e in rows]


asyncio.run(main())
