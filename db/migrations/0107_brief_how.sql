-- 브리핑은 수단이 여럿이다(2026-08-18) — 자료를 보내기도, 만나서 하기도, 전화로 하기도 한다.
-- 「보냈다」만 담으면 만나서 브리핑한 건이 영영 안 찍힌다. 날짜 옆에 방식 한 칸.
BEGIN;

ALTER TABLE app.proposals ADD COLUMN IF NOT EXISTS brief_how text;

INSERT INTO ref.enum_groups(enum_key, label) VALUES ('brief_how', '브리핑 방식')
ON CONFLICT (enum_key) DO NOTHING;

INSERT INTO ref.enums(enum_key, code, label, sort_order) VALUES
  ('brief_how', '자료 발송', '자료 발송', 10),
  ('brief_how', '만나서',   '만나서',   20),
  ('brief_how', '전화',     '전화',     30),
  ('brief_how', '현장에서', '현장에서', 40)
ON CONFLICT (enum_key, code) DO UPDATE SET active = true;

INSERT INTO app.schema_migrations(version) VALUES ('0107_brief_how.sql')
ON CONFLICT DO NOTHING;
COMMIT;
