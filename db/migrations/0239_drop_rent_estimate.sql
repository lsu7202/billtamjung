-- 추정임대 · 추정수익률 · 만실 추정 채우기 삭제 (2026-10-07 대표)
--
-- ## 왜
-- 추정임대(층별 · 건물)는 오차가 커서(백테스트 28.8%) 지금 단계에선 뜻이 없고, 사업에서 차지하는 몫도 작다고 판명됐다.
-- 남는 추정은 추정가 하나다. 코드 · 표는 지우고, 지우기 전 판은 git 태그 「추정임대-마지막」에 남긴다.
--
-- ## 무엇을
-- - 표: floor_rent_est · building_rent_est(+ _bak) · 그 위 MV 둘(floor_est_total · floor_est_by_floor)
-- - building_derived.roi_est(추정수익률) 칸 · 그 칸을 채우던 refresh_building_derived_core
-- - 만실 월임대: 공실 층 평당가를 「같은 층 실측」으로만 채운다(추정 폴백 삭제). full_est 칸 삭제
-- - ai.listing_rows(0238 시험판): 추정월임대료 · 추정수익률 칸 삭제
--
-- ## 남기는 것
-- - master.building_sanggwon: 건물 → 부동산원 상권 · 유형. 추정임대 표에 얹혀 있던 매핑이다.
--   상권 임대료(부동산원 원값, /buildings/{pk}/sanggwon-rent)가 읽는다. 추정이 아니라 자리 판정이라 따로 떼어 둔다.
-- - master.income_cap: 추정가 수익환원 20% 의 분모. 다음 파이프라인에서 재료를 주변 임대매물 호가로 바꿔 다시 굽는다(스펙 11d · 할일).
--   그때까지 추정가 값은 이미 구운 그대로다.

BEGIN;

-- 1. 상권 매핑을 떼어 둔다(추정 표를 지우기 전에)
CREATE TABLE IF NOT EXISTS master.building_sanggwon (
  building_pk text PRIMARY KEY, sanggwon text NOT NULL, series text);
INSERT INTO master.building_sanggwon (building_pk, sanggwon, series)
SELECT building_pk, sanggwon, series FROM master.building_rent_est WHERE sanggwon IS NOT NULL
ON CONFLICT (building_pk) DO NOTHING;
COMMENT ON TABLE master.building_sanggwon IS '건물 → 부동산원 상권 · 유형(0239). 상권 임대료 원값을 고르는 열쇠. 추정이 아니다';

-- 2. 만실 월임대 — 공실 층은 같은 층 실측 평당가로만 채운다
CREATE OR REPLACE FUNCTION app.listing_full_fold(p_pk text, p_team bigint)
 RETURNS void LANGUAGE sql AS $function$
  WITH rows AS (
    SELECT floor, rent, contract_area, app.unit_occupied(tenant_name, place_ref, rent) AS occ
      FROM app.floor_rents
     WHERE building_pk = p_pk AND team_id = p_team AND deleted_at IS NULL
  ), vac AS (
    SELECT app.floor_signed(floor) AS floor_no,
           CASE WHEN bool_or(contract_area IS NULL) THEN NULL ELSE sum(contract_area) END AS vacant_area
      FROM rows WHERE NOT occ GROUP BY 1
  ), act AS (
    SELECT app.floor_signed(floor) AS fno, sum(rent)::numeric / sum(contract_area) AS p
      FROM rows WHERE occ AND rent > 0 AND contract_area > 0 GROUP BY 1
  ), per AS (
    SELECT v.vacant_area, a.p FROM vac v LEFT JOIN act a ON a.fno = v.floor_no
  ), g AS (
    SELECT (SELECT count(*) FROM rows) AS n,
           (SELECT count(*) FROM rows WHERE occ AND COALESCE(rent, 0) = 0) AS unknown_rent,
           count(*) FILTER (WHERE vacant_area IS NULL OR (vacant_area > 0 AND p IS NULL)) AS miss,
           COALESCE(sum(vacant_area * p) FILTER (WHERE vacant_area > 0), 0) AS add
      FROM per
  )
  UPDATE app.listing_office o
     SET rent_full = CASE WHEN k.ok AND o.total_rent IS NOT NULL THEN round(o.total_rent + k.add) END
    FROM (SELECT n > 0 AND miss = 0 AND unknown_rent = 0
                 AND app.listing_vacancy(p_pk, p_team) IS NOT NULL AS ok, add FROM g) k,
         app.listings l
   WHERE l.id = o.listing_id AND l.building_pk = p_pk AND l.team_id = p_team
$function$;

-- 3. full_est 칸 — 읽기 뷰를 먼저 다시 세운다(칸 목록에서 full_est 만 뺀다)
DROP VIEW app.office_listings;
ALTER TABLE app.listing_office DROP COLUMN IF EXISTS full_est;
CREATE VIEW app.office_listings AS
 SELECT l.id, l.team_id, l.building_pk, l.price, l.price_on, l.pp_land, l.pp_total, l.gongsi_ratio, l.created_at,
    GREATEST(l.updated_at, o.updated_at) AS updated_at,
    o.assignee_account_id, o.listing_no, o.received_on, o.owner_id, o.status_id, o.hold_reason, o.sold_on, o.sold_price,
    o.ask_price, o.total_deposit, o.total_rent, o.total_mgmt, o.vacant_area, o.rent_full,
    o.building_major, o.building_use, o.grade, o.ipji, o.nohudo, o.price_vs_market, o.exclusive, o.checked_on,
    o.urgency, o.intent, o.meongdo, o.use_change, o.myeolsil, o.sell_on, o.sell_vague, o.call_result, o.rent_check,
    o.loan, o.loan_open, o.move_in, o.move_in_on
   FROM app.listings l JOIN app.listing_office o ON o.listing_id = l.id;
COMMENT ON VIEW app.office_listings IS '사람 사무소 매물 + 관리 칸(0226). 읽기 전용';

-- 4. 추정수익률 칸 · 파생 함수
CREATE OR REPLACE FUNCTION master.refresh_building_derived_core()
 RETURNS bigint
 LANGUAGE sql
AS $function$
  WITH g5 AS (SELECT pnu, price FROM master.gongsi_series WHERE year = EXTRACT(YEAR FROM CURRENT_DATE)::int - 5),
       g10 AS (SELECT pnu, price FROM master.gongsi_series WHERE year = EXTRACT(YEAR FROM CURRENT_DATE)::int - 10),
  ins AS (
  INSERT INTO master.building_derived AS d
    (building_pk, pp_land, pp_total, gongsi_total, gongsi_ratio, gongsi_up5, gongsi_up10,
     sale_pnl, bcr_slack, far_slack, road_score, station_score, use_kind, updated)
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
    LEFT JOIN master.building_calc bc ON bc.building_pk = b.building_pk
    LEFT JOIN master.building_legal bl ON bl.building_pk = b.building_pk
    LEFT JOIN master.sales_agg sa ON sa.building_pk = b.building_pk
    LEFT JOIN g5 ON g5.pnu = b.pnu
    LEFT JOIN g10 ON g10.pnu = b.pnu
  ON CONFLICT (building_pk) DO UPDATE SET
    pp_land=EXCLUDED.pp_land, pp_total=EXCLUDED.pp_total,
    gongsi_total=EXCLUDED.gongsi_total, gongsi_ratio=EXCLUDED.gongsi_ratio,
    gongsi_up5=EXCLUDED.gongsi_up5, gongsi_up10=EXCLUDED.gongsi_up10, sale_pnl=EXCLUDED.sale_pnl,
    bcr_slack=EXCLUDED.bcr_slack, far_slack=EXCLUDED.far_slack,
    road_score=EXCLUDED.road_score, station_score=EXCLUDED.station_score, use_kind=EXCLUDED.use_kind, updated=now()
  RETURNING 1)
  SELECT count(*) FROM ins;
$function$;

ALTER TABLE master.building_derived DROP COLUMN IF EXISTS roi_est;

-- 5. 시험판 매물 표 — 칸이 줄어 반환형이 바뀌므로 지우고 다시 세운다
DROP FUNCTION IF EXISTS ai.listing_rows(bigint, boolean);
CREATE FUNCTION ai.listing_rows(p_team bigint, p_broker boolean)
RETURNS TABLE (
  "매물ID" bigint, "주인" text, "지번코드" text, "주소" text, "도로명주소" text, "구" text, "동" text,
  "매매가_원" bigint, "매매가기준일" date, "평단가대지_원평" bigint, "평단가연면적_원평" bigint, "공시비율_pct" numeric,
  "대지면적_㎡" numeric, "연면적_㎡" numeric, "건축면적_㎡" numeric, "지상층수" integer, "지하층수" integer, "높이_m" numeric,
  "동수" integer, "주용도" text[], "구조" text, "용도지역" text, "지목" text, "도로접면" text, "지형형상" text, "지세" text,
  "사용승인일" date, "리모델링일" date, "승강기_대" integer, "주차대수_대" integer,
  "건폐율_pct" numeric, "용적률_pct" numeric, "법정건폐율_pct" numeric, "법정용적률_pct" numeric,
  "역거리_m" integer, "전면도로폭_m" numeric,
  "공시지가_원㎡" bigint, "공시총액_원" bigint, "공시5년상승_pct" numeric, "공시10년상승_pct" numeric,
  "최근실거래가_원" bigint, "최근실거래월" text, "실거래횟수_건" integer,
  "추정가_원" bigint,
  "수집일" date, "광고수" integer,
  "매물번호" text, "담당자" text, "상태" text, "보류사유" text, "접수일" date, "확인일" date,
  "매도희망가_원" bigint, "총보증금_원" bigint, "총월임대_원" bigint, "총관리비_원" bigint, "공실면적_㎡" numeric,
  "대분류" text, "소분류" text, "등급" text, "입지" text, "노후도" text, "시세대비" text, "전속" boolean,
  "급함" text, "매도의사" text, "명도" text, "용도변경" text, "멸실" text,
  "소유자유형" text, "관계" text, "협조" text, "친절" text,
  "매각일" date, "매각금액_원" bigint
)
LANGUAGE sql STABLE AS $$
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
         -- 추정가는 동마다 같은 대지를 넣고 돌아 여러 동 지번은 비운다(검색과 같다)
         CASE WHEN pr.n_bldg = 1 THEN se.sale_est::bigint END,
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
    LEFT JOIN master.building_sale_est se ON se.building_pk = b.building_pk
    LEFT JOIN master.building_legal bl ON bl.building_pk = b.building_pk
    LEFT JOIN master.building_road br ON br.building_pk = b.building_pk
    LEFT JOIN master.building_derived bd ON bd.building_pk = b.building_pk
    LEFT JOIN master.sales_agg sa ON sa.building_pk = b.building_pk
    LEFT JOIN app.listing_crawl lc ON lc.listing_id = n.listing_id
    -- 관리 칸은 내 사무소 매물에만 붙는다(남의 관리 칸은 안 읽는다)
    LEFT JOIN app.listing_office l ON l.listing_id = n.listing_id AND n.owner = 'mine'
    LEFT JOIN app.accounts a ON a.id = l.assignee_account_id
    LEFT JOIN app.statuses st ON st.id = l.status_id
    LEFT JOIN app.owners ow ON ow.id = l.owner_id AND ow.deleted_at IS NULL
   WHERE NOT n.closed
$$;

REVOKE ALL ON FUNCTION ai.listing_rows(bigint, boolean) FROM PUBLIC;

-- 6. 추정임대 표
DROP MATERIALIZED VIEW IF EXISTS master.floor_est_total;      -- floor_est_by_floor 위에 선다
DROP MATERIALIZED VIEW IF EXISTS master.floor_est_by_floor;
DROP TABLE IF EXISTS master.floor_rent_est;
DROP TABLE IF EXISTS master.floor_rent_est_bak;
DROP TABLE IF EXISTS master.building_rent_est;
DROP TABLE IF EXISTS master.building_rent_est_bak;

COMMIT;
