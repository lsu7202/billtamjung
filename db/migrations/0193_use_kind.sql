-- 0193 매물 유형 하나로(2026-09-28 대표) — 빌딩 · 상가주택 · 공장·창고 · 숙박 · 기타
--
-- 같은 낱말을 세 곳이 쓴다. 값이 오는 곳만 다르다.
--   내 매물   app.listings.building_major (매물관리 대분류 — 통사옥은 빌딩으로)
--   광고      app.ads.use_type (광고 폼에서 중개사가 고름 · 대분류로 미리 채움)
--   그 밖     master.building_derived.use_kind (대장으로 셈 · 파이프라인 파생 단계가 유지)
-- 공동주택 · 단독주택(상가주택 아님)은 어느 유형도 아니다(null) — 통매매 대상이 아니다.
BEGIN;

-- 대분류 사전 — 통사옥 → 빌딩, 공장·창고 · 숙박 추가
UPDATE ref.enums SET code = '빌딩', label = '빌딩', sort_order = 10 WHERE enum_key = 'building_major' AND code = '통사옥';
UPDATE ref.enums SET sort_order = 20 WHERE enum_key = 'building_major' AND code = '상가주택';
UPDATE ref.enums SET sort_order = 50 WHERE enum_key = 'building_major' AND code = '기타';
INSERT INTO ref.enums(enum_key, code, label, sort_order) VALUES
  ('building_major', '공장·창고', '공장·창고', 30), ('building_major', '숙박', '숙박', 40)
ON CONFLICT DO NOTHING;
UPDATE ref.enum_groups SET label = '매물 유형' WHERE enum_key = 'building_major';
UPDATE app.listings SET building_major = '빌딩' WHERE building_major = '통사옥';

-- 광고의 매물 유형
ALTER TABLE app.ads ADD COLUMN IF NOT EXISTS use_type text
  CHECK (use_type IN ('빌딩','상가주택','공장·창고','숙박','기타'));

-- 대장으로 센 유형 — 파생값 표에 저장(읽을 때 계산하지 않는다)
ALTER TABLE master.building_derived ADD COLUMN IF NOT EXISTS use_kind text;
CREATE OR REPLACE FUNCTION master.refresh_building_derived()
 RETURNS bigint
 LANGUAGE sql
AS $function$
  WITH g5 AS (SELECT pnu, price FROM master.gongsi_series WHERE year = EXTRACT(YEAR FROM CURRENT_DATE)::int - 5),
       g10 AS (SELECT pnu, price FROM master.gongsi_series WHERE year = EXTRACT(YEAR FROM CURRENT_DATE)::int - 10),
  ins AS (
  INSERT INTO master.building_derived AS d
    (building_pk, roi_est, pp_land, pp_total, gongsi_total, gongsi_ratio, gongsi_up5, gongsi_up10,
     sale_pnl, bcr_slack, far_slack, road_score, station_score, use_kind, updated)
  SELECT b.building_pk,
         CASE WHEN re.annual_rent > 0 AND se.sale_est > 0
              THEN round(re.annual_rent::numeric / se.sale_est * 100, 2) END,
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
         -- 매물 유형(0193) — 광고 · 매물관리 대분류와 같은 낱말. 대장으로 센 근사값이다(상가주택은 기타용도 · 토지이용상황으로)
         CASE
           WHEN b.main_use_name ~ '공장|창고' THEN '공장·창고'
           WHEN b.main_use_name ~ '숙박' THEN '숙박'
           WHEN b.main_use_name ~ '근린생활|판매|업무|위락' THEN '빌딩'
           WHEN b.main_use_name ~ '단독주택|다가구'
                AND (COALESCE(b.etc_use,'') ~ '근린생활|판매|업무|소매점|사무소|일반음식점|휴게음식점'
                     OR COALESCE(b.land_use,'') ~ '상업|주상') THEN '상가주택'
           WHEN b.main_use_name IS NULL OR b.main_use_name ~ '단독주택|다가구|공동주택|아파트|다세대|연립|다중주택' THEN NULL
           ELSE '기타' END,
         now()
    FROM master.buildings b
    LEFT JOIN master.building_sale_est se ON se.building_pk = b.building_pk
    LEFT JOIN master.building_rent_est re ON re.building_pk = b.building_pk
    LEFT JOIN master.building_calc bc ON bc.building_pk = b.building_pk
    LEFT JOIN master.building_legal bl ON bl.building_pk = b.building_pk
    LEFT JOIN master.sales_agg sa ON sa.building_pk = b.building_pk
    LEFT JOIN g5 ON g5.pnu = b.pnu
    LEFT JOIN g10 ON g10.pnu = b.pnu
  ON CONFLICT (building_pk) DO UPDATE SET
    roi_est=EXCLUDED.roi_est, pp_land=EXCLUDED.pp_land, pp_total=EXCLUDED.pp_total,
    gongsi_total=EXCLUDED.gongsi_total, gongsi_ratio=EXCLUDED.gongsi_ratio,
    gongsi_up5=EXCLUDED.gongsi_up5, gongsi_up10=EXCLUDED.gongsi_up10, sale_pnl=EXCLUDED.sale_pnl,
    bcr_slack=EXCLUDED.bcr_slack, far_slack=EXCLUDED.far_slack,
    road_score=EXCLUDED.road_score, station_score=EXCLUDED.station_score, use_kind=EXCLUDED.use_kind, updated=now()
  RETURNING 1)
  SELECT count(*) FROM ins;
$function$;

UPDATE master.building_derived d SET use_kind = CASE
           WHEN b.main_use_name ~ '공장|창고' THEN '공장·창고'
           WHEN b.main_use_name ~ '숙박' THEN '숙박'
           WHEN b.main_use_name ~ '근린생활|판매|업무|위락' THEN '빌딩'
           WHEN b.main_use_name ~ '단독주택|다가구'
                AND (COALESCE(b.etc_use,'') ~ '근린생활|판매|업무|소매점|사무소|일반음식점|휴게음식점'
                     OR COALESCE(b.land_use,'') ~ '상업|주상') THEN '상가주택'
           WHEN b.main_use_name IS NULL OR b.main_use_name ~ '단독주택|다가구|공동주택|아파트|다세대|연립|다중주택' THEN NULL
           ELSE '기타' END
  FROM master.buildings b WHERE b.building_pk = d.building_pk;

COMMIT;
