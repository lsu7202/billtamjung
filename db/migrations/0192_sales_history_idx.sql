-- 0192 실거래 기간 범위(2013~2015 같은) — 건물마다 「그 기간 안 가장 최근 거래」를 찾는다(탐색 실거래 보기, 2026-09-28).
-- 전엔 buildings.last_sale_* (마지막 거래 하나)만 봐서, 범위를 고르면 그 뒤에 또 팔린 건물이 빠졌다.
CREATE INDEX IF NOT EXISTS sales_history_bpk_ym ON master.sales_history(building_pk, contract_ym DESC);
