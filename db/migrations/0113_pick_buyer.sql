-- 채택(2026-08-19) — 「이 사람과 간다」. 매칭의 끝이자 계약 절차의 문턱이다.
--   채택하면 그 쌍의 **가격이 확정**되고(deal_price) 매칭 칸이 초록이 된다.
--   다른 매수자는 건드리지 않는다 — 계약 전엔 언제든 뒤집히므로 자동 거절은 위험하다
--   (조사: ShowingTime 은 수락 시 나머지를 자동 거절하지만, 그건 계약서까지 붙는 미국 MLS 얘기다).
BEGIN;

ALTER TABLE app.proposals ADD COLUMN IF NOT EXISTS picked_at timestamptz;

INSERT INTO app.schema_migrations(version) VALUES ('0113_pick_buyer.sql')
ON CONFLICT DO NOTHING;
COMMIT;
