-- 0028 자동완성·지역목록 속도
--
-- 문제(실측, 로컬 56만행):
--   ① /search/suggest 첫 호출 4.6s — 지역 캐시를 요청 스레드가 직접 만든다.
--      집계 자체가 buildings 전수 스캔 + 디스크 외부정렬로 6.9s.
--   ② /search/regions 첫 호출 9.1s — 같은 성격의 전수 GROUP BY.
--      Cloud Run은 인스턴스가 새로 뜰 때마다(배포·스케일아웃·유휴 재시작) 다시 지불한다.
--   ③ 2글자 이하 검색어 190~270ms — trigram이 짧은 문자열에서 선택도가 없어 후보를 대량으로 훑는다.
--      3글자를 넘기면 5ms로 떨어진다(=타이핑 초반이 정확히 느린 구간).
--   ④ 접두 우선 정렬이 죽어 있음 — jibun_norm이 '관악구봉천동1568-1'처럼 구를 포함해서
--      사용자가 치는 '봉천동1568'과 접두가 맞지 않는다(접두 매칭 0건). btree 인덱스가 놀고,
--      정렬 없는 LIMIT 15가 후보를 임의로 잘라 원하는 건물이 목록에서 빠질 수 있다.
--
-- 해결: ①② 미리 집계한 MV로 대체(요청 경로에서 전수 스캔 제거),
--       ③④ '동+지번' 접두 인덱스를 만들어 짧은 질의를 btree로 받는다.

-- ── ①② 지역 집계 MV — suggest(지역·구 후보)와 regions(3단 캐스케이드)가 함께 쓴다.
--    적재 스왑 직후 loader가 REFRESH한다(pipeline/loader.py §4).
CREATE MATERIALIZED VIEW IF NOT EXISTS master.region_index AS
SELECT sgg_code,
       bjd_code,
       split_part(addr, ' ', 2)  AS gu,
       split_part(addr, ' ', 3)  AS dong,
       avg(ST_X(geom))::float8   AS lng,
       avg(ST_Y(geom))::float8   AS lat,
       count(*)::bigint          AS cnt
FROM master.buildings
WHERE bjd_code IS NOT NULL AND sgg_code IS NOT NULL
GROUP BY 1, 2, 3, 4;

-- REFRESH CONCURRENTLY 전제(적재 중에도 조회가 막히지 않게). GROUP BY 4열이라 유일.
CREATE UNIQUE INDEX IF NOT EXISTS region_index_uix
  ON master.region_index (sgg_code, bjd_code, gu, dong);

-- ── ③④ '동+지번' 접두 검색
-- addr은 항상 '서울특별시 <구> <동> <지번>번지' 4토큰(전수 확인). 여기서 동+지번만 뽑으면
-- 사용자가 실제로 치는 문자열('역삼동619')과 접두가 일치한다.
CREATE OR REPLACE FUNCTION master.dong_jibun(addr text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT replace(split_part(addr, ' ', 3) || split_part(addr, ' ', 4), '번지', '') $$;

-- 인덱스는 현재 활성 물리테이블에 건다. 이후 버전은 loader의
-- CREATE TABLE ... (LIKE ... INCLUDING ALL)로 상속된다.
DO $$
DECLARE t text;
BEGIN
  SELECT n.nspname || '.' || c.relname INTO t
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'master' AND c.relkind = 'r' AND c.relname ~ '^buildings_v[0-9]+$'
  ORDER BY (regexp_replace(c.relname, '\D', '', 'g'))::int DESC
  LIMIT 1;
  IF t IS NULL THEN
    RAISE NOTICE '0028: buildings 물리테이블 없음 — 인덱스 생략';
    RETURN;
  END IF;
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %s (master.dong_jibun(addr) text_pattern_ops)',
    'buildings_dongjibun_prefix_idx', t);
  RAISE NOTICE '0028: %에 동+지번 접두 인덱스 생성', t;
END $$;
