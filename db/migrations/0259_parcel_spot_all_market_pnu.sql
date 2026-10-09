-- 0259 · 지번 표를 「모든 지번」으로 · 매매시세 열쇠를 지번으로 · 부속 지번 → 본 지번(2026-10-09)
--
-- ① parcel_spot(0258)은 검색용이라 공공지목 나대지(도로 · 하천 …)를 뺐다. 그래서 화면 조회(주소 · 면적)에
--    쓰면 그런 지번의 매물은 주소가 빈다. 모든 지번(동이 선 지번 + 나대지 전부)을 싣고 public_land 칸을 둔다.
--    검색만 그 칸으로 거른다. parcel_addr 도 이 표 하나를 본다(대표 동 · 나대지 두 길을 따로 타지 않는다).
-- ② 매매시세(market_sale)는 통매라 지번이 열쇠다. 건물 번호로 붙이고 나대지 토지 광고는 'P' + 지번으로
--    붙이던 것(load_market)을 걷는다. 건물이 대장에서 사라졌으면 옛 필지 연결로 지번을 찾고, 그래도 못 찾는
--    크롤 시세는 버린다(2026-10-03 수집 2줄 — 지적도에 없는 지번의 네이버 매물 3378 · 4047 과 같은 광고).
-- ③ 다른 건물에 딸린 필지(부속 지번)는 그 건물의 지번으로 읽는다 — 지도 클릭(parcel-at)과 매물 등록이 같은 규칙.
BEGIN;

-- ① ───────────────────────────────────────────────────────────────
DROP MATERIALIZED VIEW master.parcel_spot;
CREATE MATERIALIZED VIEW master.parcel_spot AS
SELECT pr.pkey, pr.pnu, pr.rep_pk,
       b.geom, b.bjd_code, b.addr, b.road_addr,
       COALESCE(p.jimok, b.jimok) AS jimok, COALESCE(p.land_use, b.land_use) AS land_use,
       COALESCE(p.use_zone, b.use_zone) AS use_zone, COALESCE(p.slope, b.slope) AS slope,
       COALESCE(p.shape, b.shape) AS shape, COALESCE(p.road_frontage, b.road_frontage) AS road_frontage,
       COALESCE(p.gongsi_latest, b.gongsi_latest) AS gongsi_latest,
       COALESCE(p.area, b.parcel_area) AS parcel_area,
       bl.legal_bcr, bl.legal_far,
       false AS public_land
  FROM master.parcel_rep pr
  JOIN master.buildings b ON b.building_pk = pr.rep_pk
  LEFT JOIN master.parcels p ON p.pnu = pr.pnu
  LEFT JOIN master.building_legal bl ON bl.building_pk = pr.rep_pk
UNION ALL
SELECT v.pnu, v.pnu, NULL,
       ST_PointOnSurface(v.geom), v.bjd_code, v.addr, NULL,
       p.jimok, p.land_use, p.use_zone, p.slope, p.shape, p.road_frontage, p.gongsi_latest, p.area,
       CASE WHEN cardinality(p.legal_bcr) = 1 THEN p.legal_bcr[1] END,
       CASE WHEN cardinality(p.legal_far) = 1 THEN p.legal_far[1] END,
       COALESCE(p.jimok, '') IN ('공원', '도로', '하천', '제방', '구거', '유지', '철도용지', '묘지', '수도용지', '사적지')
  FROM master.vacant_parcels v
  JOIN master.parcels p ON p.pnu = v.pnu;

CREATE UNIQUE INDEX parcel_spot_pkey ON master.parcel_spot(pkey);
CREATE INDEX parcel_spot_pnu ON master.parcel_spot(pnu);
CREATE INDEX parcel_spot_rep ON master.parcel_spot(rep_pk);
CREATE INDEX parcel_spot_geom ON master.parcel_spot USING gist(geom);
CREATE INDEX parcel_spot_bjd ON master.parcel_spot(bjd_code text_pattern_ops);
CREATE INDEX parcel_spot_use_zone ON master.parcel_spot(use_zone);
CREATE INDEX parcel_spot_dong_jibun ON master.parcel_spot(master.dong_jibun(addr) text_pattern_ops);
CREATE INDEX parcel_spot_road_key ON master.parcel_spot(master.road_key(road_addr));
CREATE INDEX parcel_spot_addr_trgm ON master.parcel_spot USING gin(addr gin_trgm_ops);
COMMENT ON MATERIALIZED VIEW master.parcel_spot IS
  '지번 하나에 한 줄(동이 선 지번 + 나대지 전부). 땅 값 · 자리 · 법정치. 검색은 public_land(공공지목 나대지)를 거른다';

CREATE OR REPLACE FUNCTION app.parcel_addr(p_pnu text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT addr FROM master.parcel_spot WHERE pnu = p_pnu
$$;

-- ③ ───────────────────────────────────────────────────────────────
-- 지번 → 줄이 서는 지번. 동이 선 지번 · 나대지면 그대로, 부속 지번이면 그 건물(연면적 큰 것)의 지번
CREATE OR REPLACE FUNCTION app.main_pnu(p_pnu text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT s.pnu FROM master.parcel_spot s WHERE s.pnu = p_pnu),
    (SELECT b.pnu FROM master.building_parcels bp JOIN master.buildings b ON b.building_pk = bp.building_pk
      WHERE bp.pnu = p_pnu AND b.pnu IS NOT NULL ORDER BY b.total_area DESC NULLS LAST, b.building_pk LIMIT 1),
    p_pnu)
$$;

-- ② ───────────────────────────────────────────────────────────────
CREATE TABLE master.market_sale_new (
  pnu          text NOT NULL,
  observed_on  date NOT NULL,                  -- 우리가 수집한 날 — 시계열의 키
  price        bigint NOT NULL,                -- 그날 그 지번 광고 중 가장 싼 매매가(원)
  posted_on    date,
  n_ads        int NOT NULL,                   -- 그날 같은 지번 광고 수
  land_area    numeric,
  total_area   numeric,
  use_type     text,
  PRIMARY KEY (pnu, observed_on));
INSERT INTO master.market_sale_new
SELECT DISTINCT ON (x.pnu, x.observed_on)
       x.pnu, x.observed_on, x.price, x.posted_on,
       sum(x.n_ads) OVER (PARTITION BY x.pnu, x.observed_on)::int,
       x.land_area, x.total_area, x.use_type
  FROM (SELECT COALESCE(b.pnu,
                        (SELECT bp.pnu FROM master.building_parcels bp WHERE bp.building_pk = s.building_pk
                          ORDER BY bp.role = '대표' DESC, bp.pnu LIMIT 1)) AS pnu, s.*
          FROM master.market_sale s LEFT JOIN master.buildings b ON b.building_pk = s.building_pk) x
 WHERE x.pnu IS NOT NULL
 ORDER BY x.pnu, x.observed_on, x.price, x.posted_on DESC NULLS LAST;
DROP TABLE master.market_sale;
ALTER TABLE master.market_sale_new RENAME TO market_sale;
ALTER INDEX master.market_sale_new_pkey RENAME TO market_sale_pkey;

COMMIT;
