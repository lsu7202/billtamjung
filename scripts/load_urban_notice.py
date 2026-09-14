#!/usr/bin/env python3
"""서울도시공간포털 도시계획 결정고시를 `master.urban_notice` 로 적재하고,
   `master.area_event` 에 **본문과 고시문 주소를 붙인다**(2026-09-05).

우리는 지구단위계획·정비구역의 이름·날짜·도형만 갖고 있었다. 「무엇을 어떻게 바꾼다」는
고시 본문이 없어서 화면을 열어도 「그런 게 있다」까지였다. 그 칸을 채운다.

## 붙는 법
① **지구단위계획** — `noticeCode` 가 `district_plan.ntfc_sn` 과 같은 체계다(`11110NTC202407120002`). 1:1.
② **정비구역** — `MNUM` 이 다른 체계라 코드로는 못 붙는다. **고시번호로 붙인다.**
   「서울특별시 고시 제2026-145호」에서 숫자만 뽑아(`2026145`) 포털의 `noticeNo` 와 맞댄다.

**이름으로 찾는 것은 그만뒀다(2026-09-05).** `redevel_zone.label` 의 절반은 이름이 아니라
사업 종류다 — 「재개발」 한 낱말이 고시 6,634건에 걸린다. 이름으로는 821개 중 44개밖에 못 붙였다.
고시번호로는 **711개**가 붙는다.

같은 번호를 여러 고시가 쓰기도 한다(22,351개 번호 중 5,385개, 최대 79건). 그래서 골라 쓴다:
**고시일이 같은 것 → 제목이 정비 관련인 것 → 그 밖** 차례. 확신이 센 것부터다.

    BT_DATABASE_URL=... backend/.venv/bin/python scripts/load_urban_notice.py
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
SRC = "data/raw/_urban_notice/notices.jsonl"

# **DROP 하지 않는다**(2026-09-06 증분 전환). 예전엔 표를 지우고 다시 만들었는데, 그러면
#   fetch_notice_pdf 가 붙여 둔 고시문 글자(pdf_text · 1,055건, PDF 를 다시 받아야 나온다)가 통째로 날아갔다.
#   주간 크롤은 최신 3쪽만 받아 jsonl 에 **덧붙이고**, 여기서는 코드로 upsert 한다.
DDL = """
CREATE TABLE IF NOT EXISTS master.urban_notice(
  notice_code text PRIMARY KEY,
  notice_no   text,
  notice_date date,
  title text, body text,
  site_code text, site text,
  charger text, phone text,
  classify text,
  pdf text);
CREATE INDEX IF NOT EXISTS urban_notice_notice_date_idx ON master.urban_notice(notice_date DESC NULLS LAST);
ALTER TABLE master.urban_notice ADD COLUMN IF NOT EXISTS pdf_text text;
ALTER TABLE master.urban_notice ADD COLUMN IF NOT EXISTS pdf_pages smallint;
ALTER TABLE master.urban_notice ADD COLUMN IF NOT EXISTS pdf_issuer text;
ALTER TABLE master.urban_notice ADD COLUMN IF NOT EXISTS pdf_no text;
ALTER TABLE master.urban_notice ADD COLUMN IF NOT EXISTS pdf_tried boolean;
-- 소식 탭 찾기(제목·본문 ILIKE) 색인. 없으면 4.4만 본문을 훑어 0.5초, 있으면 수십 ms
CREATE INDEX IF NOT EXISTS urban_notice_body_trgm ON master.urban_notice USING gin (body gin_trgm_ops);
CREATE INDEX IF NOT EXISTS urban_notice_title_trgm ON master.urban_notice USING gin (title gin_trgm_ops);
"""
UPSERT = """
INSERT INTO master.urban_notice(notice_code, notice_no, notice_date, title, body,
                                site_code, site, charger, phone, classify, pdf)
SELECT notice_code, notice_no, notice_date, title, body, site_code, site, charger, phone, classify, pdf
  FROM un_in
ON CONFLICT (notice_code) DO UPDATE SET
  notice_no = EXCLUDED.notice_no, notice_date = EXCLUDED.notice_date, title = EXCLUDED.title,
  body = EXCLUDED.body, site_code = EXCLUDED.site_code, site = EXCLUDED.site,
  charger = EXCLUDED.charger, phone = EXCLUDED.phone, classify = EXCLUDED.classify,
  pdf = EXCLUDED.pdf,
  -- 고시문 주소가 바뀌었으면 글자도 다시 받아야 한다. 같으면 그대로 둔다
  pdf_text  = CASE WHEN master.urban_notice.pdf IS DISTINCT FROM EXCLUDED.pdf THEN NULL ELSE master.urban_notice.pdf_text END,
  pdf_pages = CASE WHEN master.urban_notice.pdf IS DISTINCT FROM EXCLUDED.pdf THEN NULL ELSE master.urban_notice.pdf_pages END,
  pdf_tried = CASE WHEN master.urban_notice.pdf IS DISTINCT FROM EXCLUDED.pdf THEN NULL ELSE master.urban_notice.pdf_tried END
"""
COLS = ["notice_code", "notice_no", "notice_date", "title", "body",
        "site_code", "site", "charger", "phone", "classify", "pdf"]


def d(s):
    s = (s or "").strip()[:10].replace(".", "-").replace("/", "-")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return None
    try:
        return date(int(s[:4]), int(s[5:7]), int(s[8:10]))
    except ValueError:
        return None


def s(x):
    v = (x or "").strip()
    return v or None


async def main() -> int:
    if not os.path.exists(SRC):
        print(f"✗ {SRC} 가 없다 — scripts/urban/fetch_notices.py 먼저")
        return 2
    seen, recs = set(), []
    for line in open(SRC, encoding="utf-8"):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        code = s(r.get("noticeCode"))
        if not code or code in seen:
            continue
        seen.add(code)
        recs.append((code, s(r.get("noticeNo")), d(r.get("noticeDate")),
                     s(r.get("title")), s(r.get("content")),
                     s(r.get("siteCode")), s(r.get("site")),
                     s(r.get("charger")), s(r.get("phone")),
                     s(r.get("noticeClassify")), s(r.get("pdf"))))
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=3600)
    try:
        await c.execute(DDL)
        before = await c.fetchval("SELECT count(*) FROM master.urban_notice")
        await c.execute("""CREATE TEMP TABLE un_in AS
                             SELECT notice_code, notice_no, notice_date, title, body,
                                    site_code, site, charger, phone, classify, pdf
                               FROM master.urban_notice WITH NO DATA""")
        await c.copy_records_to_table("un_in", columns=COLS, records=recs)
        await c.execute(UPSERT)
        await c.execute("ANALYZE master.urban_notice")
        n = await c.fetchrow("""SELECT count(*) t, count(body) b, count(pdf) p,
                                       count(notice_date) dt, count(pdf_text) x FROM master.urban_notice""")
        print(f"  master.urban_notice {n['t']:,}줄(새로 {n['t'] - before:,}) · 본문 {n['b']:,} · PDF {n['p']:,}"
              f" · 고시일 {n['dt']:,} · 고시문 글자 {n['x']:,}(지켰다)")

        # ── 붙이기 ① 코드가 같은 것 — 지구단위계획과 도시계획시설.
        #    둘 다 src_key 가 곧 notice_code 다
        a = await c.execute("""
            UPDATE master.area_event e
               SET body = n.body,
                   source_url = COALESCE(n.pdf, e.source_url),
                   source = '서울도시공간포털'
              FROM master.urban_notice n
             WHERE e.src_table IN ('district_plan', 'city_facility')
               AND n.notice_code = e.src_key AND n.body IS NOT NULL""")
        # ── 붙이기 ② 정비구역: 고시번호로. 같은 번호가 여럿이면 확신이 센 것을 고른다
        b = await c.execute(r"""
            UPDATE master.area_event e
               SET body = x.body, source_url = x.pdf, source = '서울도시공간포털'
              FROM (
                SELECT DISTINCT ON (e2.id) e2.id, n.body, n.pdf
                  FROM master.area_event e2
                  JOIN master.urban_notice n
                    ON regexp_replace(n.notice_no, '\D', '', 'g')
                     = regexp_replace(e2.gosi_no, '\D', '', 'g')
                 WHERE e2.src_table = 'redevel_zone' AND e2.gosi_no IS NOT NULL
                   AND n.body IS NOT NULL AND n.notice_no IS NOT NULL
                   AND length(regexp_replace(e2.gosi_no, '\D', '', 'g')) >= 6
                 ORDER BY e2.id,
                          (n.notice_date = e2.on_date) DESC,
                          (n.title ~ '정비구역|재정비|재개발|재건축') DESC,
                          n.notice_date) x
             WHERE e.id = x.id""")
        # ── 이름 고치기: 이름 자리에 고시번호가 든 줄이 314개다(원천이 그렇게 준다).
        #     붙은 고시의 제목이 훨씬 낫다 — 「서울특별시 고시 제2026-341호 정비구역」보다
        #     「미아동 345-1번지 일대 주택정비형 재개발사업」이 사람이 읽는 이름이다.
        #     꼬리의 「및 지형도면 고시」만 떼고 나머지는 **원문 그대로 둔다.**
        r = await c.execute(r"""
            UPDATE master.area_event e
               SET name = btrim(regexp_replace(x.title,
                     '\s*(,\s*)?(및\s*)?지형도면\s*고시\s*$', ''))
              FROM (
                SELECT DISTINCT ON (e2.id) e2.id, n.title
                  FROM master.area_event e2
                  JOIN master.urban_notice n
                    ON regexp_replace(n.notice_no, '\D', '', 'g')
                     = regexp_replace(e2.gosi_no, '\D', '', 'g')
                 WHERE (e2.name IS NULL OR e2.name ~ '^서울특별시 고시|기구축|내용없음' OR btrim(e2.name) = '')
                   AND e2.gosi_no IS NOT NULL
                   AND n.title IS NOT NULL AND n.title !~ '기구축|내용없음'
                 ORDER BY e2.id,
                          (n.notice_date = e2.on_date) DESC,
                          (n.title ~ '정비구역|재정비|재개발|재건축') DESC,
                          n.notice_date) x
             WHERE e.id = x.id AND length(x.title) > 8""")
        print(f"  이름 자리에 고시번호가 있던 줄을 고시 제목으로 — {r.split()[-1]}줄")
        print(f"  area_event 에 본문 붙임 — 지구단위계획 {a.split()[-1]} · 정비구역 {b.split()[-1]}")
        t = await c.fetchrow("""SELECT count(*) t, count(body) b FROM master.area_event""")
        print(f"  → {t['t']:,}줄 중 본문 {t['b']:,} ({100*t['b']/t['t']:.1f}%)")
        return 0
    finally:
        await c.close()


sys.exit(asyncio.run(main()))
