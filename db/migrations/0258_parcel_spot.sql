-- 0258 · 검색에 서는 지번(2026-10-08 · 스펙 12 §3)
--
-- 탐색 · 검색은 master.buildings 에서 출발해 대표 동 한 줄로 접고 있었다. 그래서 건물이 없는 지번(나대지)은
-- 줄이 아예 안 섰다. 이 표가 검색의 출발점이다 — 한 줄 = 지번 하나.
--   · 동이 선 지번(parcel_rep)              대표 동의 자리 · 주소
--   · 나대지(vacant_parcels) 중 공공지목 10종 뺀 것   필지 안 한 점 · 필지 주소
-- 다른 건물에 딸린 필지(building_parcels 부속)는 줄을 안 세운다 — 그 건물 지번에 이미 들어 있다.
-- 땅 값(지목 · 용도지역 · 공시 · 형상 …)은 지번 원장(parcels)에서, 법정 건폐 · 용적은 동이 있으면
-- building_legal(토지이음 산식 · 걸침 처리), 나대지는 필지 값이 하나일 때만(병기면 비움).
-- 대장 재적재 · parcel_rep REFRESH 뒤에 같이 REFRESH 한다(pipeline/units.py).
BEGIN;

CREATE MATERIALIZED VIEW master.parcel_spot AS
SELECT pr.pkey, pr.pnu, pr.rep_pk,
       b.geom, b.bjd_code, b.addr, b.road_addr,
       COALESCE(p.jimok, b.jimok) AS jimok, COALESCE(p.land_use, b.land_use) AS land_use,
       COALESCE(p.use_zone, b.use_zone) AS use_zone, COALESCE(p.slope, b.slope) AS slope,
       COALESCE(p.shape, b.shape) AS shape, COALESCE(p.road_frontage, b.road_frontage) AS road_frontage,
       COALESCE(p.gongsi_latest, b.gongsi_latest) AS gongsi_latest,
       COALESCE(p.area, b.parcel_area) AS parcel_area,
       bl.legal_bcr, bl.legal_far
  FROM master.parcel_rep pr
  JOIN master.buildings b ON b.building_pk = pr.rep_pk
  LEFT JOIN master.parcels p ON p.pnu = pr.pnu
  LEFT JOIN master.building_legal bl ON bl.building_pk = pr.rep_pk
UNION ALL
SELECT v.pnu, v.pnu, NULL,
       ST_PointOnSurface(v.geom), v.bjd_code, v.addr, NULL,
       p.jimok, p.land_use, p.use_zone, p.slope, p.shape, p.road_frontage, p.gongsi_latest, p.area,
       CASE WHEN cardinality(p.legal_bcr) = 1 THEN p.legal_bcr[1] END,
       CASE WHEN cardinality(p.legal_far) = 1 THEN p.legal_far[1] END
  FROM master.vacant_parcels v
  JOIN master.parcels p ON p.pnu = v.pnu
 WHERE COALESCE(p.jimok, '') NOT IN ('공원', '도로', '하천', '제방', '구거', '유지', '철도용지', '묘지', '수도용지', '사적지');

CREATE UNIQUE INDEX parcel_spot_pkey ON master.parcel_spot(pkey);
CREATE INDEX parcel_spot_pnu ON master.parcel_spot(pnu);
CREATE INDEX parcel_spot_rep ON master.parcel_spot(rep_pk);
CREATE INDEX parcel_spot_geom ON master.parcel_spot USING gist(geom);
CREATE INDEX parcel_spot_bjd ON master.parcel_spot(bjd_code text_pattern_ops);
CREATE INDEX parcel_spot_use_zone ON master.parcel_spot(use_zone);
CREATE INDEX parcel_spot_dong_jibun ON master.parcel_spot(master.dong_jibun(addr) text_pattern_ops);
CREATE INDEX parcel_spot_road_key ON master.parcel_spot(master.road_key(road_addr));
CREATE INDEX parcel_spot_addr_trgm ON master.parcel_spot USING gin(addr gin_trgm_ops);
COMMENT ON MATERIALIZED VIEW master.parcel_spot IS '검색 출발점 — 지번 하나에 한 줄(동이 선 지번 + 공공지목 뺀 나대지). 땅 값 · 자리 · 법정치';

COMMIT;
