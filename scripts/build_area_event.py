#!/usr/bin/env python3
"""master.area_event — 주변 동향(호재) 한 표(2026-09-05).

## 왜 한 표인가
원천이 넷이어도(도시공간포털·건축HUB·나라장터·V-World) **화면과 에이전트가 읽는 것은 하나여야 한다.**
갈래마다 표를 따로 두면 화면이 네 번 조회하고, 에이전트는 어느 표를 봐야 할지 모른다.

## 줄 하나 = 사건 하나 (건물마다가 아니다)
건물×사건을 미리 곱하면 58만 동 × 수십 건 = 천만 줄이 넘는다. 도형만 담고
**건물과의 관계(구역 안 / 반경 안 / 거리)는 읽을 때 PostGIS 로 낸다.**
읽는 쪽이 붙이는 building_pk·relation·distance_m 은 API 가 얹는다.

## 칸을 이렇게 나눈 이유 — 에이전트가 지어내지 않게
  · `kind` 는 **코드**다. 「더 지을 수 있게 된다」 같은 문장이면 모델이 뜻을 다시 해석한다
  · `on_date`(정확)와 `on_year`(연도만)를 **가른다.** 한 칸에 뭉개면 모델이
    2025-01-01 을 실제 고시일로 읽는다. 정비구역 839개 중 고시일자가 있는 것은 273개뿐이다
  · 모르는 것은 **null**. 빈 문자열·0·「미상」은 값처럼 읽혀 계산에 섞인다
  · `source` 는 화면에 그대로 나가는 말이라 **사람의 말**로 적는다("국토교통부 국가공간정보").
    `src_table`·`src_key` 가 우리끼리 쓰는 코드고, 나중 조인(고시 본문)이 그걸로 붙는다

    BT_DATABASE_URL=... backend/.venv/bin/python scripts/build_area_event.py
"""
import asyncio
import os

import asyncpg

DSN = os.environ.get("BT_DATABASE_URL") or os.environ.get(
    "DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")

DDL = """
DROP TABLE IF EXISTS master.area_event;
CREATE TABLE master.area_event(
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL,              -- 정비·개발 | 기반시설 | 건축 인허가 | 기타
  name        text,                       -- 원장 그대로. 없으면 고시번호로 부른다
  on_date     date,                       -- 정확한 날짜. 없으면 null
  on_year     smallint,                   -- 연도만 아는 경우
  gosi_no     text,                       -- 「서울특별시 고시 제2026-145호」
  body        text,                       -- 고시 본문(E-2 에서 채운다)
  source      text NOT NULL,              -- 화면에 그대로 나가는 말
  source_url  text,
  src_table   text NOT NULL,              -- 우리끼리 쓰는 코드
  src_key     text,                       -- 나중 조인용(ntfc_sn · mnum …)
  geom        geometry(Geometry,4326) NOT NULL);
CREATE INDEX ON master.area_event USING GIST(geom);
CREATE INDEX ON master.area_event(kind);
CREATE INDEX ON master.area_event(on_date DESC NULLS LAST);
CREATE INDEX ON master.area_event(src_table, src_key);
-- 소식 탭 찾기(이름·내용 ILIKE) — pg_trgm 이 있어야 한다(로컬·프로덕션 둘 다 설치돼 있다)
CREATE INDEX ON master.area_event USING gin (name gin_trgm_ops);
CREATE INDEX ON master.area_event USING gin (body gin_trgm_ops);
"""

FILL = r"""
INSERT INTO master.area_event(kind, name, on_date, on_year, gosi_no, source, source_url, src_table, src_key, geom)
-- 정비구역·재정비촉진지구 — 이름이 비면 고시번호로 부른다(label 생성열이 이미 그렇게 낸다)
-- 이름도 고시번호도 없는 구역이 여섯이다 — 사업 종류(kind)로라도 부른다. 빈 이름은 화면에 「—」로 선다
SELECT '정비·개발', COALESCE(NULLIF(btrim(z.label), ''), NULLIF(btrim(z.kind), ''), '정비구역'), z.ntf_date, z.gosi_year,
       CASE WHEN z.gosi_year IS NOT NULL AND z.gosi_no IS NOT NULL
            THEN '서울특별시 고시 제' || z.gosi_year || '-' || z.gosi_no || '호' END,
       '국토교통부 국가공간정보', NULL, 'redevel_zone', z.mnum, z.geom
  FROM master.redevel_zone z WHERE z.geom IS NOT NULL
UNION ALL
SELECT '정비·개발', p.name, p.ntf_date, EXTRACT(YEAR FROM p.ntf_date)::smallint,
       NULL, '국토교통부 국가공간정보', NULL, 'district_plan', p.ntfc_sn, p.geom
  FROM master.district_plan p WHERE p.geom IS NOT NULL

UNION ALL
-- 기반시설 — 도시계획시설 폴리곤을 **고시 단위로 묶는다.**
--   낱개로 세우면 이름이 「소로3류」·「중로2류」다. 그건 시설 종류지 이름이 아니라
--   화면에 스무 줄이 서도 뭐가 바뀌는지 모른다. 고시 하나가 여러 폴리곤을 덮으므로
--   고시로 묶으면 「배말근린공원 조성계획 결정(변경)」처럼 읽히는 줄이 된다.
--   같은 고시가 지구단위계획으로 이미 서 있으면 두 번 세우지 않는다(아래 NOT EXISTS).
--   **개발행위허가제한은 「규제」로 간다** — 「생긴다」와 「못 한다」는 정반대 소식이라
--   한 머리글 아래 섞이면 못 읽는다(2026-09-06).
SELECT CASE WHEN f.layer = '개발행위허가제한' THEN '규제' ELSE '기반시설' END,
       -- 포털 제목이 「(기구축내용없음)」인 옛 고시가 164건이다(1960~80년대). 그 글자를 화면에 세우면
       --   중개인이 읽는 이름이 아니다 — 법정 표기대로 「도시계획시설(도로) 결정」으로 부른다(2026-09-06)
       CASE WHEN n.title IS NULL OR n.title ~ '기구축|내용없음' OR btrim(n.title) = ''
            THEN CASE WHEN f.layer = '개발행위허가제한' THEN '개발행위허가 제한지역 지정'
                      ELSE '도시계획시설(' || f.layer || ') 결정' END
            ELSE btrim(regexp_replace(n.title, '\s*(,\s*)?(및\s*)?지형도면\s*고시\s*$', '')) END,
       n.notice_date, EXTRACT(YEAR FROM n.notice_date)::smallint,
       -- 「제0000-000호」는 번호가 아니다(포털의 빈 값)
       CASE WHEN n.notice_no IS NOT NULL AND n.notice_no !~ '^0+-0+$' THEN '서울특별시 고시 제' || n.notice_no || '호' END,
       CASE WHEN f.layer = '개발행위허가제한' THEN '서울 열린데이터광장 · 개발행위허가제한'
            ELSE '서울 열린데이터광장 · 도시계획시설' END, NULL, 'city_facility', f.ntfc_sn,
       -- 원천 폴리곤에 자기교차가 있다. 고친 뒤 **면만 남겨** 합친다 —
       -- ST_MakeValid 가 점·선을 섞어 GEOMETRYCOLLECTION 을 내놓고, 그대로 넣으면
       -- 색인이 GEOSContains 에서 죽는다(side location conflict)
       ST_Multi(ST_CollectionExtract(ST_Collect(ST_MakeValid(f.geom)), 3))
  FROM master.city_facility f
  JOIN master.urban_notice n ON n.notice_code = f.ntfc_sn
 WHERE f.geom IS NOT NULL AND n.notice_date IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM master.district_plan d WHERE d.ntfc_sn = f.ntfc_sn)
 GROUP BY n.title, n.notice_date, n.notice_no, f.ntfc_sn, f.layer

UNION ALL
-- 건축 인허가 — 「옆 땅에 신축이 들어온다」. 대지위치가 PNU 로 오므로 자리가 정확하다.
--   **최근 5년 허가만** 세운다. 55만 줄을 다 올리면 동향이 아니라 대장이 된다.
--   철거멸실은 **안 올린다** — 원천이 2020년까지만 채워져 있어 최근 것을 못 잡는다.
--   이름은 대지위치에서 「서울특별시 OO구」를 떼고 구분·용도를 붙여 우리가 짓는다.
SELECT '건축 인허가',
       btrim(regexp_replace(b.addr, '^서울특별시\s*\S+구\s*', ''))
         || COALESCE(' · ' || b.act, '') || COALESCE(' · ' || b.use_name, ''),
       b.permit_on, EXTRACT(YEAR FROM b.permit_on)::smallint,
       NULL, '국토교통부 건축행정시스템', NULL, 'building_permit', b.id::text,
       v.geom
  FROM master.building_permit b
  JOIN master.parcels v ON v.pnu = b.pnu
 WHERE b.kind = '인허가' AND b.permit_on >= now() - interval '5 years'
   AND b.act IN ('신축', '증축') AND v.geom IS NOT NULL

UNION ALL
-- 정책 발표 — 고시도 발주도 없는 구간을 메운다. 「종로5가역 7·8번 출입구 개선」처럼
--   발표부터 발주까지 1~2년이 빈다. 그 사이엔 보도자료에만 있다.
--   **본문은 안 싣는다**(공공누리 4유형 · 상업적 이용금지). 사실과 원문 링크만.
--   `body` 를 비워 두는 것이 규칙이다 — 채우면 저작권 위반이다.
SELECT '정책 발표', p.name, p.on_date, EXTRACT(YEAR FROM p.on_date)::smallint,
       NULL, '서울시 보도자료', p.url, 'press_event', p.id::text, p.geom
  FROM master.press_event p WHERE p.geom IS NOT NULL
  -- 열쇠는 기사번호가 아니라 줄 id 다. 기사 하나가 자리 넷이면 넉 줄인데(종로5가·청량리·…)
  --   기사번호로 두면 소식 화면의 「날짜|열쇠」 커서가 세 줄을 건너뛴다(2026-09-06).

UNION ALL
-- 공사 발주 — **기반시설 갈래 안에 넣는다**(계획 §2 「나라장터는 보조다」).
--   「도로 결정 고시」와 「그 도로 공사 발주」는 같은 일의 앞뒤다. 갈래를 가르면
--   같은 도로가 두 머리글에 흩어져 시간순으로 안 읽힌다. 무엇이 원천인지는 상세의 「출처」가 말한다.
--   역 출입구 개선·보행환경 개선은 도시관리계획을 다시 결정하지 않아 어떤 고시에도 안 남는다 —
--   공사 발주로만 잡힌다. **자리를 아는 것만**(공고명의 역·도로가 우리 DB에 실재할 때). 4,698 중 242.
SELECT '기반시설', g.name, g.notice_on, EXTRACT(YEAR FROM g.notice_on)::smallint,
       NULL, '나라장터', g.url, 'g2b_bid', g.bid_no, g.geom
  FROM master.g2b_bid g WHERE g.geom IS NOT NULL AND g.notice_on IS NOT NULL;
"""


async def main() -> None:
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=3600)
    try:
        await c.execute(DDL)
        await c.execute(FILL)
        r = await c.fetchrow("""SELECT count(*) n, count(name) nm, count(on_date) d,
                                       count(on_year) y, count(gosi_no) g
                                  FROM master.area_event""")
        print(f"  행 {r['n']:,} · 이름 {r['nm']:,} · 고시일 {r['d']:,} · 연도 {r['y']:,} · 고시번호 {r['g']:,}")
        for x in await c.fetch("""SELECT src_table, kind, count(*) n FROM master.area_event
                                  GROUP BY 1,2 ORDER BY 3 DESC"""):
            print(f"    {x['src_table']:<16} {x['kind']:<10} {x['n']:,}")
        # 이름을 못 부르는 줄 — 화면에 「—」로 서는 것이라 몇 개인지 알아야 한다
        bad = await c.fetchval("SELECT count(*) FROM master.area_event WHERE name IS NULL")
        print(f"  이름도 고시번호도 없어 못 부르는 줄 {bad}")
        # 실제로 읽어 본다 — 삼성동 78 반경 700m
        rows = await c.fetch("""
            WITH me AS (SELECT geom FROM master.buildings WHERE building_pk='1024123619')
            SELECT e.name, e.on_date, e.on_year,
                   ST_Contains(e.geom, me.geom) inside,
                   round(ST_Distance(e.geom::geography, me.geom::geography))::int m
              FROM master.area_event e, me
             WHERE ST_DWithin(e.geom::geography, me.geom::geography, 700)
             ORDER BY COALESCE(e.on_date, make_date(COALESCE(e.on_year,1900),1,1)) DESC LIMIT 5""")
        print("  ── 삼성동 78 · 반경 700m")
        for x in rows:
            when = x["on_date"] or (f"{x['on_year']}년" if x["on_year"] else "—")
            print(f"    {str(when):<12} {(x['name'] or '—')[:30]:<32} {'구역 안' if x['inside'] else str(x['m'])+'m'}")
    finally:
        await c.close()


asyncio.run(main())
