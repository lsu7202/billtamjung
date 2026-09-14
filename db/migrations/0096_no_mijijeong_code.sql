-- 미지정 통일(2026-08-18): 저장은 null 하나다. 「미지정」은 화면에 보일 때의 낱말일 뿐
-- 코드가 아니다 — 칩·드롭다운 모두 「선택된 것을 다시 누르면 해제(null)」로 돌아간다.
-- 저장된 '미지정' 문자열은 0건 확인(2026-08-18) — enum 행만 내리면 끝.
BEGIN;

UPDATE ref.enums SET active = false WHERE code = '미지정';

INSERT INTO app.schema_migrations(version) VALUES ('0096_no_mijijeong_code.sql')
ON CONFLICT DO NOTHING;
COMMIT;
