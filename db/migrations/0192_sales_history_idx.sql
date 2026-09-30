-- 0192 실거래 기간 범위(2013~2015 같은) — 건물마다 「그 기간 안 가장 최근 거래」를 찾는다(탐색 실거래 보기, 2026-09-28).
--
-- 인덱스를 새로 만들려 했으나 master.sales_history 는 뷰다(→ master.sales_history_v5). 실제 표에
-- (building_pk, contract_ym) 인덱스가 이미 있어 할 일이 없다. 번호만 남긴다 — 뷰에 CREATE INDEX 를 걸면
-- 「cannot create index on relation」으로 멈춘다(처음 판이 그랬다).
SELECT 1;
