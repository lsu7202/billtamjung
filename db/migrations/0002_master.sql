-- 0002_master.sql — master 스키마(버전 물리테이블 + 뷰 + 적재감사)
-- 근거: specs/04-data/schema-ddl.md §1, 01-상세설계 §2
BEGIN;

-- 적재 버전(스케쥴러가 갱신) — 단일 행
CREATE TABLE IF NOT EXISTS master.master_version (
  id        boolean PRIMARY KEY DEFAULT true CHECK (id),
  version   int NOT NULL,
  loaded_at timestamptz NOT NULL,
  source    text
);
INSERT INTO master.master_version (id, version, loaded_at, source)
  VALUES (true, 1, now(), 'seed')
  ON CONFLICT (id) DO NOTHING;

-- 적재 감사 로그
CREATE TABLE IF NOT EXISTS master.master_loads (
  run_id       uuid PRIMARY KEY,
  source       text NOT NULL,
  started_at   timestamptz NOT NULL,
  finished_at  timestamptz,
  status       text NOT NULL CHECK (status IN ('running','success','failed')),
  rows_in      bigint, rows_out bigint,
  validation   jsonb DEFAULT '{}',
  from_version int, to_version int,
  error        text
);

-- 버전 물리테이블: 건물 (컬럼 전량은 specs/04-data/schema.md)
CREATE TABLE IF NOT EXISTS master.buildings_v1 (
  building_pk  text PRIMARY KEY,
  addr         text NOT NULL,
  jibun_norm   text,
  geom         geometry(Point,4326) NOT NULL,
  land_area    numeric,           -- 대지면적(㎡)
  total_area   numeric,           -- 연면적(㎡)
  floors_above int,
  floors_below int,
  bcr          numeric,           -- 건폐율(%)
  far          numeric,           -- 용적률(%)
  main_use     text,              -- 주용도(ref.enums main_use code)
  approval_ymd date
);

-- 버전 물리테이블: 필지
CREATE TABLE IF NOT EXISTS master.parcels_v1 (
  pnu         text PRIMARY KEY,
  building_pk text,
  geom        geometry(MultiPolygon,4326) NOT NULL,
  uqa         text,              -- 용도지역(ref.enums use_zone code)
  area        numeric,
  is_rep      boolean NOT NULL DEFAULT false
);

-- 서비스가 바라보는 뷰(스왑 대상)
CREATE OR REPLACE VIEW master.buildings AS SELECT * FROM master.buildings_v1;
CREATE OR REPLACE VIEW master.parcels   AS SELECT * FROM master.parcels_v1;

-- 인덱스(공간·검색)
CREATE INDEX IF NOT EXISTS buildings_geom_gix    ON master.buildings_v1 USING gist (geom);
CREATE INDEX IF NOT EXISTS parcels_geom_gix      ON master.parcels_v1   USING gist (geom);
CREATE INDEX IF NOT EXISTS buildings_addr_prefix ON master.buildings_v1 (jibun_norm text_pattern_ops);
CREATE INDEX IF NOT EXISTS buildings_addr_trgm   ON master.buildings_v1 USING gin (addr gin_trgm_ops);

COMMIT;
