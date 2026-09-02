-- 0081: 사건 거울(0067 계약·계약파기 자동 줄)도 원본 커밋을 기억한다.
--
-- 왜: 참석자 거울은 0079(src_schedule_id)로 원본을 기억하는데, 계약 거울은 안 그랬다.
--     그래서 ① 매물 합본에 같은 사건이 두 줄(원본 + 「매도자 쪽 계약」 자동)로 서고
--     ② 거두기가 「마지막 auto 줄」 추측으로 지웠다(다른 계약의 거울을 잘못 걷을 수 있다).
--     기억해야 접고, 기억해야 정확히 걷는다 — 참석자 거울과 같은 규칙.
ALTER TABLE app.contacts        ADD COLUMN IF NOT EXISTS src_event_id  bigint;
ALTER TABLE app.proposal_events ADD COLUMN IF NOT EXISTS src_contact_id bigint;
CREATE INDEX IF NOT EXISTS contacts_src_event_idx
  ON app.contacts(src_event_id) WHERE src_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS proposal_events_src_contact_idx
  ON app.proposal_events(src_contact_id) WHERE src_contact_id IS NOT NULL;
