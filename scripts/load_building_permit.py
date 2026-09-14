#!/usr/bin/env python3
r"""건축HUB 「인허가」 계열을 `master.building_permit` 로 적재한다(2026-09-05).

주변 동향의 **건축 인허가** 갈래다. 「옆 땅에 신축이 들어온다」·「저 건물이 없어진다」가
중개인이 가장 먼저 알고 싶어 하는 것인데, 정비구역 고시에는 안 나온다.

## 갈래 셋 중 자리 잡기가 제일 쉽다
대지위치가 **PNU 로 붙어 온다**(시군구5 + 법정동5 + 대지구분1 + 번4 + 지4 = 19자리).
좌표를 파싱하거나 이름을 맞댈 필요가 없다.

**함정: 대지구분코드 인코딩이 다르다.** 건축HUB 는 `0`(대지)·`1`(산)인데
PNU 표준은 `1`(일반)·`2`(산)이다. **1 을 더해야 붙는다** — 안 그러면
71.6만 줄 중 467 줄만 필지에 붙는다(실측). 더하면 90% 가 붙는다.

## 무엇을 넣나
    인허가/기본개요  551,955행 — 신축·증축·용도변경. 건축허가일·착공일·사용승인일
    인허가/철거멸실  129,674행 — 철거시작일·철거종료일. **철거멸실일은 3,665건뿐**이라
                                 종료일로 갈음한다
    인허가/대수선     36,226행 — **날짜 칸이 아예 없다**(생성일자뿐). 주변 동향엔 안 올린다

## 날짜에 쓰레기가 섞여 있다
`2995-01-02` · `3019-03-22` · `5014-08-14` 같은 값이 원천에 그대로 있다.
**1900년 ~ 올해+5년 밖은 버린다** — 화면에 3019년 준공이 서면 그 화면은 그날로 못 믿는다.

    BT_DATABASE_URL=... backend/.venv/bin/python scripts/load_building_permit.py
"""
import asyncio
import csv
import glob
import io
import os
import re
import shutil
import subprocess
import sys
from datetime import date

import asyncpg

DSN = os.environ.get("BT_DATABASE_URL") or os.environ.get(
    "DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")
SRC = "data/raw/hub_seoul"

DDL = """
DROP TABLE IF EXISTS master.building_permit;
CREATE TABLE master.building_permit(
  id        bigserial PRIMARY KEY,
  kind      text NOT NULL,        -- 인허가 · 철거멸실 · 대수선
  act       text,                 -- 건축구분명(신축·증축·용도변경) · 철거멸실구분
  pnu       text,                 -- 19자리
  addr      text,                 -- 대지위치 원문
  bldg_name text,
  use_name  text,                 -- 주용도명
  land_area double precision, bldg_area double precision, total_area double precision,
  bcr double precision, far double precision,
  households integer,
  permit_on date,                 -- 건축허가일
  start_on  date,                 -- 실제착공일
  done_on   date,                 -- 사용승인일
  demo_on   date);                -- 철거멸실일
CREATE INDEX ON master.building_permit(pnu);
CREATE INDEX ON master.building_permit(kind);
CREATE INDEX ON master.building_permit(permit_on DESC NULLS LAST);
CREATE INDEX ON master.building_permit(demo_on DESC NULLS LAST);
"""
COLS = ["kind", "act", "pnu", "addr", "bldg_name", "use_name",
        "land_area", "bldg_area", "total_area", "bcr", "far", "households",
        "permit_on", "start_on", "done_on", "demo_on"]


_Y0, _Y1 = 1900, date.today().year + 5


def d(s):
    s = re.sub(r"\D", "", (s or ""))[:8]
    if len(s) != 8:
        return None
    try:
        v = date(int(s[:4]), int(s[4:6]), int(s[6:8]))
    except ValueError:
        return None
    return v if _Y0 <= v.year <= _Y1 else None      # 3019년 준공은 날짜가 아니다


def f(s):
    try:
        return float((s or "").strip())
    except ValueError:
        return None


def i(s):
    try:
        return int(float((s or "").strip()))
    except ValueError:
        return None


def pnu_of(r):
    """시군구5 + 법정동5 + 대지구분1 + 번4 + 지4. 하나라도 모양이 틀리면 **None**."""
    sgg = (r.get("시군구코드") or "").strip()
    bjd = (r.get("법정동코드") or "").strip()
    gu = (r.get("대지구분코드") or "").strip()
    bon = (r.get("번") or "").strip()
    bu = (r.get("지") or "").strip()
    if not (len(sgg) == 5 and len(bjd) == 5 and gu and bon and bu):
        return None
    if not gu.isdigit():
        return None
    p = f"{sgg}{bjd}{int(gu) + 1}{bon.zfill(4)}{bu.zfill(4)}"   # 0→1 · 1→2
    return p if len(p) == 19 and p.isdigit() else None


def rows(kind: str, folder: str):
    for path in sorted(glob.glob(os.path.join(SRC, folder, "*.csv"))):
        with io.open(path, encoding="utf-8-sig", newline="", errors="replace") as fh:
            for r in csv.DictReader(fh):
                p = pnu_of(r)
                if kind == "철거멸실":
                    yield (kind, (r.get("철거멸실구분코드명") or "").strip() or None, p,
                           (r.get("대지위치") or "").strip() or None,
                           (r.get("건물명") or "").strip() or None,
                           (r.get("주용도코드명") or "").strip() or None,
                           None, None, f(r.get("연면적(㎡)")), None, None,
                           i(r.get("세대수(세대)")),
                           None, d(r.get("철거시작일")), d(r.get("철거종료일")),
                           # 철거멸실일은 3,665건뿐이다 — 없으면 종료일을 쓴다
                           d(r.get("철거멸실일")) or d(r.get("철거종료일")))
                else:
                    yield (kind, (r.get("건축구분명") or "").strip() or None, p,
                           (r.get("대지위치") or "").strip() or None,
                           (r.get("건물명") or "").strip() or None,
                           (r.get("주용도명") or "").strip() or None,
                           f(r.get("대지면적")), f(r.get("건축면적")), f(r.get("연면적")),
                           f(r.get("건폐율")), f(r.get("용적률")), i(r.get("세대수")),
                           d(r.get("건축허가일")), d(r.get("실제착공일")),
                           d(r.get("사용승인일")), None)


ARCH = "data/raw/_archive/hub_seoul"


def unfold(folder: str) -> bool:
    """압축본에서 편다. 파이프라인 끝의 archive_seoul 이 원본을 치우기 때문에,
    두 번째 실행부터는 여기서 꺼내 써야 한다. 쓰고 나서 도로 치운다."""
    if glob.glob(os.path.join(SRC, folder, "*.csv")):
        return False                                   # 이미 펴져 있다 — 건드리지 않는다
    tar = os.path.join(ARCH, f"{folder}.tar.zst")
    if not os.path.exists(tar):
        return False
    subprocess.run(
        f'cd "{SRC}" && tar --use-compress-program="zstd -d" -xf "{os.path.abspath(tar)}"',
        shell=True, capture_output=True, text=True)
    return True


async def main() -> int:
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=7200)
    try:
        await c.execute(DDL)
        n = 0
        for kind, folder in (("인허가", "인허가_기본개요"),
                             ("철거멸실", "인허가_철거멸실"),
                             ("대수선", "인허가_대수선")):
            tmp = unfold(folder)
            if not glob.glob(os.path.join(SRC, folder, "*.csv")):
                print(f"  [{kind}] 파일 없음 — 건너뜀", flush=True)
                continue
            batch = []
            for r in rows(kind, folder):
                batch.append(r)
                if len(batch) >= 50_000:
                    await c.copy_records_to_table("building_permit", schema_name="master",
                                                  columns=COLS, records=batch)
                    n += len(batch)
                    batch = []
            if batch:
                await c.copy_records_to_table("building_permit", schema_name="master",
                                              columns=COLS, records=batch)
                n += len(batch)
            print(f"  [{kind}] 누적 {n:,}", flush=True)
            if tmp:                                    # 우리가 편 것만 도로 치운다
                shutil.rmtree(os.path.join(SRC, folder), ignore_errors=True)
        await c.execute("ANALYZE master.building_permit")
        s = await c.fetchrow("""SELECT count(*) t, count(pnu) p,
            count(*) FILTER (WHERE permit_on >= now()-interval '3 years') AS h3,
            count(*) FILTER (WHERE demo_on   >= now()-interval '3 years') AS d3,
            max(permit_on) mx
            FROM master.building_permit""")
        j = await c.fetchval("""SELECT count(*) FROM master.building_permit b
             WHERE b.pnu IS NOT NULL
               AND EXISTS (SELECT 1 FROM master.parcels v WHERE v.pnu = b.pnu)""")
        print(f"\n  master.building_permit {s['t']:,}줄 · PNU {s['p']:,} ({100*s['p']/max(s['t'],1):.1f}%)")
        print(f"    필지에 붙는 것 {j:,} · 최근 3년 허가 {s['h3']:,} · 철거 {s['d3']:,}"
              f" · 가장 늦은 허가일 {s['mx']}")
        return 0
    finally:
        await c.close()


sys.exit(asyncio.run(main()))
