-- 0174 · 검색 파생값을 저장한다 — 읽을 때 계산하는 값은 없다 (2026-09-17)
--
-- 왜: 검색(search.py)이 줄마다 열넷을 읽을 때 계산했다. 추정 수익률·평단가·공시비율·공시 상승률·
--     실거래 등락·건폐/용적 여유·도로/역 점수. 재료는 전부 파이프라인이 만든 마스터 값이라 원천이
--     갱신될 때만 바뀌는데, 검색마다 다시 나눴다. 대표: 「모두 저장돼서 움직임. 실시간 계산이 아니라」.
--     같은 산식이 검색·상세·보고서에 따로 박히면 값이 어긋난다(법정 용적률 18,289동 사고, 0153).
--
-- 무엇: master.building_derived 한 표. 산식은 아래 함수 **한 벌**(master.refresh_building_derived)이고
--       파이프라인 파생 단계(building_derived)가 부른다. 검색은 칸을 읽기만 한다.
--       팀 값에서 나오는 셋(pp_land_team·pp_total_team·gongsi_ratio_team)은 매물 줄(listings)에 두고
--       mirror.listing_values_fold 가 팀이 값을 적을 때 접는다(0173 과 같은 길).

CREATE TABLE IF NOT EXISTS master.building_derived (
  building_pk   text PRIMARY KEY,
  roi_est       numeric(6,2),   -- 추정 연임대 ÷ 추정가 (%)
  pp_land       bigint,         -- 추정가 ÷ 대지면적 (원/평)
  pp_total      bigint,         -- 추정가 ÷ 연면적 (원/평)
  gongsi_total  numeric,        -- 공시지가 × 대지면적 (원)
  gongsi_ratio  numeric(6,2),   -- 공시총액 ÷ 추정가 (%)
  gongsi_up5    numeric(8,2),   -- 5년 전 대비 공시지가 상승 (%)
  gongsi_up10   numeric(8,2),   -- 10년 전 대비 (%)
  sale_pnl      numeric(8,2),   -- 최근 실거래 vs 직전 (%)
  bcr_slack     numeric(6,2),   -- 법정 − 현재 건폐율, 0에서 끊음
  far_slack     numeric(8,2),   -- 법정 − 현재 용적률, 0에서 끊음
  road_score    smallint,       -- 도로접면 점수표
  station_score smallint,       -- 역거리 점수표
  updated       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE master.building_derived IS
  '검색 파생값(배치). 산식은 master.refresh_building_derived() 한 벌. 읽는 쪽은 계산하지 않는다. 0174';

CREATE OR REPLACE FUNCTION master.refresh_building_derived() RETURNS bigint
LANGUAGE sql AS $$
  WITH g5 AS (SELECT pnu, price FROM master.gongsi_series WHERE year = EXTRACT(YEAR FROM CURRENT_DATE)::int - 5),
       g10 AS (SELECT pnu, price FROM master.gongsi_series WHERE year = EXTRACT(YEAR FROM CURRENT_DATE)::int - 10),
  ins AS (
  INSERT INTO master.building_derived AS d
    (building_pk, roi_est, pp_land, pp_total, gongsi_total, gongsi_ratio, gongsi_up5, gongsi_up10,
     sale_pnl, bcr_slack, far_slack, road_score, station_score, updated)
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
    road_score=EXCLUDED.road_score, station_score=EXCLUDED.station_score, updated=now()
  RETURNING 1)
  SELECT count(*) FROM ins;
$$;

-- 팀 값에서 나오는 파생 셋 — 매물 줄에(0173 과 같은 자리)
ALTER TABLE app.listings
  ADD COLUMN IF NOT EXISTS pp_land_team      bigint,         -- 팀 매매가 ÷ 대지면적 (원/평)
  ADD COLUMN IF NOT EXISTS pp_total_team     bigint,         -- 팀 매매가 ÷ 연면적 (원/평)
  ADD COLUMN IF NOT EXISTS gongsi_ratio_team numeric(6,2);   -- 공시총액 ÷ 팀 매매가 (%)

-- 채운다(첫 한 번). 이후는 파이프라인 파생 단계(building_derived)와 mirror 가 한다.
SELECT master.refresh_building_derived();

UPDATE app.listings l
   SET pp_land_team      = CASE WHEN b.land_area > 0 AND l.sale_price > 0 THEN round(l.sale_price * 3.305785 / b.land_area) END,
       pp_total_team     = CASE WHEN b.total_area > 0 AND l.sale_price > 0 THEN round(l.sale_price * 3.305785 / b.total_area) END,
       gongsi_ratio_team = CASE WHEN l.sale_price > 0 THEN round((b.gongsi_latest * b.land_area) / l.sale_price::numeric * 100, 2) END
  FROM master.buildings b WHERE b.building_pk = l.building_pk;
