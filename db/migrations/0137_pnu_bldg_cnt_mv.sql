-- 0137 · master.buildings 뷰에서 58만행 집계를 걷어낸다 (2026-08-28)
--
-- 뷰 안에 이런 CTE 가 박혀 있었다:
--     WITH dong AS (SELECT pnu, count(*) FROM buildings_v2 GROUP BY pnu)
-- 한 필지에 건물이 몇 채인지 세어 「단독 필지만 건폐/용적 역산」에 쓰는 값인데(0135),
-- 뷰를 건드릴 때마다 buildings_v2 58만 행을 통째로 Seq Scan + HashAggregate 했다.
-- 내 매물 5건을 뽑는 검색이 4.4초 걸린 원인이 이것이다(EXPLAIN: Seq Scan rows=584794).
--
-- 같은 값을 MV 로 빼고 뷰는 조인만 한다. 원천이 바뀌면 파이프라인이 REFRESH 한다.

CREATE MATERIALIZED VIEW IF NOT EXISTS master.pnu_bldg_cnt AS
  SELECT pnu, count(*)::int AS n FROM master.buildings_v2 WHERE pnu IS NOT NULL GROUP BY pnu;

CREATE UNIQUE INDEX IF NOT EXISTS pnu_bldg_cnt_pnu_uix ON master.pnu_bldg_cnt (pnu);

COMMENT ON MATERIALIZED VIEW master.pnu_bldg_cnt IS
  '필지당 건물 동수 — master.buildings 뷰의 건폐/용적 역산 판정용. 적재 후 REFRESH CONCURRENTLY.';

CREATE OR REPLACE VIEW master.buildings AS
SELECT b.building_pk,
    b.addr,
    b.jibun_norm,
    b.geom,
    b.land_area,
    b.total_area,
    b.floors_above,
    b.floors_below,
    COALESCE(b.bcr,
        CASE
            WHEN d.n = 1 AND b.build_area > 0::numeric AND b.land_area > 0::numeric THEN round(b.build_area / b.land_area * 100::numeric, 2)
            ELSE NULL::numeric
        END) AS bcr,
    COALESCE(b.far,
        CASE
            WHEN d.n = 1 AND b.far_area > 0::numeric AND b.land_area > 0::numeric THEN round(b.far_area / b.land_area * 100::numeric, 2)
            ELSE NULL::numeric
        END) AS far,
    b.main_use,
    b.approval_ymd,
    b.road_addr,
    b.pnu,
    b.sgg_code,
    b.bjd_code,
    b.main_use_name,
    b.etc_use,
    b.structure,
    b.remodel_ymd,
    b.jimok,
    b.parcel_area,
    b.land_use,
    b.use_zone,
    b.use_zone_mix,
    b.slope,
    b.shape,
    b.road_frontage,
    b.station_dist,
    b.subway_json,
    b.bus_json,
    b.gongsi_latest,
    b.last_sale_ym,
    b.last_sale_price,
    COALESCE(b.elevator, 0) AS elevator,
    COALESCE(b.parking, 0) AS parking,
    COALESCE(b.build_area,
        CASE
            WHEN d.n = 1 AND b.bcr > 0::numeric AND b.land_area > 0::numeric THEN round(b.bcr / 100::numeric * b.land_area, 2)
            ELSE NULL::numeric
        END) AS build_area,
    COALESCE(b.far_area,
        CASE
            WHEN d.n = 1 AND b.far > 0::numeric AND b.land_area > 0::numeric THEN round(b.far / 100::numeric * b.land_area, 2)
            ELSE NULL::numeric
        END) AS far_area,
    b.height,
    COALESCE(b.bcr_src,
        CASE
            WHEN b.bcr IS NULL AND d.n = 1 AND b.build_area > 0::numeric AND b.land_area > 0::numeric THEN '역산'::text
            ELSE NULL::text
        END) AS bcr_src,
    COALESCE(b.far_src,
        CASE
            WHEN b.far IS NULL AND d.n = 1 AND b.far_area > 0::numeric AND b.land_area > 0::numeric THEN '역산'::text
            ELSE NULL::text
        END) AS far_src
   FROM master.buildings_v2 b
     LEFT JOIN master.pnu_bldg_cnt d ON d.pnu = b.pnu;
