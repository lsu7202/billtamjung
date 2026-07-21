-- 0006_master_extend.sql — master.buildings 실데이터 필드 확장(서울 전체 적재용)
-- 근거: data/빌탐정.db buildings 스키마(통합뷰 정본) · S01b 필터 대상 필드
BEGIN;

ALTER TABLE master.buildings_v1
  ADD COLUMN IF NOT EXISTS road_addr     text,      -- 도로명주소
  ADD COLUMN IF NOT EXISTS pnu           text,      -- 대표지번 PNU
  ADD COLUMN IF NOT EXISTS sgg_code      text,      -- 시군구코드(구 필터)
  ADD COLUMN IF NOT EXISTS bjd_code      text,      -- 법정동코드(동 필터)
  ADD COLUMN IF NOT EXISTS main_use_name text,      -- 주용도 라벨
  ADD COLUMN IF NOT EXISTS etc_use       text,      -- 기타용도
  ADD COLUMN IF NOT EXISTS structure     text,      -- 구조
  ADD COLUMN IF NOT EXISTS remodel_ymd   date,      -- 최근대수선일
  ADD COLUMN IF NOT EXISTS jimok         text,      -- 지목
  ADD COLUMN IF NOT EXISTS parcel_area   numeric,   -- 토지면적
  ADD COLUMN IF NOT EXISTS land_use      text,      -- 토지이용상황
  ADD COLUMN IF NOT EXISTS use_zone      text,      -- 용도지역(대표)
  ADD COLUMN IF NOT EXISTS use_zone_mix  jsonb,     -- 용도지역_걸침(비중 배열)
  ADD COLUMN IF NOT EXISTS slope         text,      -- 지세
  ADD COLUMN IF NOT EXISTS shape         text,      -- 지형형상
  ADD COLUMN IF NOT EXISTS road_frontage text,      -- 도로접면
  ADD COLUMN IF NOT EXISTS station_dist  int,       -- 역과의거리(m)
  ADD COLUMN IF NOT EXISTS subway_json   jsonb,     -- 주변지하철
  ADD COLUMN IF NOT EXISTS bus_json      jsonb,     -- 주변버스
  ADD COLUMN IF NOT EXISTS gongsi_latest bigint,    -- 최신 공시지가(원/㎡)
  ADD COLUMN IF NOT EXISTS last_sale_ym  text,      -- 최근 매각 계약년월
  ADD COLUMN IF NOT EXISTS last_sale_price bigint;  -- 최근 매각액(원)

-- S01 필터·정렬용 인덱스
CREATE INDEX IF NOT EXISTS buildings_sgg_idx   ON master.buildings_v1 (sgg_code);
CREATE INDEX IF NOT EXISTS buildings_bjd_idx   ON master.buildings_v1 (bjd_code);
CREATE INDEX IF NOT EXISTS buildings_zone_idx  ON master.buildings_v1 (use_zone);
CREATE INDEX IF NOT EXISTS buildings_use_idx   ON master.buildings_v1 (main_use);
CREATE INDEX IF NOT EXISTS buildings_sale_idx  ON master.buildings_v1 (last_sale_price) WHERE last_sale_price IS NOT NULL;

-- 뷰 재생성(새 컬럼 노출)
CREATE OR REPLACE VIEW master.buildings AS SELECT * FROM master.buildings_v1;

COMMIT;
