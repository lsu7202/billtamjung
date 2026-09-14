-- 0007_master_series.sql — 시계열: 공시지가(연도별)·매각 이력
-- 소스: 빌탐정.db prices(6.0M)·sales. S02 §3.7 시계열 블록용.
BEGIN;

CREATE TABLE IF NOT EXISTS master.gongsi_series_v1 (
  pnu   text NOT NULL,
  year  int  NOT NULL,
  price bigint NOT NULL,          -- 원/㎡
  PRIMARY KEY (pnu, year)
);
CREATE OR REPLACE VIEW master.gongsi_series AS SELECT * FROM master.gongsi_series_v1;

CREATE TABLE IF NOT EXISTS master.sales_history_v1 (
  building_pk  text NOT NULL,
  contract_ym  text NOT NULL,     -- YYYYMM
  price        bigint NOT NULL,   -- 원
  total_area   numeric,
  land_area    numeric,
  PRIMARY KEY (building_pk, contract_ym, price)
);
CREATE OR REPLACE VIEW master.sales_history AS SELECT * FROM master.sales_history_v1;
CREATE INDEX IF NOT EXISTS sales_hist_pk ON master.sales_history_v1 (building_pk, contract_ym);

COMMIT;
