-- 적정가를 지번 단위로 (2026-10-08 · 스펙 12 §2-2)
--
-- master.parcel_sale_est(pnu) 가 building_sale_est(동) 를 대신한다. 채우는 것은 scripts/rent_estimate/build_sale_est.py.
-- 본매물 = 지번: 연면적 = 지번 동 합 · 대지 = 대표 동에 딸린 필지 합 · 공시총액 = Σ 필지 면적 × 공시.
-- 대장 대지면적은 30% 가 비어 그 지번은 추정가가 없었다(서울 상업 지번 18.5만 중 5.8만).
-- 여러 동 지번을 비우던 규칙(§5-3)은 없어진다 — 동마다 같은 대지를 넣고 돌던 문제가 지번 단위에선 없다.
-- 파생(평단가 · 공시비율)과 모델 매물 표가 지번 값을 읽는다. building_sale_est 는 빌드 뒤 0251 에서 지운다.

BEGIN;

CREATE TABLE IF NOT EXISTS master.parcel_sale_est(
  pnu text PRIMARY KEY, sale_est bigint, per_py bigint, n_comps int,
  land_area numeric, gongsi_total numeric, method text, updated timestamptz DEFAULT now());
COMMENT ON TABLE master.parcel_sale_est IS '지번 적정가(F-17). 연면적 = 지번 동 합 · 대지 = 딸린 필지 합 · 공시총액 = Σ 필지 면적 × 공시';

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
         -- 추정가로 나눈 셋은 지번 값(0250) — 분모도 추정가를 낸 그 면적 · 공시총액(딸린 필지 합). 지번의 모든 동이 같은 값
         CASE WHEN se.land_area > 0 AND se.sale_est > 0 THEN round(se.sale_est * 3.305785 / se.land_area) END,
         CASE WHEN pr.total_area > 0 AND se.sale_est > 0 THEN round(se.sale_est * 3.305785 / pr.total_area) END,
         b.gongsi_latest * b.land_area,
         CASE WHEN se.sale_est > 0 THEN round(se.gongsi_total / se.sale_est::numeric * 100, 2) END,
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
    LEFT JOIN master.parcel_sale_est se ON se.pnu = b.pnu
    LEFT JOIN master.parcel_rep pr ON pr.pnu = b.pnu
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



CREATE OR REPLACE FUNCTION ai.listing_rows(p_team bigint, p_broker boolean)
 RETURNS TABLE("매물ID" bigint, "주인" text, "지번코드" text, "주소" text, "도로명주소" text, "구" text, "동" text, "매매가_원" bigint, "매매가기준일" date, "평단가대지_원평" bigint, "평단가연면적_원평" bigint, "공시비율_pct" numeric, "대지면적_㎡" numeric, "연면적_㎡" numeric, "건축면적_㎡" numeric, "지상층수" integer, "지하층수" integer, "높이_m" numeric, "동수" integer, "주용도" text[], "구조" text, "용도지역" text, "지목" text, "도로접면" text, "지형형상" text, "지세" text, "사용승인일" date, "리모델링일" date, "승강기_대" integer, "주차대수_대" integer, "건폐율_pct" numeric, "용적률_pct" numeric, "법정건폐율_pct" numeric, "법정용적률_pct" numeric, "역거리_m" integer, "전면도로폭_m" numeric, "공시지가_원㎡" bigint, "공시총액_원" bigint, "공시5년상승_pct" numeric, "공시10년상승_pct" numeric, "최근실거래가_원" bigint, "최근실거래월" text, "실거래횟수_건" integer, "추정가_원" bigint, "수집일" date, "광고수" integer, "매물번호" text, "담당자" text, "상태" text, "보류사유" text, "접수일" date, "확인일" date, "매도희망가_원" bigint, "총보증금_원" bigint, "총월임대_원" bigint, "총관리비_원" bigint, "공실면적_㎡" numeric, "대분류" text, "소분류" text, "등급" text, "입지" text, "노후도" text, "시세대비" text, "전속" boolean, "급함" text, "매도의사" text, "명도" text, "용도변경" text, "멸실" text, "소유자유형" text, "관계" text, "협조" text, "친절" text, "매각일" date, "매각금액_원" bigint)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT n.listing_id,
         CASE n.owner WHEN 'mine' THEN '내 매물' WHEN 'crawl' THEN '네이버' ELSE n.office END,
         n.pnu, COALESCE(b.addr, vp.addr), b.road_addr, ri.gu, ri.dong,
         n.price::bigint, n.price_on, n.pp_land::bigint, n.pp_total::bigint, n.gongsi_ratio,
         COALESCE(b.land_area, vp.area), pr.total_area, pr.build_area, pr.floors_above, pr.floors_below, pr.height,
         pr.n_bldg, pr.uses, b.structure, COALESCE(b.use_zone, vp.use_zone), COALESCE(b.jimok, vp.jimok),
         COALESCE(b.road_frontage, vp.road_frontage), COALESCE(b.shape, vp.shape), COALESCE(b.slope, vp.slope),
         b.approval_ymd, b.remodel_ymd, pr.elevator, pr.parking,
         b.bcr, b.far, bl.legal_bcr, bl.legal_far,
         b.station_dist, br.front_m,
         COALESCE(b.gongsi_latest, vp.gongsi_latest), bd.gongsi_total, bd.gongsi_up5, bd.gongsi_up10,
         b.last_sale_price, b.last_sale_ym, sa.sale_cnt::integer,
         se.sale_est::bigint,   -- 지번 추정가(0250) — 여러 동 지번도 값 하나
         lc.seen_on, lc.n_ads,
         l.listing_no, a.name, st.name, l.hold_reason, l.received_on, l.checked_on,
         l.ask_price::bigint, l.total_deposit::bigint, l.total_rent::bigint, l.total_mgmt::bigint, l.vacant_area,
         l.building_major, l.building_use, l.grade, l.ipji, l.nohudo, l.price_vs_market, l.exclusive,
         l.urgency, l.intent, l.meongdo, l.use_change, l.myeolsil,
         ow.owner_type, ow.relation, ow.cooperation, ow.kindness,
         l.sold_on, l.sold_price::bigint
    FROM app.listings_now(p_team, p_broker) n
    LEFT JOIN master.parcel_rep pr ON pr.rep_pk = n.building_pk
    LEFT JOIN master.buildings b ON b.building_pk = pr.rep_pk
    LEFT JOIN master.vacant_parcels vp ON n.building_pk LIKE 'P%' AND vp.pnu = substr(n.building_pk, 2)
    LEFT JOIN master.region_index ri ON ri.bjd_code = COALESCE(b.bjd_code, vp.bjd_code)
    LEFT JOIN master.parcel_sale_est se ON se.pnu = COALESCE(pr.pnu, b.pnu)
    LEFT JOIN master.building_legal bl ON bl.building_pk = b.building_pk
    LEFT JOIN master.building_road br ON br.building_pk = b.building_pk
    LEFT JOIN master.building_derived bd ON bd.building_pk = b.building_pk
    LEFT JOIN master.sales_agg sa ON sa.pnu = COALESCE(pr.pnu, b.pnu)
    LEFT JOIN app.listing_crawl lc ON lc.listing_id = n.listing_id
    -- 관리 칸은 내 사무소 매물에만 붙는다(남의 관리 칸은 안 읽는다)
    LEFT JOIN app.listing_office l ON l.listing_id = n.listing_id AND n.owner = 'mine'
    LEFT JOIN app.accounts a ON a.id = l.assignee_account_id
    LEFT JOIN app.statuses st ON st.id = l.status_id
    LEFT JOIN app.owners ow ON ow.id = l.owner_id AND ow.deleted_at IS NULL
   WHERE NOT n.closed
$function$;


COMMIT;
