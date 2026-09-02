-- 강제 완료(2026-08-18) — 값이 없어도 사람이 「됐다」고 선언할 수 있어야 한다.
-- 파생이 원칙이지만 현실은 파생이 못 잡는 경우가 있다(대장에 없는 소유자·구두로 끝난 정보).
-- 칸 키를 배열로 담고 뷰가 OR 로 얹는다 — 원래 근거는 그대로 남아 나중에 구분된다.
BEGIN;

ALTER TABLE app.listings ADD COLUMN IF NOT EXISTS force_done text[] NOT NULL DEFAULT '{}';

INSERT INTO app.schema_migrations(version) VALUES ('0103_force_done.sql')
ON CONFLICT DO NOTHING;
COMMIT;
