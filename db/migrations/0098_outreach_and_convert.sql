-- D 구현(2026-08-18) — 아티팩트→S04b 사이에 소리 없이 떨어졌던 것들 복원.
-- ② 공동중개 발송: 노출은 광고만이 아니다 — 바깥 부동산에 뿌린 것도 「나가 있다」다.
BEGIN;

ALTER TABLE app.listings ADD COLUMN IF NOT EXISTS co_sent_on date;

INSERT INTO app.schema_migrations(version) VALUES ('0098_outreach_and_convert.sql')
ON CONFLICT DO NOTHING;
COMMIT;
