-- 모델 SQL 시험 · 「매물」 표 (2026-10-06 대표 · 시험용)
--
-- ## 왜
-- 모델이 손잡이(조건 서식) 안에서만 답할 수 있어, 「네이버 매매가보다 내 매매가가 비싼 내 매물」처럼
-- 칸끼리 · 줄끼리 견주는 물음에 답을 못 냈다(도구 바퀴 12번 소진). 이어 붙인 시트 한 장을 열어 주고
-- 모델이 SQL 을 직접 쓰게 해 본다. 잘 되면 화면 검색도 이 표를 읽도록 다시 잡는다(그때 따로 상의).
--
-- ## 모양
-- 한 줄 = 매물 하나. search.py 의 raw 블록(검색 줄)을 옮겼다. 새 계산은 없다.
-- 칸 이름 = 모델 이름 사전(catalog)의 한글 이름 + 단위. 단위를 이름에 박아 설명 글이 필요 없게 한다.
--
-- ## 벽
-- 모델은 이 함수를 직접 못 부른다. 서버가 그 사무소 줄만 뽑아 bt_query 접속의 임시 표 「매물」에 넣고,
-- 모델 SQL 은 그 접속에서 돈다. bt_query 는 어떤 스키마에도 권한이 없다(임시 표만 만든다).

BEGIN;

CREATE SCHEMA IF NOT EXISTS ai;
REVOKE ALL ON SCHEMA ai FROM PUBLIC;

CREATE OR REPLACE FUNCTION ai.listing_rows(p_team bigint, p_broker boolean)
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
  "추정가_원" bigint, "추정월임대료_원" bigint, "추정수익률_pct" numeric,
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
         -- 추정은 동마다 같은 대지를 넣고 돌아 여러 동 지번은 비운다(검색과 같다)
         CASE WHEN pr.n_bldg = 1 THEN se.sale_est::bigint END,
         CASE WHEN pr.n_bldg = 1 THEN re.monthly_rent::bigint END,
         CASE WHEN pr.n_bldg = 1 THEN bd.roi_est END,
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
    LEFT JOIN master.building_rent_est re ON re.building_pk = b.building_pk
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

-- 모델 SQL 이 도는 접속. 어떤 스키마에도 USAGE 가 없다 — 자기 접속의 임시 표 「매물」만 읽는다.
-- 비밀번호는 여기 없다(0167 과 같다). 로컬은 apply 뒤 손으로, 운영은 런북에서.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bt_query') THEN
    CREATE ROLE bt_query LOGIN;
  END IF;
END $$;
ALTER ROLE bt_query SET statement_timeout = '10s';
ALTER ROLE bt_query SET search_path = pg_temp;
REVOKE ALL ON SCHEMA public, master, ref, app, ai FROM bt_query;

COMMIT;
