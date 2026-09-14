-- 임대내역 확인 상태(2026-08-18) — 표를 복제하는 게 아니라 **일의 상태**를 관리한다:
-- 안 받음(null) · 받는 중('확인중' — 사람이 찍음) · 받았다(floor_rents 존재에서 파생).
-- 명도·멸실의 확인중과 같은 어법. 게이트(§3.3)엔 안 들어간다 — 밖에서도 아는 정보라서.
BEGIN;

ALTER TABLE app.listings ADD COLUMN IF NOT EXISTS rent_check text;

INSERT INTO app.schema_migrations(version) VALUES ('0100_rent_check.sql')
ON CONFLICT DO NOTHING;
COMMIT;
