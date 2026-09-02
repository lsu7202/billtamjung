-- 0139 · 엘리베이터·주차의 「모름」을 0으로 바꾸지 않는다 (2026-08-28)
--
-- master.buildings 뷰가 COALESCE(elevator, 0) · COALESCE(parking, 0) 으로 채우고 있었다.
-- 그런데 **대장에 0으로 적힌 동은 한 건도 없다** — 전부 NULL 아니면 양수다:
--     엘리베이터  NULL 465,597 · 0  0건 · 양수 118,859
--     주차        NULL 342,173 · 0  0건 · 양수 242,242
-- 대장은 「없음」을 0으로 적지 않고 그냥 비운다. 그걸 0으로 바꾸면 「엘리베이터 없는 건물」과
-- 「대장에 안 적힌 건물」이 한 덩어리가 되고, 서울 건물의 80%가 엘리베이터 0대로 선다.
-- CLAUDE.md 「미지정은 null · 기본값을 지어내지 않는다」가 이 자리다.
--
-- 엘리베이터는 정본이 둘이다(대장 + 한국승강기안전공단). 대장이 빈 동은
-- scripts/elevator/fill_elevator.py 가 승강기공단으로 채운다 — 0 으로 덮는 것과 다른 일이다.

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
    b.elevator,
    b.parking,
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
