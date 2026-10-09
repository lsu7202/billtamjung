-- 0223 도로명 주소로 건물 찾기(2026-10-04 읽기 API 근본 정리 ②)
--
-- 모델 · 자료 · 셈은 건물을 **주소**로 가리킨다. 지번(dong_jibun)만 받아서 「관악로 171」로 물으면 0건이었다.
-- 도로명 열쇠 함수 하나를 두고, 검색 필터 · 주소 해석 · 자료 지도가 **같은 함수**로 푼다(search._addr_cond).
--   「서울특별시 종로구 필운대로5가길 53 (누상동)」 → 「필운대로5가길53」
CREATE OR REPLACE FUNCTION master.road_key(road text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT replace(regexp_replace(regexp_replace(regexp_replace(road,
       '\s*\(.*\)\s*$', ''), '^서울(특별시)?\s*', ''), '^\S+구\s+', ''), ' ', '') $$;

-- 인덱스는 현재 활성 물리테이블에 건다. 이후 버전은 loader 의 LIKE ... INCLUDING ALL 로 상속된다(0028 과 같은 길)
DO $$
DECLARE t text;
BEGIN
  SELECT n.nspname || '.' || c.relname INTO t
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'master' AND c.relkind = 'r' AND c.relname ~ '^buildings_v[0-9]+$'
  ORDER BY (regexp_replace(c.relname, '\D', '', 'g'))::int DESC
  LIMIT 1;
  IF t IS NULL THEN
    RAISE NOTICE '0223: buildings 물리테이블 없음 — 인덱스 생략';
    RETURN;
  END IF;
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %s (master.road_key(road_addr))', 'buildings_road_key_idx', t);
END $$;
