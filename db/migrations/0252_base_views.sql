-- 층 1 뷰 · 스키마 base (2026-10-08 · 스펙 12 §3-4)
--
-- 화면 API 와 모델 층 2(단계 5)가 같은 뷰를 읽는다. 영어 칸 이름 · 좌표 포함 · 새 계산 없음(원천 칸을 그대로 내거나
-- 이어 붙이기만 한다). 열쇠는 지번(pnu) · 동(building_pk) · 거래(trade_id) 셋.
-- 매물 · 임대(사무소 범위)는 매물 열쇠를 listing_id 로 바꾼 뒤(§3-3) 함수로 더한다.
-- 에너지는 지번 × 월 시계열이라 동 한 줄에 못 붙인다 — 스펙의 building_extras 하나 대신 energy · septic · zones 셋.
-- 가려진 번지(trade.jibun_raw)와 원천 줄 위치(src)는 열지 않는다(10-08 대표 · 모델이 헷갈린다).

BEGIN;

CREATE SCHEMA IF NOT EXISTS base;
COMMENT ON SCHEMA base IS '층 1 뷰 — 원천 칸 그대로 · 영어 이름 · 열쇠 pnu / building_pk / trade_id (스펙 12 §3-4)';

-- 지번 — 공공지목 10종은 base.public_parcels 로 나눈다(지목 기준. 소유 기준이 아니다)
CREATE OR REPLACE VIEW base.parcels AS
SELECT p.pnu, left(p.pnu, 10) AS bjd_code, COALESCE(b.addr, vp.addr) AS addr, b.road_addr,
       p.jimok, p.area AS land_area, p.land_use, p.use_zone, p.slope, p.shape, p.road_frontage,
       p.legal_bcr, p.legal_far, p.gongsi_latest, p.regulations,
       COALESCE(pr.n_bldg, 0) AS n_buildings, pr.total_area, pr.build_area, pr.floors_above, pr.floors_below,
       pr.rep_pk AS rep_building_pk,
       ST_X(COALESCE(b.geom, ST_PointOnSurface(p.geom))) AS lng, ST_Y(COALESCE(b.geom, ST_PointOnSurface(p.geom))) AS lat
  FROM master.parcels p
  LEFT JOIN master.parcel_rep pr ON pr.pnu = p.pnu
  LEFT JOIN master.buildings b ON b.building_pk = pr.rep_pk
  LEFT JOIN master.vacant_parcels vp ON vp.pnu = p.pnu
 WHERE COALESCE(p.jimok, '') NOT IN ('공원', '도로', '하천', '제방', '구거', '유지', '철도용지', '묘지', '수도용지', '사적지');
COMMENT ON VIEW base.parcels IS '지번(필지) 하나. 공공지목 10종 제외. 땅 값(면적 · 지목 · 용도지역 · 공시 · 법정치 · 규제)과 그 지번 동 합';

CREATE OR REPLACE VIEW base.public_parcels AS
SELECT p.pnu, left(p.pnu, 10) AS bjd_code, COALESCE(b.addr, vp.addr) AS addr,
       p.jimok, p.area AS land_area, p.land_use, p.use_zone, p.gongsi_latest, p.regulations,
       COALESCE(pr.n_bldg, 0) AS n_buildings,
       ST_X(COALESCE(b.geom, ST_PointOnSurface(p.geom))) AS lng, ST_Y(COALESCE(b.geom, ST_PointOnSurface(p.geom))) AS lat
  FROM master.parcels p
  LEFT JOIN master.parcel_rep pr ON pr.pnu = p.pnu
  LEFT JOIN master.buildings b ON b.building_pk = pr.rep_pk
  LEFT JOIN master.vacant_parcels vp ON vp.pnu = p.pnu
 WHERE p.jimok IN ('공원', '도로', '하천', '제방', '구거', '유지', '철도용지', '묘지', '수도용지', '사적지');
COMMENT ON VIEW base.public_parcels IS '공공지목 10종(공원 · 도로 · 하천 · 제방 · 구거 · 유지 · 철도용지 · 묘지 · 수도용지 · 사적지) 필지';

-- 동 — 대장 값 + 표제부 원문에서 꺼낸 칸(번호 · 코드 성격만 빼고) + 기본개요(건물명 · 대장종류 · 지역지구구역 이름)
CREATE OR REPLACE VIEW base.buildings AS
SELECT b.building_pk, b.pnu, b.addr, b.road_addr, b.bjd_code,
       lb.bldg_name AS building_name, r.rec->>'동명' AS dong_name, r.rec->>'주부속구분' AS main_sub,
       lb.ledger_kind, lb.ledger_type, lb.extra_parcels,
       b.main_use_name AS main_use, b.etc_use, b.structure, r.rec->>'기타구조' AS etc_structure, r.rec->>'지붕' AS roof,
       b.land_area, b.total_area, b.build_area, b.far_area, b.floors_above, b.floors_below, b.height,
       b.bcr, b.far, b.bcr_src, b.far_src,
       NULLIF(r.rec->>'총동연면적', '')::numeric AS total_area_all_dong,
       NULLIF(r.rec->>'세대수', '')::numeric::int AS households,
       NULLIF(r.rec->>'가구수', '')::numeric::int AS families,
       NULLIF(r.rec->>'호수', '')::numeric::int AS units,
       b.elevator, b.elevator_ext, NULLIF(r.rec->>'비상용승강기', '')::numeric::int AS emergency_elevator, b.parking,
       r.rec->>'내진적용' AS seismic_applied, r.rec->>'내진능력' AS seismic_capacity,
       CASE WHEN r.rec->>'허가일' ~ '^[0-9]{8}$' THEN to_date(r.rec->>'허가일', 'YYYYMMDD') END AS permit_ymd,
       CASE WHEN r.rec->>'착공일' ~ '^[0-9]{8}$' THEN to_date(r.rec->>'착공일', 'YYYYMMDD') END AS start_ymd,
       b.approval_ymd, b.approval_ymd_prec, b.remodel_ymd, b.remodel_ymd_prec,
       r.rec->>'최근대수선구분' AS last_major_repair_kind, r.rec->>'대수선이력' AS major_repair_history,
       lb.zone_name, lb.district_name, lb.area_name,
       b.station_dist, br.front_m AS road_front_m, br.side_m AS road_side_m, br.rear_m AS road_rear_m,
       b.subway_json AS subways, b.bus_json AS buses,
       ST_X(b.geom) AS lng, ST_Y(b.geom) AS lat
  FROM master.buildings b
  LEFT JOIN master.building_ledger_raw r ON r.building_pk = b.building_pk
  LEFT JOIN master.ledger_basic lb ON lb.building_pk = b.building_pk
  LEFT JOIN master.building_road br ON br.building_pk = b.building_pk;
COMMENT ON VIEW base.buildings IS '건물 한 동. 대장 값과 표제부 원문 칸. 대지면적(대장)은 비어 있으면 빈칸 — 땅 크기는 base.parcels.land_area';

CREATE OR REPLACE VIEW base.estimates AS
SELECT pnu, sale_est, per_py, n_comps, land_area, gongsi_total, method, updated
  FROM master.parcel_sale_est;
COMMENT ON VIEW base.estimates IS '빌탐정 추정가(지번 하나에 값 하나). 실거래 · 매매가가 아니다';

CREATE OR REPLACE VIEW base.trades AS
SELECT t.id AS trade_id, m.pnu, m.method AS match_method, t.kind, t.trade_type, t.deal_kind, t.bjd_code, t.dong_name,
       t.road_name, t.complex_name, t.contract_ym, t.contract_day, t.price_won, t.total_area, t.excl_area, t.land_area,
       t.floor, t.bldg_dong, t.build_year, t.house_type, t.main_use, t.use_zone, t.jimok, t.road_cond, t.share,
       t.right_kind, t.deal_type, t.canceled_on, t.registered_on, t.buyer, t.seller, t.broker_area
  FROM master.trade t
  LEFT JOIN master.trade_match m ON m.trade_id = t.id;
COMMENT ON VIEW base.trades IS '국토부 실거래 한 건(여덟 갈래 전부). pnu 는 확실히 붙은 거래만 · 못 붙은 거래는 법정동까지. 해제 거래는 canceled_on';

CREATE OR REPLACE VIEW base.biz AS
SELECT z.id AS biz_id, z.building_pk, b.pnu, z.name, z.phone, z.floor, z.cat_nodes AS categories,
       z.first_seen, z.last_seen, z.gone_on
  FROM master.biz z JOIN master.buildings b ON b.building_pk = z.building_pk;
COMMENT ON VIEW base.biz IS '업체 × 동(카카오 장소). gone_on 이 있으면 사라진 업체';

CREATE OR REPLACE VIEW base.floors AS
SELECT f.building_pk, b.pnu, f.seq, f.floor, f.use, f.floor_area, f.structure, f.main_sub, f.dong, f.area_excluded
  FROM master.floor_outline f JOIN master.buildings b ON b.building_pk = f.building_pk;
COMMENT ON VIEW base.floors IS '동의 층 하나(층별개요). floor_area = 바닥면적';

CREATE OR REPLACE VIEW base.rent_asks AS
SELECT r.id AS ask_id, b.pnu, r.building_pk, r.floor, r.use_type, round(r.contract_area, 2) AS contract_area,
       round(r.excl_area, 2) AS excl_area, r.deposit, r.rent, r.observed_on, r.posted_on, r.n_ads
  FROM master.market_rent r JOIN master.buildings b ON b.building_pk = r.building_pk;
COMMENT ON VIEW base.rent_asks IS '네이버 임대 광고(공실에 내놓은 값). 같은 층 · 같은 면적 광고는 가장 싼 하나. 업체 · 호실은 모른다';

CREATE OR REPLACE VIEW base.energy AS
SELECT pnu, kind, use_ym, usage_kwh FROM master.building_energy;
COMMENT ON VIEW base.energy IS '지번 에너지 사용량(월). kind = elec · gas';

CREATE OR REPLACE VIEW base.septic AS
SELECT building_pk, pnu, form_name, unit_kind, cap_person, cap_m3 FROM master.building_septic;
COMMENT ON VIEW base.septic IS '동의 정화조(형식 · 처리 인원 · 용량)';

CREATE OR REPLACE VIEW base.zones AS
SELECT building_pk, pnu, use_zone, use_district, use_area, zones, districts, areas FROM master.building_zone;
COMMENT ON VIEW base.zones IS '동의 지역 · 지구 · 구역(건축물대장 지역지구구역)';

CREATE OR REPLACE VIEW base.complexes AS
SELECT complex_pk, pnu, name, ledger_kind, addr, road_addr, land_area, build_area, bcr, total_area, far_area, far,
       main_use_name AS main_use, etc_use, households, families, main_bldg_cnt, annex_bldg_cnt, parking,
       permit_ymd, start_ymd, approval_ymd
  FROM master.building_complex;
COMMENT ON VIEW base.complexes IS '단지(총괄표제부). 동 여러 개를 묶은 단위 — 동 표와 단위가 다르다. 화면은 아직 안 쓴다';

CREATE OR REPLACE VIEW base.closed_buildings AS
SELECT closed_pk, pnu, close_kind, close_ymd, ledger_kind, ledger_type, addr, road_addr, bldg_name AS building_name, dong,
       land_area, build_area, bcr, total_area, far_area, far, structure, main_use_name AS main_use, etc_use,
       floors_above, floors_below, height, households, families, ho_cnt AS units, permit_ymd, start_ymd, approval_ymd
  FROM master.building_closed;
COMMENT ON VIEW base.closed_buildings IS '사라진 건물(폐쇄 · 말소 대장). 지금 서 있지 않다. 화면은 아직 안 쓴다';

COMMIT;
