#!/usr/bin/env python3
"""소상공인 상가(상권)정보 서울판을 `master.sbiz_store` 로 적재한다(2026-09-05).

## 왜 넣나
대장은 층만 주고 **거기 뭐가 있는지를 안 준다.** 이게 그 칸을 채운다 —
층별 임대정보의 상호명 프리필이고, 상권을 「용도」가 아니라 **실제 업종**으로 가르는 재료다.

## 붙는 법
`건물관리번호` 25자리의 **앞 19자리가 PNU** 다. 그래서 `master.buildings.pnu` 로 바로 조인한다.

## 층 읽기 — 못 읽으면 안 옮긴다
`층정보` 는 표기가 섞여 있다(201종). 원문은 `floor` 에 그대로 두고,
읽어낸 것만 `floor_no` 에 넣는다. 못 읽으면 **null 이다 — 지어내지 않는다.**

    '1'~'99'   → 지상 n
    'B1'~'B9'  → 지하 -n   ('B02' 도 -2)
    '지' '반' '반지층' → 지하인 건 알지만 몇 층인지 모른다 → null (is_base=true)
    '1107' '4559' 'B103'  → 호수가 잘못 든 것 → null
      (3자리 이상은 안 받는다. 서울에 100층 넘는 건물이 몇 없어 잃는 것보다,
       호수를 층으로 읽어 「11층 카페」를 만드는 쪽이 훨씬 나쁘다)

    BT_DATABASE_URL=... backend/.venv/bin/python scripts/load_sbiz.py
"""
import asyncio
import csv
import glob
import io
import os
import re
import sys

import asyncpg

DSN = os.environ.get("BT_DATABASE_URL") or os.environ.get(
    "DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")
SRC = "data/raw/_sbiz"

DDL = """
DROP TABLE IF EXISTS master.sbiz_store;
CREATE TABLE master.sbiz_store(
  store_id  text PRIMARY KEY,
  name      text, branch text,
  cat1 text, cat2 text, cat3 text,          -- 상권업종 대·중·소분류명
  cat1_cd text, cat2_cd text, cat3_cd text,
  ksic     text,                            -- 표준산업분류명
  sgg      text, bjdong text,
  jibun    text, road text, bldg_name text,
  bldg_mgm text,                            -- 건물관리번호 25자리
  pnu      text,                            -- 앞 19자리
  floor    text,                            -- 원문 그대로
  floor_no smallint,                        -- 읽어낸 것. 못 읽으면 null
  is_base  boolean NOT NULL DEFAULT false,  -- 지하인 건 아는데 층을 모를 때
  ho       text,
  lng double precision, lat double precision,
  geom geometry(Point,4326));
"""
IDX = """
CREATE INDEX ON master.sbiz_store(pnu);
CREATE INDEX ON master.sbiz_store USING GIST(geom);
CREATE INDEX ON master.sbiz_store(cat2);
CREATE INDEX ON master.sbiz_store(pnu, floor_no);
"""

_DIG = re.compile(r"^(\d{1,2})$")
_BSMT = re.compile(r"^[Bb]0?(\d)$")


def floor_of(raw: str) -> tuple[int | None, bool]:
    """(층, 지하인가). 못 읽으면 (None, 지하로 읽혔는지)."""
    s = (raw or "").strip()
    if not s:
        return None, False
    if s in ("지", "반", "반지층", "지하"):
        return None, True
    if (m := _BSMT.match(s)):
        return -int(m.group(1)), True
    if (m := _DIG.match(s)):
        n = int(m.group(1))
        return (n, False) if n >= 1 else (None, False)
    return None, s[:1] in ("B", "b")


def num(s: str) -> float | None:
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def rows(path: str):
    with io.open(path, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            mgm = (r.get("건물관리번호") or "").strip()
            fl, base = floor_of(r.get("층정보"))
            lng, lat = num(r.get("경도")), num(r.get("위도"))
            yield (
                (r.get("상가업소번호") or "").strip(),
                (r.get("상호명") or "").strip() or None,
                (r.get("지점명") or "").strip() or None,
                r.get("상권업종대분류명") or None, r.get("상권업종중분류명") or None,
                r.get("상권업종소분류명") or None,
                r.get("상권업종대분류코드") or None, r.get("상권업종중분류코드") or None,
                r.get("상권업종소분류코드") or None,
                r.get("표준산업분류명") or None,
                r.get("시군구명") or None, r.get("법정동명") or None,
                (r.get("지번주소") or "").strip() or None,
                (r.get("도로명주소") or "").strip() or None,
                (r.get("건물명") or "").strip() or None,
                mgm or None,
                mgm[:19] if len(mgm) >= 19 and mgm[:19].isdigit() else None,
                (r.get("층정보") or "").strip() or None, fl, base,
                (r.get("호정보") or "").strip() or None,
                lng, lat)


COLS = ["store_id", "name", "branch", "cat1", "cat2", "cat3",
        "cat1_cd", "cat2_cd", "cat3_cd", "ksic", "sgg", "bjdong",
        "jibun", "road", "bldg_name", "bldg_mgm", "pnu",
        "floor", "floor_no", "is_base", "ho", "lng", "lat"]


async def main() -> int:
    files = sorted(glob.glob(os.path.join(SRC, "*.csv")))
    if not files:
        print(f"✗ {SRC} 에 CSV 가 없다 — 먼저 내려받는다"
              " (scripts/datagokr/download_datagokr.py --only 15083033)")
        return 2
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=7200)
    try:
        await c.execute(DDL)
        n = 0
        for p in files:
            print(f"  {os.path.basename(p)}", flush=True)
            # 같은 상가업소번호가 두 번 오는 판이 있다 — 뒤엣것을 버린다(먼저 온 것이 정본)
            seen, batch = set(), []
            for r in rows(p):
                if not r[0] or r[0] in seen:
                    continue
                seen.add(r[0])
                batch.append(r)
                if len(batch) >= 50_000:
                    await c.copy_records_to_table("sbiz_store", schema_name="master",
                                                  columns=COLS, records=batch)
                    n += len(batch)
                    batch = []
                    print(f"    {n:,}", flush=True)
            if batch:
                await c.copy_records_to_table("sbiz_store", schema_name="master",
                                              columns=COLS, records=batch)
                n += len(batch)
        # 좌표는 있는 것만 점으로 — 없는 줄을 (0,0) 으로 채우면 아프리카 앞바다에 가게가 선다
        await c.execute("""UPDATE master.sbiz_store
                              SET geom = ST_SetSRID(ST_MakePoint(lng, lat), 4326)
                            WHERE lng IS NOT NULL AND lat IS NOT NULL""")
        await c.execute(IDX)
        await c.execute("ANALYZE master.sbiz_store")
        s = await c.fetchrow("""SELECT count(*) t,
                 count(pnu) p, count(floor_no) f, count(*) FILTER (WHERE is_base) b,
                 count(geom) g, count(DISTINCT cat2) c2 FROM master.sbiz_store""")
        print(f"\n  master.sbiz_store {s['t']:,}줄")
        print(f"    PNU {s['p']:,} ({100*s['p']/s['t']:.1f}%) · "
              f"층 {s['f']:,} ({100*s['f']/s['t']:.1f}%) · 지하만 앎 {s['b']:,} · "
              f"좌표 {s['g']:,} ({100*s['g']/s['t']:.1f}%) · 중분류 {s['c2']}종")
        return 0
    finally:
        await c.close()


sys.exit(asyncio.run(main()))
