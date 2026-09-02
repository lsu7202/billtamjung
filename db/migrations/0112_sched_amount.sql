-- 일정 창은 종류마다 묻는 게 다르다(2026-08-19) — 처음엔 한 창이되 종류를 고르면 안이 바뀐다.
--   브리핑  방식(만나서·전화·자료 발송)          ← 0111
--   계약·중도금·잔금  금액                        ← 여기
--   임장·일반  더 물을 것 없음(제목·날짜·참석자)
BEGIN;

ALTER TABLE app.schedules ADD COLUMN IF NOT EXISTS amount bigint;

INSERT INTO app.schema_migrations(version) VALUES ('0112_sched_amount.sql')
ON CONFLICT DO NOTHING;
COMMIT;
