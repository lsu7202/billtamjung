#!/usr/bin/env python3
"""나라장터 공사 입찰공고를 `master.g2b_bid` 로 적재한다(2026-09-05).

## 왜 필요한가
정비구역·지구단위계획은 고시로 남는다. 그런데 **역 출입구 개선·보행환경 개선·문화재 보수는
도시관리계획을 다시 결정하지 않아 어떤 고시에도 안 남는다.** 공사 발주로만 잡힌다.

## 어려운 곳 — **자리를 모른다**
입찰공고에는 좌표도 지번도 없다. 있는 것은 공고명 한 줄뿐이다
(「종로5가 2-4번지 앞 단절관 연결공사」·「한글비석로 보행환경개선사업(조경)」).
그래서 **공고명에서 지명을 읽어 붙인다** — 읽히는 것만 붙이고 나머지는 자리를 비워 둔다.
동 단위로 억지로 붙이지 않는다. 「강남구 어딘가」는 주변 동향이 아니다.

    BT_DATABASE_URL=... backend/.venv/bin/python scripts/load_g2b.py
"""
import asyncio
import json
import os
import re
import sys
from datetime import date

import asyncpg

DSN = os.environ.get("BT_DATABASE_URL") or os.environ.get(
    "DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")
SRC = "data/raw/_g2b/bids_cnstwk.json"

DDL = """
DROP TABLE IF EXISTS master.g2b_bid;
CREATE TABLE master.g2b_bid(
  bid_no      text PRIMARY KEY,
  name        text NOT NULL,
  inst        text, demand_inst text,
  notice_on   date, opening_on date,
  price       numeric,
  method      text,
  url         text,
  official    text, phone text,
  -- 공고명에서 읽어낸 것. 못 읽으면 null — 지어내지 않는다
  road        text,          -- 도로명(「한글비석로」)
  station     text,          -- 역명(「종로3가역」)
  jibun       text,          -- 지번(「종로5가 2-4」)
  geom geometry(Point,4326));
CREATE INDEX ON master.g2b_bid USING GIST(geom);
CREATE INDEX ON master.g2b_bid(notice_on DESC NULLS LAST);
"""
COLS = ["bid_no", "name", "inst", "demand_inst", "notice_on", "opening_on",
        "price", "method", "url", "official", "phone", "road", "station", "jibun"]

_STN = re.compile(r"([가-힣0-9]{2,10}역)(?![사원])")
_JIB = re.compile(r"([가-힣]{2,6}동|[가-힣]{2,6}[0-9]가)\s*([0-9]+(?:-[0-9]+)?)번지")
_ROAD = re.compile(r"([가-힣0-9]{2,10}(?:대?로|길))(?:\s|[0-9]|$)")


def d(s):
    s = (s or "").strip()[:10].replace(".", "-").replace("/", "-")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return None
    try:
        return date(int(s[:4]), int(s[5:7]), int(s[8:10]))
    except ValueError:
        return None


def numv(s):
    try:
        return float(str(s).replace(",", ""))
    except (TypeError, ValueError):
        return None


async def main() -> int:
    if not os.path.exists(SRC):
        print(f"✗ {SRC} 가 없다 — scripts/g2b/fetch_bids.py 먼저")
        return 2
    rows, seen = [], set()
    for x in json.load(open(SRC, encoding="utf-8")):
        no = (x.get("bidNtceNo") or "").strip()
        nm = (x.get("bidNtceNm") or "").strip()
        if not no or not nm or no in seen:
            continue
        seen.add(no)
        st = _STN.search(nm)
        jb = _JIB.search(nm)
        rd = _ROAD.search(nm)
        rows.append((no, nm,
                     (x.get("ntceInsttNm") or "").strip() or None,
                     (x.get("dminsttNm") or "").strip() or None,
                     d(x.get("bidNtceDt")), d(x.get("opengDt")),
                     numv(x.get("presmptPrce")),
                     (x.get("cntrctCnclsMthdNm") or "").strip() or None,
                     (x.get("bidNtceDtlUrl") or "").strip() or None,
                     (x.get("ntceInsttOfclNm") or "").strip() or None,
                     (x.get("ntceInsttOfclTelNo") or "").strip() or None,
                     rd.group(1) if rd else None,
                     st.group(1) if st else None,
                     f"{jb.group(1)} {jb.group(2)}" if jb else None))
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=3600)
    try:
        await c.execute(DDL)
        await c.copy_records_to_table("g2b_bid", schema_name="master",
                                      columns=COLS, records=rows)
        # 자리 붙이기 ① 역명 → 지하철역 좌표
        # 같은 이름 역이 노선마다 여러 줄이라 하나로 줄여 쓴다(환승역은 좌표가 거의 같다)
        s1 = await c.execute("""
            UPDATE master.g2b_bid b
               SET geom = ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326)
              FROM (SELECT name, avg(lng) lng, avg(lat) lat
                      FROM master.subway_stations
                     WHERE lng IS NOT NULL GROUP BY name) s
             WHERE b.station IS NOT NULL AND b.geom IS NULL
               AND s.name = regexp_replace(b.station, '역$', '')""")
        # 자리 붙이기 ② 도로명 → 도로구간 가운데점. 역보다 넓게 잡히지만
        #    「한글비석로 보행환경개선」은 그 길 어딘가가 맞다. 길이 여러 조각이면 이어 붙인 가운데
        s2 = await c.execute("""
            UPDATE master.g2b_bid b
               SET geom = r.pt
              FROM (SELECT rn, ST_Centroid(ST_Collect(geom)) pt
                      FROM master.road_segment WHERE rn IS NOT NULL GROUP BY rn) r
             WHERE b.road IS NOT NULL AND b.geom IS NULL AND r.rn = b.road""")
        await c.execute("ANALYZE master.g2b_bid")
        n = await c.fetchrow("""SELECT count(*) t, count(station) st, count(jibun) jb,
                                       count(road) rd, count(geom) g, count(price) p
                                  FROM master.g2b_bid""")
        print(f"  master.g2b_bid {n['t']:,}줄 · 추정가 {n['p']:,}")
        print(f"    공고명에서 읽은 것 — 역 {n['st']:,} · 지번 {n['jb']:,} · 도로 {n['rd']:,}")
        print(f"    자리 붙은 것 {n['g']:,} ({100*n['g']/max(n['t'],1):.1f}%)"
              f" — 역 {s1.split()[-1]} · 도로 {s2.split()[-1]}")
        return 0
    finally:
        await c.close()


sys.exit(asyncio.run(main()))
