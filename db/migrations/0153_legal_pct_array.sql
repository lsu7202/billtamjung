-- 법정 건폐율·용적률을 text → integer[] 로 바꾼다 (2026-09-02).
--
-- ## 왜
--
-- 이 두 칸은 값이 하나일 때도 있고("50%") 여럿일 때도 있다("50%, 250%"). 걸친 필지에서
-- 작은 쪽이 330㎡(상업 660㎡)를 넘으면 법이 가중평균을 금해 각각 적기 때문이다.
-- 서울에서 legal_bcr 6,529필지 · legal_far 7,951필지가 그렇고, 최대 6개까지 붙는다.
--
-- 그걸 **문자열 한 칸에** 담아 놓으니 읽는 쪽마다 정규식을 따로 썼고, 2026-09-02 하루에
-- 같은 원인의 버그가 여섯 개 나왔다.
--
--     _pct(buildings)        '50%, 250%' → 50        작은 쪽을 법정치인 양 씀
--     _parse_far(보고서)      '50%, 250%' → 50
--     _legal_far(점수배치)     '50%, 250%' → 50        증축 여지가 음수로 뒤집힘
--     LandScene.pct          숫자만 남겨 5060         3D 부피가 5060%로 그려짐
--     ParcelBlock.pct        첫 % 만 지워 "50, 60%%"  잔여 계산은 NaN
--     max(pr.legal_far)      '50%' > '245%'          여러 필지 건물 332동이 틀린 값
--
-- 하나씩 고치면 일곱 번째가 나온다. **목록을 목록으로 저장하면** 뜯어 읽을 문자열이
-- 없어져 이 갈래가 통째로 사라진다.
--
--     {50}        값이 하나 — 계산에 쓴다
--     {50,60}     병기 — 계산엔 안 쓴다(하나를 고르면 지어내는 것). 화면엔 둘 다 보인다
--
-- 값은 전부 정수라 numeric 이 아니라 **integer[]** 로 둔다. numeric[] 이면 asyncpg 가
-- Decimal 목록을 주고 JSON 직렬화에서 터진다.
--
-- ## 어떻게
--
-- master.parcels 는 세대 교체(parcels_vN)를 뷰로 덮는 구조이고, master.vacant_parcels
-- (구체화뷰)가 그 뷰를 읽는다. 그래서 뷰 둘을 내렸다가 올려야 한다. 세대 번호를 박으면
-- 환경마다 다르므로(개발서버는 아직 옛 세대) **정의를 떠서 그대로 복구**한다.
--
-- 되돌리려면 같은 방식으로 integer[] → text 로 바꾸면 된다(array_to_string + '%').

BEGIN;

DO $mig$
DECLARE
  mvdef   text;
  idxdefs text[];
  cur_tbl text;
  t       record;
  d       text;
BEGIN
  -- 이미 바꿔 뒀으면 아무것도 안 한다(다시 돌려도 안전하게)
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='master' AND table_name='parcels'
                AND column_name='legal_bcr' AND data_type='ARRAY') THEN
    RAISE NOTICE '이미 integer[] 입니다 — 건너뜁니다';
    RETURN;
  END IF;

  -- ── 1) 내리기 전에 정의를 떠 둔다
  SELECT definition INTO mvdef
    FROM pg_matviews WHERE schemaname='master' AND matviewname='vacant_parcels';
  SELECT array_agg(indexdef) INTO idxdefs
    FROM pg_indexes WHERE schemaname='master' AND tablename='vacant_parcels';

  -- 현재 세대 = parcels 뷰가 읽고 있는 표
  SELECT c.relname INTO cur_tbl
    FROM pg_depend dep
    JOIN pg_rewrite rw ON rw.oid = dep.objid
    JOIN pg_class v ON v.oid = rw.ev_class AND v.relname = 'parcels'
    JOIN pg_class c ON c.oid = dep.refobjid
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'master'
   WHERE c.relname ~ '^parcels_v[0-9]+$'
   LIMIT 1;
  IF cur_tbl IS NULL THEN
    RAISE EXCEPTION 'master.parcels 가 읽는 세대 표를 못 찾았습니다';
  END IF;
  RAISE NOTICE '현재 세대: %', cur_tbl;

  -- ── 2) 뷰 내리기
  IF mvdef IS NOT NULL THEN
    EXECUTE 'DROP MATERIALIZED VIEW master.vacant_parcels';
  END IF;
  DROP VIEW IF EXISTS master.parcels;

  -- ── 3) 세대 표 전부 바꾸기 (옛 세대도 같이 — 다음 세대는 LIKE 로 따라온다)
  --
  -- 변환: '50%, 250%' → {50,250}. 천 단위 쉼표('1,000%')를 먼저 붙여 놓고
  -- 숫자와 쉼표만 남긴다. 지금 데이터엔 천 단위가 없지만(2026-09-02 전수 확인)
  -- 옛 판을 되살릴 때를 대비해 둔다.
  FOR t IN SELECT tablename FROM pg_tables
            WHERE schemaname='master' AND tablename ~ '^parcels_v[0-9]+$' LOOP
    EXECUTE format($f$
      ALTER TABLE master.%1$I
        ALTER COLUMN legal_bcr TYPE integer[] USING
          CASE WHEN legal_bcr IS NULL OR btrim(legal_bcr) = '' THEN NULL
               ELSE string_to_array(
                      regexp_replace(regexp_replace(legal_bcr,'(\d),(\d)','\1\2','g'),
                                     '[^0-9,]','','g'), ',')::integer[] END,
        ALTER COLUMN legal_far TYPE integer[] USING
          CASE WHEN legal_far IS NULL OR btrim(legal_far) = '' THEN NULL
               ELSE string_to_array(
                      regexp_replace(regexp_replace(legal_far,'(\d),(\d)','\1\2','g'),
                                     '[^0-9,]','','g'), ',')::integer[] END
    $f$, t.tablename);
    RAISE NOTICE '  %  바꿈', t.tablename;
  END LOOP;

  -- ── 4) 뷰 복구
  EXECUTE format('CREATE OR REPLACE VIEW master.parcels AS SELECT * FROM master.%I', cur_tbl);
  IF mvdef IS NOT NULL THEN
    EXECUTE 'CREATE MATERIALIZED VIEW master.vacant_parcels AS ' || mvdef;
    IF idxdefs IS NOT NULL THEN
      FOREACH d IN ARRAY idxdefs LOOP
        EXECUTE d;
      END LOOP;
    END IF;
  END IF;
END
$mig$;

COMMENT ON COLUMN master.parcels.legal_bcr IS
  '법정 건폐율(%) 목록. 값이 하나면 {50}, 걸쳐서 병기되면 {50,60}. '
  '계산에는 길이 1일 때만 쓴다 — 여럿 중 하나를 고르면 지어내는 것이다.';
COMMENT ON COLUMN master.parcels.legal_far IS
  '법정 용적률(%) 목록. legal_bcr 과 같은 규칙.';

COMMIT;
