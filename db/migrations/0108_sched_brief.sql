-- 브리핑·임장을 일정 종류로(2026-08-18) — 거래 칸의 날짜는 캘린더가 정본인데,
-- 종류가 「일반」뿐이라 제목 글자로 억지 매칭하고 있었다. 종류로 못 박는다.
-- 임장도 종류로 둔다 — 칸(관문)은 아니지만 **약속은 잡히는 일**이라 캘린더의 시민이다.
BEGIN;

UPDATE app.schedules SET category = '브리핑'
 WHERE category = '일반' AND title LIKE '%브리핑%';
UPDATE app.schedules SET category = '임장'
 WHERE category = '일반' AND (title LIKE '%임장%' OR title LIKE '%보러%');

INSERT INTO app.schema_migrations(version) VALUES ('0108_sched_brief.sql')
ON CONFLICT DO NOTHING;
COMMIT;
