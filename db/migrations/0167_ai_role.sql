-- AI 어시스턴트 · bt_ai 롤 — 경계 ① (2026-09-08)
-- 정본: specs/07-architecture/10-AI-어시스턴트.md §3-2 · §18-3
--
-- ## 왜
-- 모델이 SQL 을 쓴다. 막는 것은 **함수가 없는 것이 아니라 권한이 없는 것**이다.
-- 프롬프트로 「보지 마라」고 타이르는 자리가 한 곳도 없다. 포스트그레스가 거절한다.
--
-- ## 허용 목록이지 차단 목록이 아니다
-- GRANT ON ALL TABLES 를 안 쓴다. **새 표는 기본이 닫힘**이다.
-- 누가 새 점수 표를 만들어도 여기 안 적으면 bt_ai 는 못 본다. 사람 기억에 안 맡긴다.
--
-- ## 뷰에 준다, 세대 표에 안 준다
-- master.buildings 는 buildings_v9 를 가리키는 뷰고 로더가 스왑하면 v10 이 된다.
-- PG16 뷰는 소유자 권한으로 돈다. 뷰에 GRANT 하면 스왑을 넘어 살아남고,
-- 세대 표에 직접 주면 다음 스왑에서 끊긴다. 모델도 뷰를 봐야 한다(세대 이름을 박지 않는다).
--
-- ## 비밀번호는 여기 없다
-- LOGIN 만 켜고 비밀번호는 안 정한다. 이 상태로는 접속이 안 된다(안전한 기본값).
-- 로컬은 apply 뒤 손으로 ALTER ROLE, 운영은 배포 런북(08)에서 env 로.
--
-- ## 잣대 (§16-1)
-- 정부가 정한 규칙을 그대로 옮긴 계산은 사실이다. 우리가 가중치를 고른 점수는 주장이다.
-- 사실만 연다. 주장은 화면이 자기 이름으로 말한다.

BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bt_ai') THEN
    CREATE ROLE bt_ai LOGIN;
  END IF;
END $$;

ALTER ROLE bt_ai SET statement_timeout = '10s';
ALTER ROLE bt_ai SET default_transaction_read_only = on;
ALTER ROLE bt_ai SET search_path = master, ref;

-- 남아 있을 권한을 다 걷고 다시 준다. 멱등.
REVOKE ALL ON ALL TABLES IN SCHEMA master, ref, app FROM bt_ai;
REVOKE ALL ON SCHEMA master, ref, app FROM bt_ai;

GRANT USAGE ON SCHEMA master, ref TO bt_ai;
-- app 스키마는 USAGE 자체를 안 준다. 개인정보는 SQL 로 영영 못 닿는다.

-- ── 사실 ─────────────────────────────────────────────────────────────
GRANT SELECT ON
  -- 건물 · 필지 (뷰)
  master.buildings, master.parcels, master.building_parcels,
  master.building_ledger_raw, master.building_legal,
  master.ledger_basic, master.building_zone, master.building_closed, master.building_complex,
  master.building_energy, master.building_septic, master.building_unit,
  -- 정비 · 지구단위
  master.building_district_plan, master.district_plan, master.redevel_zone, master.building_redevel,
  master.building_permit, master.building_road, master.building_pop,
  -- 지가 · 거래
  master.gongsi_series, master.land_adjust,
  master.sales_history, master.sales_agg, master.apt_price,
  -- 소식
  master.area_event, master.press_event, master.urban_notice, master.g2b_bid, master.city_facility,
  -- 업체 · 상권
  master.localdata_permit, master.sbiz_store,
  master.sanggwon, master.sanggwon_rent_series, master.trade_area,
  -- 교통 · 인구 · 도로
  master.subway_stations, master.road_segment, master.living_pop,
  -- 층 · 검색 보조
  master.floor_outline, master.region_index, master.vacant_parcels
TO bt_ai;

GRANT SELECT ON ref.biz_category, ref.enums, ref.enum_groups, ref.fields, ref.error_msg TO bt_ai;

-- ── 닫힌 것 ──────────────────────────────────────────────────────────
-- 아래는 GRANT 목록에 없으니 이미 닫혀 있다. 그래도 이름을 적어 두는 것은
-- qa/ai/walls.py 가 **이 목록으로 「닫혀 있는가」를 매번 확인**하기 때문이다.
--
--   주장    master.building_score          활용유형 · 매도가능성
--           master.building_sale_est       적정가
--           master.building_rent_est       임대추정
--           master.floor_rent_est · floor_est_by_floor · floor_est_total
--           master.building_calc           검색 전용 계산값(0143). 화면 값은 대장이다
--           master.income_cap · sale_price_index    산식 파라미터
--           ref.formula_params · formula_sets
--   내부    master._crawl_clean · _crawl_rent · _resnap    임대 크롤. 잣대로만 쓴다
--           master.*_bak · master_loads · master_version · source_version · derive_run
--   세대    master.buildings_v* · parcels_v* …    뷰를 봐야 한다
--   전부    app.*

COMMIT;
