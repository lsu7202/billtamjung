-- master.region_index 칸 주석 (2026-09-09)
--
-- 겨루기 2번에서 모델이 지역 이름 칸을 몰라 `full_name` 을 두 번 지어냈다.
-- 0167 에서 같이 하려다 실패했다 — **materialized view 의 칸은 information_schema.columns 에 없다.**
-- pg_attribute 로 본다.

BEGIN;

DO $$
DECLARE k text; v text;
  cmt jsonb := '{
    "gu":       "구 이름(성동구)",
    "dong":     "동 이름(성수동1가). **지역 이름으로 코드를 찾는 칸이다**",
    "bjd_code": "법정동 코드 10자리. buildings.bjd_code 에 접두 LIKE 로 쓴다",
    "sgg_code": "시군구 코드 5자리"
  }'::jsonb;
BEGIN
  FOR k, v IN SELECT * FROM jsonb_each_text(cmt) LOOP
    IF EXISTS (SELECT 1 FROM pg_attribute a
                JOIN pg_class c ON c.oid = a.attrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname='master' AND c.relname='region_index'
                 AND a.attname = k AND a.attnum > 0 AND NOT a.attisdropped) THEN
      EXECUTE format('COMMENT ON COLUMN master.region_index.%I IS %L', k, v);
    END IF;
  END LOOP;
END $$;

COMMIT;
