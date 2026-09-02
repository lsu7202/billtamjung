-- 대장이 비워둔 건폐율·용적률·건축면적·용적산정연면적을 서로에게서 역산한다(2026-08-27).
--
-- **단독 필지에서만** 채운다. 한 필지에 여러 동이 서 있으면 면적은 그 동 것인데
-- 대지면적은 필지 전체라 비율이 통째로 어긋난다(파이프라인 실측: 50%p 넘게 틀린
-- 35,546건의 98.9%가 다동 필지였다). 그래서 미채움의 대부분은 채우면 안 되는 것이다:
--   용적률 미채움 15,538 중 15,347(98.8%)이 다동 · 건폐율 16,163 중 13,766(85.2%)이 다동.
--
-- 채워지는 것(단독 필지만):
--   용적산정연면적 25,362 · 건폐율 2,397 · 용적률 191 · 건축면적 74
--
-- 계산인지 대장인지는 bcr_src/far_src 가 이미 말한다. 여기서 채운 것은 '역산'으로 적는다.
CREATE OR REPLACE VIEW master.buildings AS
WITH dong AS (   -- PNU 당 동수 — 다동 필지를 가려내는 유일한 재료
  SELECT pnu, count(*) AS n FROM master.buildings_v2 WHERE pnu IS NOT NULL GROUP BY pnu
)
SELECT b.building_pk, b.addr, b.jibun_norm, b.geom, b.land_area, b.total_area,
       b.floors_above, b.floors_below,
       COALESCE(b.bcr, CASE WHEN d.n = 1 AND b.build_area > 0 AND b.land_area > 0
                            THEN round((b.build_area / b.land_area * 100)::numeric, 2) END) AS bcr,
       COALESCE(b.far, CASE WHEN d.n = 1 AND b.far_area > 0 AND b.land_area > 0
                            THEN round((b.far_area / b.land_area * 100)::numeric, 2) END) AS far,
       b.main_use, b.approval_ymd, b.road_addr, b.pnu, b.sgg_code, b.bjd_code,
       b.main_use_name, b.etc_use, b.structure, b.remodel_ymd, b.jimok, b.parcel_area,
       b.land_use, b.use_zone, b.use_zone_mix, b.slope, b.shape, b.road_frontage,
       b.station_dist, b.subway_json, b.bus_json, b.gongsi_latest,
       b.last_sale_ym, b.last_sale_price,
       -- 엘리베이터·주차는 원천이 「없음」을 안 적는다. 0 으로 적힌 행이 한 건도 없다
       -- (실측: elevator 0건 · parking 0건). 그래서 NULL 은 「모른다」가 아니라 「없다」다.
       COALESCE(b.elevator, 0) AS elevator,
       COALESCE(b.parking, 0)  AS parking,
       COALESCE(b.build_area, CASE WHEN d.n = 1 AND b.bcr > 0 AND b.land_area > 0
                                   THEN round((b.bcr / 100 * b.land_area)::numeric, 2) END) AS build_area,
       COALESCE(b.far_area,  CASE WHEN d.n = 1 AND b.far > 0 AND b.land_area > 0
                                   THEN round((b.far / 100 * b.land_area)::numeric, 2) END) AS far_area,
       b.height,
       COALESCE(b.bcr_src, CASE WHEN b.bcr IS NULL AND d.n = 1 AND b.build_area > 0 AND b.land_area > 0
                                THEN '역산' END) AS bcr_src,
       COALESCE(b.far_src, CASE WHEN b.far IS NULL AND d.n = 1 AND b.far_area > 0 AND b.land_area > 0
                                THEN '역산' END) AS far_src
  FROM master.buildings_v2 b
  LEFT JOIN dong d ON d.pnu = b.pnu;
