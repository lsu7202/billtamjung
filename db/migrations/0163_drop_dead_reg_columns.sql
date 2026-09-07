-- 필지의 죽은 규제 칸 일곱을 지운다 (2026-09-07)
--
-- ## 왜
-- 규제를 여섯 갈래로 나눠 담던 옛 구조다(0009). 원문에서 **이름이 맞는 것만** 골라 담다가
-- 건수로 93.4%가 빠졌다 — 토지거래허가구역·대공방어협조구역·상대보호구역이 화면에 아예 안 떴다.
-- 그래서 0136 에서 원문 전부를 담는 `parcels.regulations`(jsonb) 로 갈아탔다.
--
-- **그런데 옛 칸을 안 지웠다.** 값을 만들던 빌드 단계(build_regulations)가 2026-09-01 에
-- 파이프라인에서 빠진 뒤로 실측 0행인 채, 쿼리·화면·MV·로더에 그대로 남아 있었다.
-- 코드에서 읽는 곳은 전부 걷어냈다(백엔드 7 · 프론트 6 · 나대지 1 · 로더 3 · 내보내기 3).
--
-- `uqa` 도 같이 지운다. 로더가 `use_zone` 을 넣게 돼 있는데 export 가 그 칸을 늘 빈칸으로
-- 보내서 **구조적으로 채워질 수 없었다**(실측 0행). 용도지역 정본은 `parcels.use_zone` 이고
-- load_parcel_luris 가 적재 뒤에 채운다.
--
-- 화면은 안 바뀐다 — 규제는 `regulations` 하나가 그린다(삼성동 78: 12건 그대로).

BEGIN;

-- 뷰·MV 가 칸을 붙들고 있다. 살아 있는 세대를 기억해 두고 둘 다 내린 뒤 칸을 지우고 다시 세운다
CREATE TEMP TABLE _live AS
SELECT regexp_replace(pg_get_viewdef(c.oid), '.*FROM master\.([a-z_0-9]+).*', '\1', 'ns') AS tbl
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'master' AND c.relname = 'parcels';

DROP MATERIALIZED VIEW IF EXISTS master.vacant_parcels;
DROP VIEW IF EXISTS master.parcels;

-- 살아 있는 세대와 옛 세대 전부에서 칸을 뺀다
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'master' AND c.relkind = 'r' AND c.relname ~ '^parcels(_v[0-9]+)?$'
  LOOP
    EXECUTE format('ALTER TABLE master.%I '
                   'DROP COLUMN IF EXISTS reg_godo, DROP COLUMN IF EXISTS reg_district, '
                   'DROP COLUMN IF EXISTS reg_jeongbi, DROP COLUMN IF EXISTS reg_gyeong, '
                   'DROP COLUMN IF EXISTS reg_banghwa, DROP COLUMN IF EXISTS reg_munhwa, '
                   'DROP COLUMN IF EXISTS uqa', t);
  END LOOP;
END $$;

-- 뷰를 같은 세대로 다시 세운다
DO $$
DECLARE live text;
BEGIN
  SELECT tbl INTO live FROM _live;
  IF live IS NULL THEN
    RAISE EXCEPTION '살아 있는 parcels 세대를 못 찾았습니다 — 뷰를 되세울 수 없습니다';
  END IF;
  EXECUTE format('CREATE VIEW master.parcels AS SELECT * FROM master.%I', live);
END $$;

-- 나대지 MV 다시 — 0131 과 같되 reg_* 넷을 뺀다. 규제는 상세에서 parcels.regulations 로 조인해 온다
CREATE MATERIALIZED VIEW master.vacant_parcels AS
WITH dong AS (
  SELECT DISTINCT ON (bjd_code) bjd_code,
         regexp_replace(addr, '\s+산?[0-9-]+번지$', '') AS dong_nm
    FROM master.buildings
   WHERE bjd_code IS NOT NULL AND addr ~ '\s산?[0-9-]+번지$'
)
SELECT p.pnu,
       d.dong_nm || ' ' || CASE WHEN substr(p.pnu, 11, 1) = '2' THEN '산' ELSE '' END
         || ltrim(substr(p.pnu, 12, 4), '0')
         || CASE WHEN substr(p.pnu, 16, 4) <> '0000'
                 THEN '-' || ltrim(substr(p.pnu, 16, 4), '0') ELSE '' END || '번지' AS addr,
       left(p.pnu, 10) AS bjd_code, left(p.pnu, 5) AS sgg_code,
       p.area, p.jimok, p.land_use, p.use_zone, p.slope, p.shape, p.road_frontage,
       p.legal_bcr, p.legal_far, p.gongsi_latest, p.geom
  FROM master.parcels p
  LEFT JOIN dong d ON d.bjd_code = left(p.pnu, 10)
 WHERE p.geom IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM master.building_parcels bp WHERE bp.pnu = p.pnu);

CREATE UNIQUE INDEX vacant_parcels_pnu ON master.vacant_parcels (pnu);
CREATE INDEX vacant_parcels_geom ON master.vacant_parcels USING GIST (geom);
CREATE INDEX vacant_parcels_bjd ON master.vacant_parcels (bjd_code);

-- 레퍼런스가 0행짜리 칸을 가리키고 있었다(0005): use_zone 의 물리 위치가 'parcels_v1.uqa'
UPDATE ref.fields SET source_ref = 'parcels.use_zone'
 WHERE field_key = 'use_zone' AND source_ref = 'parcels_v1.uqa';

COMMIT;
