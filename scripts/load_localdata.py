#!/usr/bin/env python3
"""LOCALDATA(지방행정인허가) 서울 208업종을 `master.localdata_permit` 로 적재한다(2026-09-05).

## 왜 넣나
① **층** — 소상공인의 층정보(66%)보다 촘촘하다. 여기선 층이 **주소 글에 박혀 있다**
   (「종로31길 46-3, 1층」). 그래서 정규식으로 뽑는다.
② **소재지면적** — 소상공인엔 아예 없는 칸. 층별 임대정보의 계약면적 재료다.
③ **인허가일자·폐업일자** — 「이 건물에 최근 몇 곳이 들어오고 나갔나」. 상권이 뜨는지 지는지가 여기서 나온다.
   그래서 **폐업한 줄도 다 넣는다** — 지우면 시계열이 아니라 스냅숏이 된다.

## 파일 208개, 머리 모양은 110종
업종마다 칸이 다르다(객실수·선박총톤수·무대면적…). **공통 뼈대만 칸으로 만들고 나머지는 안 옮긴다** —
쓰지도 않을 칸 200개를 만들면 표가 아니라 창고가 된다. 업종은 파일 이름의 slug 로 남긴다.

## 좌표
`좌표정보(X)/(Y)` 는 **EPSG:5174**(V-World·연속지적도와 같은 것)라 변환 코드가 이미 있다.

    BT_DATABASE_URL=... backend/.venv/bin/python scripts/load_localdata.py
"""
import asyncio
import csv
import glob
import io
import os
import re
import sys
from datetime import date

import asyncpg
from pyproj import Transformer

DSN = os.environ.get("BT_DATABASE_URL") or os.environ.get(
    "DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")
SRC = "data/raw/_localdata"
T = Transformer.from_crs(5174, 4326, always_xy=True)

DDL = """
DROP TABLE IF EXISTS master.localdata_permit;
CREATE TABLE master.localdata_permit(
  id        bigserial PRIMARY KEY,
  kind      text NOT NULL,        -- 업종(파일 slug). 예: general_restaurants
  mgm_no    text,                 -- 관리번호
  org_cd    text,                 -- 개방자치단체코드
  name      text,                 -- 사업장명
  biz1      text, biz2 text,      -- 업태구분명 · 위생업태명
  status    text,                 -- 원문(상세영업상태명 ?? 영업상태명)
  state     text NOT NULL,        -- 읽어낸 것: 영업 · 폐업 · 휴업 · 미상
  open_on   date, close_on date,  -- 인허가일자 · 폐업일자
  area      numeric,              -- 소재지면적(㎡)
  jibun     text, road text,      -- 주소 원문
  floor_no  smallint,             -- 주소에서 읽어낸 층. 못 읽으면 null
  is_base   boolean NOT NULL DEFAULT false,
  phone     text,
  x5174 double precision, y5174 double precision,
  lng double precision, lat double precision,
  geom geometry(Point,4326));
"""
IDX = """
CREATE INDEX ON master.localdata_permit USING GIST(geom);
CREATE INDEX ON master.localdata_permit(kind);
CREATE INDEX ON master.localdata_permit(state);
CREATE INDEX ON master.localdata_permit(close_on) WHERE close_on IS NOT NULL;
"""

# 「지하 1층」·「B1」·「1층」. **「지상 3층」 같은 건물 제원 문구는 안 잡는다** —
# 그건 그 업소가 있는 층이 아니라 건물 층수다.
_FL = re.compile(r"(?:^|[,\s(])(지하\s*(\d{1,2})|[Bb](\d{1,2})|(\d{1,2}))\s*층")


def floor_of(*addrs: str) -> tuple[int | None, bool]:
    for a in addrs:
        if not a:
            continue
        m = _FL.search(a)
        if not m:
            continue
        if m.group(2):
            return -int(m.group(2)), True
        if m.group(3):
            return -int(m.group(3)), True
        n = int(m.group(4))
        return (n, False) if 1 <= n <= 99 else (None, False)
    return None, False


# 영업상태 낱말이 **28종**이다(폐업·폐업처리·직권말소·타시군구이관·전출·말소·폐쇄…).
# 낱말을 다 외우는 대신 **폐업일자가 있으면 폐업**을 먼저 본다 — 그건 낱말이 아니라 사실이다.
_DEAD = re.compile(r"폐업|말소|취소|폐쇄|폐지|전출|이관|사용중지|제외")
_LIVE = re.compile(r"영업|정상|사용중|신규|지정|등록")


def state_of(status: str, close_on) -> str:
    s = (status or "").strip()
    if "휴업" in s:
        return "휴업"
    if close_on or _DEAD.search(s):
        return "폐업"
    if _LIVE.search(s):
        return "영업"
    return "미상"


def date_of(s: str) -> date | None:
    """COPY 는 문자열이 아니라 date 를 받는다. 못 읽는 날짜는 **버린다**(0000-00-00 이 섞여 온다)."""
    s = (s or "").strip()[:10]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return None
    try:
        return date(int(s[:4]), int(s[5:7]), int(s[8:10]))
    except ValueError:
        return None


def numv(s: str):
    s = (s or "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def rows(path: str, kind: str):
    with io.open(path, encoding="cp949", newline="", errors="replace") as f:
        for r in csv.DictReader(f):
            jib = (r.get("지번주소") or "").strip()
            rd = (r.get("도로명주소") or "").strip()
            fl, base = floor_of(jib, rd)
            # 칸 이름이 업종마다 다르다 — 상세가 없는 판은 영업상태명만 온다(210,357줄이 그랬다)
            st = ((r.get("상세영업상태명") or "").strip()
                  or (r.get("영업상태명") or "").strip() or None)
            close = date_of(r.get("폐업일자"))
            x, y = numv(r.get("좌표정보(X)")), numv(r.get("좌표정보(Y)"))
            lng = lat = None
            if x and y:
                lng, lat = T.transform(x, y)
                # 서울 밖으로 튄 좌표는 안 쓴다 — 변환이 어긋난 줄이 섞여 온다
                if not (126.6 < lng < 127.3 and 37.3 < lat < 37.75):
                    lng = lat = None
            yield (kind,
                   (r.get("관리번호") or "").strip() or None,
                   (r.get("개방자치단체코드") or "").strip() or None,
                   (r.get("사업장명") or "").strip() or None,
                   (r.get("업태구분명") or "").strip() or None,
                   (r.get("위생업태명") or "").strip() or None,
                   st, state_of(st, close),
                   date_of(r.get("인허가일자")), close,
                   numv(r.get("소재지면적")),
                   jib or None, rd or None, fl, base,
                   (r.get("전화번호") or "").strip() or None,
                   x, y, lng, lat)


COLS = ["kind", "mgm_no", "org_cd", "name", "biz1", "biz2", "status", "state",
        "open_on", "close_on", "area", "jibun", "road", "floor_no", "is_base",
        "phone", "x5174", "y5174", "lng", "lat"]


async def main() -> int:
    files = sorted(glob.glob(os.path.join(SRC, "*.csv")))
    if not files:
        print(f"✗ {SRC} 에 CSV 가 없다 — scripts/localdata/download_localdata.py 먼저")
        return 2
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=14400)
    try:
        await c.execute(DDL)
        n = skipped = 0
        for i, p in enumerate(files, 1):
            kind = os.path.basename(p).removeprefix("localdata_").rsplit("_", 1)[0]
            batch = []
            try:
                for r in rows(p, kind):
                    batch.append(r)
                    if len(batch) >= 50_000:
                        await c.copy_records_to_table(
                            "localdata_permit", schema_name="master", columns=COLS, records=batch)
                        n += len(batch)
                        batch = []
            except Exception as e:                            # noqa: BLE001
                print(f"  [{i}/{len(files)}] {kind}: ✗ {type(e).__name__} {e}", flush=True)
                skipped += 1
                continue
            if batch:
                await c.copy_records_to_table(
                    "localdata_permit", schema_name="master", columns=COLS, records=batch)
                n += len(batch)
            if i % 20 == 0:
                print(f"    {i}/{len(files)}개 파일 · {n:,}줄", flush=True)
        await c.execute("""UPDATE master.localdata_permit
                              SET geom = ST_SetSRID(ST_MakePoint(lng, lat), 4326)
                            WHERE lng IS NOT NULL""")
        await c.execute(IDX)
        await c.execute("ANALYZE master.localdata_permit")
        s = await c.fetchrow("""SELECT count(*) t, count(DISTINCT kind) k,
            count(*) FILTER (WHERE state='영업') live,
            count(*) FILTER (WHERE state='폐업') dead,
            count(*) FILTER (WHERE state='미상') unk FROM master.localdata_permit""")
        f2 = await c.fetchrow("""SELECT count(*) n, count(floor_no) f, count(area) a, count(geom) g
                                   FROM master.localdata_permit WHERE state='영업'""")
        lv = max(f2["n"], 1)
        print(f"\n  master.localdata_permit {s['t']:,}줄 · 업종 {s['k']}종 · 못 읽은 파일 {skipped}")
        print(f"    영업 {s['live']:,} · 폐업 {s['dead']:,} · 미상 {s['unk']:,}")
        print(f"    영업 {lv:,} 중 — 층 {f2['f']:,} ({100*f2['f']/lv:.1f}%) · "
              f"면적 {f2['a']:,} ({100*f2['a']/lv:.1f}%) · 좌표 {f2['g']:,} ({100*f2['g']/lv:.1f}%)")
        return 0
    finally:
        await c.close()


sys.exit(asyncio.run(main()))
