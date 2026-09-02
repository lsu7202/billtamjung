-- 브리핑 흐름(2026-08-19) — 브리핑은 「할 일(약속) → 한 일(방식)」 한 줄기다.
--   ① 비어 있으면 「브리핑 일정 만들기」  ② 일정 창에서 방식을 고르면 그 약속이 선다
--   ③ 약속을 소화하면 카드가 사라지고 그 방식이 브리핑 값이 된다
-- 그래서 일정도 방식을 들고 있어야 한다(약속 카드에 「만나서」가 적혀야 하니까).
-- 「현장에서」는 「만나서」와 같은 뜻이라 내린다.
BEGIN;

ALTER TABLE app.schedules ADD COLUMN IF NOT EXISTS method text;

UPDATE ref.enums SET active = false WHERE enum_key = 'brief_how' AND code = '현장에서';
UPDATE app.proposals SET brief_how = array_remove(brief_how, '현장에서')
 WHERE '현장에서' = ANY(brief_how);

INSERT INTO app.schema_migrations(version) VALUES ('0111_sched_method.sql')
ON CONFLICT DO NOTHING;
COMMIT;
