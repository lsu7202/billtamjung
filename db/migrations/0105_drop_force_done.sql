-- 강제 완료 폐기(2026-08-18 결정) — 값 없이 초록이 되는 길을 없앤다.
-- 이유: 초록이 두 뜻(값이 있다 / 내가 눌렀다)을 가지면 대시보드가 할 일을 숨기고
-- 깔때기 측정이 오염되며, 그 초록을 본 팀원이 없는 근거를 믿고 움직인다.
-- 값이 없는데 진행해야 하는 일이 잦으면 그건 **필드가 현실을 못 담는다는 신호**다.
BEGIN;

ALTER TABLE app.listings DROP COLUMN IF EXISTS force_done;

INSERT INTO app.schema_migrations(version) VALUES ('0105_drop_force_done.sql')
ON CONFLICT DO NOTHING;
COMMIT;
