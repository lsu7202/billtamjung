-- 대장으로 센 매물 유형(building_derived.use_kind, 0193)을 지운다 (2026-10-08 · 0246 뒤)
--
-- 매물유형은 팀이 고른 대분류, 없으면 네이버 유형이다. 실거래는 신고 갈래(trade.trade_type)로 본다.
-- 대장으로 센 근사값은 어느 쪽에도 안 쓰기로 했다(같은 건물이 대장 · 네이버 · 실거래에서 다 다르다).
-- 읽던 곳(검색 실거래 필터 · 매물유형 대체값 · 매매시세 핀 · 광고 초안 · 모델 사전)은 같은 커밋에서 걷었다.
--
-- trade_whole 에 실거래 유형 · 원천 용도를 뒤에 덧붙인다(주변 실거래 응답이 싣는다). 정의는 그대로 통매만.

BEGIN;

CREATE OR REPLACE FUNCTION master.refresh_building_derived_core()
 RETURNS bigint
 LANGUAGE sql
AS $function$
  WITH g5 AS (SELECT pnu, price FROM master.gongsi_series WHERE year = EXTRACT(YEAR FROM CURRENT_DATE)::int - 5),
       g10 AS (SELECT pnu, price FROM master.gongsi_series WHERE year = EXTRACT(YEAR FROM CURRENT_DATE)::int - 10),
  ins AS (
  INSERT INTO master.building_derived AS d
    (building_pk, pp_land, pp_total, gongsi_total, gongsi_ratio, gongsi_up5, gongsi_up10,
     sale_pnl, bcr_slack, far_slack, road_score, station_score, updated)
  SELECT b.building_pk,
         CASE WHEN b.land_area > 0 AND se.sale_est > 0 THEN round(se.sale_est * 3.305785 / b.land_area) END,
         CASE WHEN b.total_area > 0 AND se.sale_est > 0 THEN round(se.sale_est * 3.305785 / b.total_area) END,
         b.gongsi_latest * b.land_area,
         CASE WHEN se.sale_est > 0 THEN round((b.gongsi_latest * b.land_area) / se.sale_est::numeric * 100, 2) END,
         CASE WHEN g5.price > 0 THEN round((b.gongsi_latest - g5.price) / g5.price::numeric * 100, 2) END,
         CASE WHEN g10.price > 0 THEN round((b.gongsi_latest - g10.price) / g10.price::numeric * 100, 2) END,
         CASE WHEN sa.p_prev > 0 THEN round((sa.p_last - sa.p_prev) / sa.p_prev::numeric * 100, 2) END,
         -- 여유분: 법정 − 현재. 현재는 대장, 대장이 비면 계산값(building_calc, 0143). 0에서 끊는다.
         CASE WHEN bl.legal_bcr IS NOT NULL AND COALESCE(b.bcr, bc.bcr_calc) IS NOT NULL
              THEN GREATEST(0, bl.legal_bcr - COALESCE(b.bcr, bc.bcr_calc)) END,
         CASE WHEN bl.legal_far IS NOT NULL AND COALESCE(b.far, bc.far_calc) IS NOT NULL
              THEN GREATEST(0, bl.legal_far - COALESCE(b.far, bc.far_calc)) END,
         CASE b.road_frontage WHEN '광대소각' THEN 90 WHEN '광대세각' THEN 83 WHEN '광대로한면' THEN 76
              WHEN '중로각지' THEN 69 WHEN '중로한면' THEN 54 WHEN '소로각지' THEN 51 WHEN '소로한면' THEN 32
              WHEN '세로각지(가)' THEN 28 WHEN '세로한면(가)' THEN 17 WHEN '세로각지(불)' THEN 10
              WHEN '세로한면(불)' THEN 3 WHEN '맹지' THEN 0 ELSE 0 END,
         CASE WHEN b.station_dist IS NULL THEN 0
              WHEN GREATEST(0, b.station_dist-100) <= 10 THEN 100 WHEN GREATEST(0, b.station_dist-100) <= 80 THEN 90
              WHEN GREATEST(0, b.station_dist-100) <= 160 THEN 85 WHEN GREATEST(0, b.station_dist-100) <= 240 THEN 78
              WHEN GREATEST(0, b.station_dist-100) <= 320 THEN 68 WHEN GREATEST(0, b.station_dist-100) <= 400 THEN 58
              WHEN GREATEST(0, b.station_dist-100) <= 480 THEN 40 WHEN GREATEST(0, b.station_dist-100) <= 560 THEN 28
              WHEN GREATEST(0, b.station_dist-100) <= 640 THEN 18 WHEN GREATEST(0, b.station_dist-100) <= 720 THEN 10
              WHEN GREATEST(0, b.station_dist-100) <= 800 THEN 4 ELSE 0 END,
         now()
    FROM master.buildings b
    LEFT JOIN master.building_sale_est se ON se.building_pk = b.building_pk
    LEFT JOIN master.building_calc bc ON bc.building_pk = b.building_pk
    LEFT JOIN master.building_legal bl ON bl.building_pk = b.building_pk
    LEFT JOIN master.sales_agg sa ON sa.pnu = b.pnu
    LEFT JOIN g5 ON g5.pnu = b.pnu
    LEFT JOIN g10 ON g10.pnu = b.pnu
  ON CONFLICT (building_pk) DO UPDATE SET
    pp_land=EXCLUDED.pp_land, pp_total=EXCLUDED.pp_total,
    gongsi_total=EXCLUDED.gongsi_total, gongsi_ratio=EXCLUDED.gongsi_ratio,
    gongsi_up5=EXCLUDED.gongsi_up5, gongsi_up10=EXCLUDED.gongsi_up10, sale_pnl=EXCLUDED.sale_pnl,
    bcr_slack=EXCLUDED.bcr_slack, far_slack=EXCLUDED.far_slack,
    road_score=EXCLUDED.road_score, station_score=EXCLUDED.station_score, updated=now()
  RETURNING 1)
  SELECT count(*) FROM ins;
$function$;


ALTER TABLE master.building_derived DROP COLUMN IF EXISTS use_kind;

CREATE OR REPLACE VIEW master.trade_whole AS
SELECT t.id AS trade_id, m.pnu, t.kind, t.contract_ym, t.contract_day, t.price_won AS price,
       t.total_area, t.land_area, t.build_year, t.trade_type, COALESCE(t.main_use, t.trade_type) AS use_label
  FROM master.trade t
  JOIN master.trade_match m ON m.trade_id = t.id
 WHERE m.method = '전부일치' AND t.canceled_on IS NULL AND t.price_won > 0;

COMMIT;
