-- 자료를 노출에 병합하지 않는다(2026-08-18 정정) — 자료 관련은 추후 별도 구성.
-- 0101 에서 노출 사유로 복사했던 것을 되돌리고, 자료 사유는 살려 둔다(나중에 쓴다).
BEGIN;

UPDATE ref.enums SET active = false
 WHERE enum_key = 'stop_reason_match'
   AND code IN (SELECT code FROM ref.enums WHERE enum_key = 'stop_reason_asset');
UPDATE ref.enums SET active = true WHERE enum_key = 'stop_reason_asset';

INSERT INTO app.schema_migrations(version) VALUES ('0102_asset_unmerge.sql')
ON CONFLICT DO NOTHING;
COMMIT;
