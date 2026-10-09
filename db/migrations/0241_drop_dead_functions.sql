-- 부르는 곳 없는 함수 둘 (2026-10-07 지번 단위 감사 · 스펙 12 §0-3)
--   report_is_stale    — app.reports(0240 에서 지움)를 읽는다. 부르면 오류
--   building_watermark — report_is_stale 전용
-- listing_checked_fold 는 감사가 「안 부름」으로 봤지만 contacts_checked_trg 트리거가 부른다 — 남긴다.

BEGIN;
DROP FUNCTION IF EXISTS app.report_is_stale(bigint);
DROP FUNCTION IF EXISTS app.building_watermark(text, bigint);
COMMIT;
