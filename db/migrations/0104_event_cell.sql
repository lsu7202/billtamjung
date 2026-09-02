-- 창의 커밋은 그 창의 것(2026-08-18) — 거래 창(브리핑·임장·계약·잔금)도 예외가 아니다.
-- 제안 장부 한 벌을 넷이 공유하던 걸 칸 표시로 가른다. 값이 비면 예전 줄(조율·제안 왕복).
BEGIN;

ALTER TABLE app.proposal_events ADD COLUMN IF NOT EXISTS cell text;
CREATE INDEX IF NOT EXISTS proposal_events_cell_idx ON app.proposal_events(proposal_id, cell);

INSERT INTO app.schema_migrations(version) VALUES ('0104_event_cell.sql')
ON CONFLICT DO NOTHING;
COMMIT;
