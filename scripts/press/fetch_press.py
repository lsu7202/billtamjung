#!/usr/bin/env python3
"""서울시 보도자료에서 **사실만 뽑아** `master.press_event` 로 넣는다(2026-09-05).

## 왜 이게 필요한가
정비구역·지구단위계획은 고시로 남고, 공사는 나라장터로 남는다. 그런데 그 **사이에 1~2년의
빈 구간**이 있다 — 정책이 발표되고 설계에 들어가는 동안은 어디에도 안 남는다.
「종로5가역 7·8번 출입구 개선」이 그랬다: 고시 43,986건에도, 나라장터 3년치에도 없고,
보도자료에만 있었다. 하필 중개인이 알고 싶어 하는 시점이 거기다.

## 라이선스 — **본문을 저장하지 않는다**(2026-09-05 대표 확정)
보도자료는 공공누리 **제4유형**(출처표시 + 상업적 이용금지 + 변경금지)이다. 빌탐정은 유료라
상업적 이용이다. 저작권은 표현을 보호하지 **사실을 보호하지 않으므로**, 사실만 옮긴다.

    넣는다   **제목(그대로)** · 위치(역·도로·지번) · 규모(면적·세대·층수) · 발표일 · 담당부서 · 원문 URL
    안 넣는다 본문 문장 · 부제(긴 설명문)
    이름 = 원문 제목이다(2026-09-06 대표). 처음엔 「종로5가역 일대 · 디자인경관」처럼 우리가 지었는데,
    그러면 그 글이 창동역·낙산도 말한다는 것이 이름에서 사라진다. **제호는 저작물이 아니다**(대법원 판례 일관) —
    공공누리 4유형이 막는 것은 본문이지 제목이 아니다. 제목이 없을 때만 지은 이름으로 부른다.

본문은 파싱할 때만 메모리에 두고 버린다. `body` 칸은 만들지 않는다.

## **자리를 몰라도 담는다**(2026-09-06)
예전엔 본문에서 지명을 못 찾으면 그 글을 통째로 버렸다. 그러면 「없는 것」과 「모르는 것」이
같아진다 — 실제로 개발·시설 보도자료의 78%가 그렇게 사라졌다.
이제 **다 담고 `geom` 만 비운다.** 주변 동향(반경)에는 자리를 아는 것만 서고,
공시·뉴스 목록에는 전부 선다. 자리는 나중에 더 캐면 채워진다.

## **자리마다 한 줄이다** — 글 하나에 한 줄이 아니다
「강북 디자인경관 프로젝트」 한 글이 종로5가역·창동역·4·19로·낙산 **넷**을 말한다.
글 하나에 한 줄만 세우면 가나다순 첫 자리만 남고 셋이 통째로 사라진다 —
창동역 옆 건물을 보는 중개인에겐 이 소식이 아예 안 보인다(2026-09-06 지적).
반경으로 만나는 화면이라 **자리가 곧 그 줄의 존재 이유다.**

## 해시태그 — 한 줄이 못 싣는 나머지를 싣는다(2026-09-06 대표 지시)
자리마다 한 줄을 세워도 **한 줄엔 자리 하나**만 보인다. 「강북 디자인경관」 글의 창동역 줄을 보는
사람은 그 글이 종로5가·낙산·4·19로도 말한다는 것을 모른다. 그래서 글에서 **낱말을 더 뽑아**
`tags` 로 단다 — 주제(신속통합기획·모아타운·재건축…) · 자치구 · 법정동 · 역 · 도로.
같은 글의 줄은 같은 태그를 갖는다. 화면은 `#창동 #종로5가역 #디자인경관` 로 보이고 누르면 그 태그로 거른다.
낱말은 사실이지 표현이 아니다 — 본문 문장은 여전히 안 남긴다.
    --retag : 이미 넣은 글의 본문을 다시 읽어 태그만 갈아 끼운다(줄은 안 늘린다)

## 자리는 **우리 DB에 실재하는 것만** 인정한다
제목에서 뽑으면 「9월부터 전 한강공원**으로**」가 도로명이 된다. 뽑은 이름을
`master.subway_stations`·`master.road_segment` 와 맞대 **있는 것만** 쓴다.
실측(2026-08~09 한 달): 보도자료 295건 → 개발·시설 49건(17%) → 자리 잡힌 것 11건(22%).

## 함정
HWP 에서 변환된 본문이라 **글자 사이에 공백이 있다**(「종로 5 가역 7·8 번」).
붙여서 봐야 하는데, 그러면 앞말과도 붙는다(「첨부파일사당동」) — 경계를 따로 본다.

    BT_DATABASE_URL=... backend/.venv/bin/python scripts/press/fetch_press.py --pages 3
    BT_DATABASE_URL=... backend/.venv/bin/python scripts/press/fetch_press.py --backfill 1400
"""
import argparse
import asyncio
import html
import os
import re
import sys
import time
from datetime import date
import urllib.request

import asyncpg

DSN = os.environ.get("BT_DATABASE_URL") or os.environ.get(
    "DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
LIST = "https://www.seoul.go.kr/news/news_report.do?curPage={p}&bbsNo=158"
VIEW = "https://www.seoul.go.kr/news/news_report.do?bbsNo=158&nttNo={n}"

DDL = """
CREATE TABLE IF NOT EXISTS master.press_event(
  id        bigserial PRIMARY KEY,
  ntt_no    bigint NOT NULL,          -- 서울시 게시글 번호(한 글에 여러 줄이 날 수 있다)
  on_date   date NOT NULL,            -- 발표일
  dept      text,                     -- 담당부서
  name      text NOT NULL,            -- 화면 이름 = 원문 제목(title). 제목이 없을 때만 지은 이름
  title     text,                     -- 원문 제목 그대로(제호는 저작물이 아니다 · 2026-09-06)
  topic     text,                     -- 신속통합기획 · 모아타운 · 디자인경관 …
  station   text, road text, jibun text,
  scale     text,                     -- 「130㎡」·「970세대」·「최고 34층」
  url       text NOT NULL,            -- 원문
  tags      text[],                    -- 해시태그(주제·구·동·역·도로). 같은 글의 줄은 같다
  geom geometry(Point,4326));
ALTER TABLE master.press_event ADD COLUMN IF NOT EXISTS tags text[];
ALTER TABLE master.press_event ADD COLUMN IF NOT EXISTS title text;
CREATE INDEX IF NOT EXISTS press_event_tags_idx ON master.press_event USING GIN(tags);
CREATE INDEX IF NOT EXISTS press_event_geom_idx ON master.press_event USING GIST(geom);
CREATE INDEX IF NOT EXISTS press_event_date_idx ON master.press_event(on_date DESC);
-- 한 글이 여러 자리를 말하면 자리마다 한 줄이다 — 같은 자리를 두 번 넣지만 않으면 된다
CREATE UNIQUE INDEX IF NOT EXISTS press_event_uk
  ON master.press_event(ntt_no, coalesce(jibun,''), coalesce(station,''), coalesce(road,''));
"""

ROW = re.compile(r"fnTbbsView\('(\d+)'\)[^>]*>\s*([^<]{5,160}?)\s*</a>(.{0,500}?)(20\d\d-\d\d-\d\d)", re.S)
# 이 낱말이 제목에 없으면 부동산과 상관없는 글이다(문화 행사·복지·시장 동정이 대부분이다)
TOPIC = re.compile("신속통합기획|신통기획|모아타운|모아주택|재개발|재건축|정비구역|지구단위|"
                   "역세권|장기전세|복합개발|리모델링|디자인경관|보행환경|공원|광장|"
                   "착공|준공|개통|신설|증축|이전|조성|개선")
# 이 중 앞의 것이 이름에 쓰인다 — 굵은 것부터
TOPICS = ["신속통합기획", "신통기획", "모아타운", "모아주택", "장기전세", "디자인경관",
          "역세권", "지구단위", "재개발", "재건축", "정비구역", "복합개발", "리모델링",
          "보행환경", "개통", "준공", "착공", "조성", "개선"]
STN = re.compile(r"([가-힣0-9]{2,8})역")
ROAD = re.compile(r"([가-힣0-9]{2,9}(?:대로|로|길))")
# 「사당동 305-35」. 앞이 한글이면 앞말과 붙은 것이라 두 글자만 잘라 본다
JIBUN = re.compile(r"([가-힣]{2,4}동)(\d{1,4}(?:-\d{1,4})?)(?!\d)")
SCALE = re.compile(r"(약?\s?[\d,]+(?:\.\d+)?\s?(?:㎡|만㎡|세대|가구|층|m|km))")
GU = ["종로구", "중구", "용산구", "성동구", "광진구", "동대문구", "중랑구", "성북구", "강북구", "도봉구",
      "노원구", "은평구", "서대문구", "마포구", "양천구", "강서구", "구로구", "금천구", "영등포구", "동작구",
      "관악구", "서초구", "강남구", "송파구", "강동구"]
# 태그로 쓰는 주제 — 이름 짓는 TOPICS 에서 동사꼴(조성·개선)은 빼고, 별칭은 하나로 접는다
TAG_TOPICS = ["신속통합기획", "모아타운", "모아주택", "장기전세", "디자인경관", "역세권", "지구단위",
              "재개발", "재건축", "정비구역", "복합개발", "리모델링", "보행환경", "공원", "광장",
              "착공", "준공", "개통"]
TAG_ALIAS = {"신통기획": "신속통합기획"}


def tags_of(title: str, body: str, stns: set, roads: set, dongs: set) -> list[str]:
    """글 하나의 해시태그. 주제 → 구 → 동 → 역 → 도로 차례, 스물넷까지.
    body 는 공백을 다 뺀 본문이다(HWP 변환 글은 글자 사이가 벌어져 있다).
    구·동은 **우리 DB 에 있는 이름만**(region_index 464 동) — 두 글자 동(화동·재동)은
    다른 낱말 안에 잘 숨으므로 세 글자부터만 본다."""
    head = title + body[:8000]
    out: list[str] = []
    for t in TAG_TOPICS:
        if t in head or any(a in head for a, v in TAG_ALIAS.items() if v == t):
            out.append(t)
    out += [g for g in GU if g in head]
    out += sorted(d for d in dongs if len(d) >= 3 and d in head)
    out += [f"{x}역" for x in sorted(m for m in STN.findall(head) if m in stns)]
    out += sorted(m for m in ROAD.findall(head) if m in roads)
    seen: set[str] = set()
    return [t for t in out if not (t in seen or seen.add(t))][:24]


def get(url: str, tries: int = 3) -> str:
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            return urllib.request.urlopen(req, timeout=90).read().decode("utf-8", "replace")
        except Exception:                                     # noqa: BLE001, PERF203
            time.sleep(1 + i)
    return ""


def listing(page: int):
    for m in ROW.finditer(get(LIST.format(p=page))):
        d = m.group(4)                       # COPY·bind 는 문자열이 아니라 date 를 받는다
        yield int(m.group(1)), html.unescape(m.group(2)), date(int(d[:4]), int(d[5:7]), int(d[8:10]))


def body_of(ntt: int) -> tuple[str, str | None, str | None]:
    """(붙인 본문, 담당부서, 제목). 본문은 **돌려주고 나면 호출부가 버린다 — 저장하지 않는다.** 제목은 남긴다."""
    h = get(VIEW.format(n=ntt))
    # 게시글 본문 칸(`id="viewTable"`)만 본다. 페이지 통째로 보면 바닥글의 「중구 세종대로 110」이
    # 모든 글에 #중구 를 달고, 머리글의 메뉴 이름이 주제로 잡힌다(2026-09-06 실측).
    i = h.find('id="viewTable"')
    if i > 0:
        j = h.find("<!--//", i)
        h = h[i:j] if j > 0 else h[i:]
    b = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", h, flags=re.S)
    b = html.unescape(re.sub(r"<[^>]+>", " ", b))
    dept = None
    m = re.search(r"담당부서\s+([가-힣·\s]{2,30}?)\s+문의", b)
    if m:
        dept = re.sub(r"\s+", " ", m.group(1)).strip()
    t = re.search(r"<h3[^>]*>(.*?)</h3>", h, re.S)
    title = html.unescape(re.sub(r"<[^>]+>", "", t.group(1))).strip() if t else None
    title = re.sub(r"\s+", " ", title) if title else None
    return re.sub(r"\s+", "", b), dept, title


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, default=3, help="최신 몇 쪽을 볼지")
    ap.add_argument("--backfill", type=int, default=0, help="1쪽부터 N쪽까지 (0=안 함)")
    ap.add_argument("--retag", action="store_true", help="아는 글의 본문을 다시 읽어 태그만 갈아 끼운다")
    a = ap.parse_args()
    last = a.backfill or a.pages

    c = await asyncpg.connect(DSN, timeout=60, command_timeout=3600)
    try:
        await c.execute(DDL)
        seen = {r["ntt_no"] for r in await c.fetch("SELECT ntt_no FROM master.press_event")}
        stns = {r["name"] for r in await c.fetch(
            "SELECT DISTINCT name FROM master.subway_stations WHERE name IS NOT NULL")}
        roads = {r["rn"] for r in await c.fetch(
            "SELECT DISTINCT rn FROM master.road_segment WHERE rn IS NOT NULL")}
        dongs = {r["dong"] for r in await c.fetch("SELECT DISTINCT dong FROM master.region_index")}
        print(f"  이미 있는 것 {len(seen):,} · 역 {len(stns):,} · 도로 {len(roads):,} · 동 {len(dongs):,}", flush=True)

        if a.retag:
            todo = await c.fetch("""SELECT ntt_no, min(name) AS name FROM master.press_event
                                     WHERE tags IS NULL OR title IS NULL GROUP BY ntt_no ORDER BY ntt_no DESC""")
            print(f"  태그나 제목이 없는 글 {len(todo):,} — 본문을 다시 읽는다", flush=True)
            for i, r in enumerate(todo, 1):
                body, _, title = body_of(r["ntt_no"])
                if not body:
                    continue
                tg = tags_of(title or "", body, stns, roads, dongs)
                # 이름은 원문 제목으로 — 없으면 지은 이름을 그대로 둔다
                await c.execute("""UPDATE master.press_event
                                      SET tags = $1, title = COALESCE($3, title), name = COALESCE($3, name)
                                    WHERE ntt_no = $2""", tg, r["ntt_no"], title)
                if i % 100 == 0:
                    print(f"    {i}/{len(todo)} · {r['name']} → {' '.join('#' + t for t in tg[:6])}", flush=True)
                time.sleep(0.05)
            t = await c.fetchrow("SELECT count(*) n, count(tags) t, avg(cardinality(tags)) a FROM master.press_event")
            print(f"  master.press_event {t['n']:,}줄 · 태그 있는 줄 {t['t']:,} · 평균 {float(t['a'] or 0):.1f}개")
            return 0

        n_all = n_topic = n_put = n_nogeo = 0
        for p in range(1, last + 1):
            rows = list(listing(p))
            if not rows:
                break
            # **증분**: 최신 쪽부터 보다가 아는 글만 나오는 쪽에 닿으면 멈춘다
            if not a.backfill and all(no in seen for no, _, _ in rows):
                print(f"    {p}쪽이 전부 아는 글 — 멈춘다", flush=True)
                break
            for no, title, dt in rows:
                n_all += 1
                if no in seen or not TOPIC.search(title):
                    continue
                n_topic += 1
                body, dept, _ = body_of(no)
                s = {m for m in STN.findall(body) if m in stns}
                r = {m for m in ROAD.findall(body) if m in roads}
                j2 = {(d, b) for d, b in JIBUN.findall(body)
                      # 앞말과 붙은 것을 거른다 — 동 이름은 두세 글자다
                      if 2 <= len(d) <= 4}
                j = {f"{d} {b}" for d, b in j2}
                topic = next((t for t in TOPICS if t in title or t in body[:3000]), None)
                sc = SCALE.search(body[:6000])
                scale = sc.group(1) if sc else None
                tg = tags_of(title, body, stns, roads, dongs)
                # **자리마다 한 줄.** 지번 → 역 → 도로 차례로 다 세운다.
                # 같은 자리를 지번과 역이 함께 가리키는 일은 드물고, 겹쳐도 유일색인이 막는다.
                spots = ([(f"{d} {b}", None, None, f"{d} {b}") for d, b in sorted(j2)] +
                         [(f"{x}역", x, None, None) for x in sorted(s)] +
                         [(x, None, x, None) for x in sorted(r)])
                # 자리를 못 찾았으면 **한 줄은 담는다** — 이름은 원문에서 못 짓고 주제만 남는다.
                # 공시·뉴스 목록에는 서고, 반경으로 만나는 주변 동향에는 안 선다(geom 이 없다).
                if not spots:
                    spots = [(None, None, None, None)]
                for where, stn, road, jib in spots:
                    # 이름은 **원문 제목**이다(2026-09-06). 제목이 비면 자리·주제로 짓는다.
                    made = (f"{where} 일대" + (f" · {topic}" if topic else "")) if where \
                        else (topic or dept or "서울시 발표")
                    name = re.sub(r"\s+", " ", title).strip() or made
                    await c.execute("""
                        INSERT INTO master.press_event
                          (ntt_no, on_date, dept, name, topic, station, road, jibun, scale, url, tags, title, geom)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
                          (SELECT ST_SetSRID(ST_MakePoint(avg(lng),avg(lat)),4326)
                             FROM master.subway_stations WHERE name = $6))
                        ON CONFLICT DO NOTHING""",
                        no, dt, dept, name, topic, stn, road, jib, scale, VIEW.format(n=no), tg,
                        re.sub(r"\s+", " ", title).strip() or None)
                    n_put += 1
                    if not (stn or road or jib):
                        n_nogeo += 1
                seen.add(no)
                time.sleep(0.05)
            if p % 20 == 0:
                print(f"    {p}/{last}쪽 · 훑음 {n_all} · 개발 {n_topic} · 넣음 {n_put}", flush=True)

        # 도로만 아는 것은 도로 가운데점으로. 역이 있으면 위에서 이미 붙었다
        await c.execute("""
            UPDATE master.press_event b SET geom = r.pt
              FROM (SELECT rn, ST_Centroid(ST_Collect(geom)) pt
                      FROM master.road_segment WHERE rn IS NOT NULL GROUP BY rn) r
             WHERE b.geom IS NULL AND b.road IS NOT NULL AND r.rn = b.road""")
        await c.execute("ANALYZE master.press_event")
        t = await c.fetchrow("""SELECT count(*) t, count(geom) g, count(jibun) j,
                                       min(on_date) f, max(on_date) l FROM master.press_event""")
        print(f"\n  훑은 보도자료 {n_all:,} · 개발·시설 {n_topic:,} · 넣은 것 {n_put:,}"
              f" (자리 모름 {n_nogeo:,})")
        print(f"  master.press_event {t['t']:,}줄 · 좌표 {t['g']:,} · 지번 {t['j']:,} · {t['f']}~{t['l']}")
        return 0
    finally:
        await c.close()


sys.exit(asyncio.run(main()))
