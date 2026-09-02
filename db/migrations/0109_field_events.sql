-- 값 이력(2026-08-19) — 「125에서 120으로 내렸다」가 협상의 핵심 정보인데 지금은 사라진다.
-- 조사 규범(Salesforce CPQ 견적 버전 · PandaDoc 감사추적): **값을 덮어쓰지 말고 행을 쌓고
-- 「지금 값」은 최신 행이다.** 사람이 친 문장(커밋)과 섞지 않는다 — 여기는 값만.
BEGIN;

CREATE TABLE IF NOT EXISTS app.field_events (
  id          bigserial PRIMARY KEY,
  team_id     bigint NOT NULL REFERENCES app.teams(id) ON DELETE CASCADE,
  target_type text   NOT NULL,          -- listing · proposal
  target_id   text   NOT NULL,
  field       text   NOT NULL,          -- ask_price · sale_price · hope_price · meongdo …
  prev        text,                     -- 이전 값(없으면 최초)
  value       text,                     -- 새 값(null = 지움)
  created_by  bigint REFERENCES app.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS field_events_target_idx
  ON app.field_events(team_id, target_type, target_id, field, created_at);

INSERT INTO app.schema_migrations(version) VALUES ('0109_field_events.sql')
ON CONFLICT DO NOTHING;
COMMIT;
