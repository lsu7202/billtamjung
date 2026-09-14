-- 0009_master_parcels.sql — 필지 속성·규제 확장 + 대표-부속 관계(annex)
-- 소스: _land_master(898,800) · _spatial_ALL(용도지역) · _legal_ALL · _regulations_11 · _annex_ALL
BEGIN;

ALTER TABLE master.parcels_v1
  ADD COLUMN IF NOT EXISTS jimok         text,
  ADD COLUMN IF NOT EXISTS land_use      text,      -- 토지이용상황
  ADD COLUMN IF NOT EXISTS slope         text,      -- 지세
  ADD COLUMN IF NOT EXISTS shape         text,      -- 지형형상
  ADD COLUMN IF NOT EXISTS road_frontage text,      -- 도로접면
  ADD COLUMN IF NOT EXISTS use_zone      text,      -- 용도지역(걸침 병기)
  ADD COLUMN IF NOT EXISTS legal_bcr     text,      -- 법정건폐율
  ADD COLUMN IF NOT EXISTS legal_far     text,      -- 법정용적률
  ADD COLUMN IF NOT EXISTS gongsi_latest bigint,    -- 최신 공시지가(원/㎡)
  -- 규제 6종(필지 원본 — 건물 요약은 OR 집계)
  ADD COLUMN IF NOT EXISTS reg_godo      text,      -- 고도지구
  ADD COLUMN IF NOT EXISTS reg_district  text,      -- 지구단위계획
  ADD COLUMN IF NOT EXISTS reg_jeongbi   text,      -- 정비구역(+재정비촉진)
  ADD COLUMN IF NOT EXISTS reg_gyeong    text,      -- 경관지구
  ADD COLUMN IF NOT EXISTS reg_banghwa   text,      -- 방화지구
  ADD COLUMN IF NOT EXISTS reg_munhwa    text;      -- 문화재보존

-- 대표-부속 관계(annex): 건물 ↔ 필지들
CREATE TABLE IF NOT EXISTS master.building_parcels_v1 (
  building_pk text NOT NULL,
  pnu         text NOT NULL,
  role        text NOT NULL CHECK (role IN ('대표','부속')),
  PRIMARY KEY (building_pk, pnu)
);
CREATE OR REPLACE VIEW master.building_parcels AS SELECT * FROM master.building_parcels_v1;
CREATE INDEX IF NOT EXISTS bp_pnu ON master.building_parcels_v1 (pnu);

CREATE OR REPLACE VIEW master.parcels AS SELECT * FROM master.parcels_v1;
CREATE INDEX IF NOT EXISTS parcels_pk_idx ON master.parcels_v1 (building_pk);

COMMIT;
