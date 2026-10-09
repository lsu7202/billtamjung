-- 동 단위 적정가 표를 지운다 (2026-10-08 · 0250 뒤)
-- 읽던 곳(buildings · buyers · search · ai.tools · ai.listing_rows · 파생 · load_market)은 parcel_sale_est(pnu) 로 옮겼다.
BEGIN;
DROP TABLE IF EXISTS master.building_sale_est;
COMMIT;
