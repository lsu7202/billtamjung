-- 날짜 정밀도 두 칸 — 「1959년(월·일 모름)」을 날짜 하나로 뭉개지 않는다 (2026-09-07)
--
-- ## 왜
-- 대장은 준공일·대수선일을 늘 8자리로 주지 않는다. `1959`(연) · `199901`(월) 처럼 적힌 것이 있다.
-- 빌더는 그걸 살려 정밀도까지 냈는데, 그 뒤 두 곳에서 죽었다:
--   · build_integrated 가 정밀도 키를 안 옮겼다
--   · export_seoul 의 norm_ymd 가 8자리가 아니면 빈칸으로 만들었다  → **459동의 준공일이 통째로 사라졌다**
-- 반대 방향의 거짓말도 있었다. 대수선일은 연도만 알아도 `0101` 을 붙여 저장해,
-- 「2006년에 고쳤다」가 화면에 `2006/01/01` 로 떴다(24건 이하).
--
-- ## 어떻게
-- 값은 그대로 date 로 두되(자리는 01 로 채움), **정밀도 칸이 「연·월·일」 중 무엇까지 아는지 말한다.**
-- 화면은 그 칸을 보고 「1959년」·「2006년 3월」·「1993/12/22」로 갈라 쓴다.
-- 아는 만큼만 말하는 것이 규칙이다 — 모르는 것을 지어내지도, 아는 것을 버리지도 않는다.

BEGIN;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'master' AND c.relkind = 'r' AND c.relname ~ '^buildings(_v[0-9]+)?$'
  LOOP
    EXECUTE format('ALTER TABLE master.%I '
                   'ADD COLUMN IF NOT EXISTS approval_ymd_prec text, '
                   'ADD COLUMN IF NOT EXISTS remodel_ymd_prec text', t);
    EXECUTE format('COMMENT ON COLUMN master.%I.approval_ymd_prec IS %L', t,
                   '사용승인일을 어디까지 아는가 — 일|월|연. NULL 이면 값도 NULL');
    EXECUTE format('COMMENT ON COLUMN master.%I.remodel_ymd_prec IS %L', t,
                   '최근대수선일을 어디까지 아는가 — 일|월|연');
  END LOOP;
END $$;

-- 뷰는 SELECT * 라 새 칸이 따라온다. 로더 스왑 전에도 보이도록 다시 세운다
DO $$
DECLARE live text;
BEGIN
  SELECT regexp_replace(pg_get_viewdef(c.oid), '.*FROM master\.([a-z_0-9]+).*', '\1', 'ns')
    INTO live
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'master' AND c.relname = 'buildings';
  IF live IS NOT NULL THEN
    EXECUTE format('CREATE OR REPLACE VIEW master.buildings AS SELECT * FROM master.%I', live);
  END IF;
END $$;

COMMIT;
