-- 0131 나대지 검색 — 건물이 없는 「대」 필지도 찾을 수 있게(2026-08-27)
--
-- 지금까지 검색은 master.buildings 만 봤다. 건물이 서 있어야만 찾아지는 셈인데,
-- 중개인이 찾는 것 중에 **빈 땅**이 있다. 건물이 없다는 것은 신축이 된다는 뜻이고,
-- 그건 없는 정보가 아니라 그 자체로 팔 거리다.
--
-- 서울 필지 898,944개 중 건물이 없는 것이 332,180개(37%)인데, 그 대부분은
-- 도로(140,497)·임야(18,229)·하천(8,732)이라 매물이 아니다.
-- 지목이 「대」인 것만 107,442개 — 이것이 나대지다.
--
-- 필지에는 주소가 없고 PNU 만 있다. PNU 19자리는 주소와 일대일이라 조립할 수 있다:
--   [0:10] 법정동코드 · [10] 1=일반/2=산 · [11:15] 본번 · [15:19] 부번
-- 법정동코드 → 동 이름은 buildings.addr 에서 얻는다(같은 동에 건물이 하나라도 있으면 된다).

CREATE MATERIALIZED VIEW IF NOT EXISTS master.vacant_parcels AS
WITH dong AS (
  -- 법정동코드 → 「서울특별시 종로구 내수동」. 지번을 뗀 앞부분이 동 이름이다.
  -- 같은 코드에 여러 주소가 있어도 앞부분은 같으므로 아무거나 하나 쓴다.
  SELECT DISTINCT ON (bjd_code)
         bjd_code,
         regexp_replace(addr, '\s+산?[0-9-]+번지$', '') AS dong_nm
    FROM master.buildings
   WHERE bjd_code IS NOT NULL AND addr ~ '\s산?[0-9-]+번지$'
)
SELECT p.pnu,
       d.dong_nm || ' '
         || CASE WHEN substr(p.pnu, 11, 1) = '2' THEN '산' ELSE '' END
         || ltrim(substr(p.pnu, 12, 4), '0')
         || CASE WHEN ltrim(substr(p.pnu, 16, 4), '0') <> ''
                 THEN '-' || ltrim(substr(p.pnu, 16, 4), '0') ELSE '' END
         || '번지'                                    AS addr,
       d.bjd_code,
       substr(p.pnu, 1, 5)                            AS sgg_code,
       p.geom,
       p.area, p.jimok, p.land_use, p.use_zone, p.slope, p.shape,
       p.road_frontage, p.legal_bcr, p.legal_far, p.gongsi_latest,
       p.reg_godo, p.reg_district, p.reg_jeongbi, p.reg_gyeong
  FROM master.parcels p
  JOIN dong d ON d.bjd_code = substr(p.pnu, 1, 10)
 WHERE p.building_pk IS NULL
   AND p.jimok = '대'          -- 도로·임야·하천은 매물이 아니다
   AND p.geom IS NOT NULL
   AND ltrim(substr(p.pnu, 12, 4), '0') <> '';   -- 본번 0 = 조립 불가(원천 이상)

CREATE UNIQUE INDEX IF NOT EXISTS vacant_parcels_pnu_uix ON master.vacant_parcels (pnu);
CREATE INDEX IF NOT EXISTS vacant_parcels_geom_gix ON master.vacant_parcels USING GIST (geom);
CREATE INDEX IF NOT EXISTS vacant_parcels_geog_gix ON master.vacant_parcels USING GIST ((geom::geography));

-- 검색용 — buildings 와 같은 어법(dong_jibun 접두 · jibun_norm 부분일치)을 쓴다.
-- 두 곳을 UNION 하므로 자·인덱스가 같아야 한 번에 훑는다.
CREATE INDEX IF NOT EXISTS vacant_parcels_dj_idx
  ON master.vacant_parcels (master.dong_jibun(addr) text_pattern_ops);
CREATE INDEX IF NOT EXISTS vacant_parcels_jn_trgm
  ON master.vacant_parcels USING GIN (
    (replace(replace(addr, '서울특별시 ', ''), '번지', '')) gin_trgm_ops);
