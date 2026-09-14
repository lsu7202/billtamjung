-- 0079 · 거울 줄에 원본 링크 — 걷을 수 있어야 거울이다
--
-- QA(2026-08-14 밤)에서 확인된 구멍 셋:
--   H1  약속의 참석자 거울 커밋(「8/15 14:00 계약」이 참석자 장부에 서는 줄)이
--       원본 일정·커밋을 지워도 남았다 — 링크가 없어 누가 낳았는지 몰랐다.
--   H2  완료를 예정으로 되돌려도 장부의 「완료」 로그가 남아 거짓말을 했다.
--   H4  제안을 지워도 그 제안의 일정이 캘린더에 유령으로 남았다.
--
-- 고치는 법은 하나다: **거울로 태어난 줄은 자기 원본(일정)을 기억한다.**
-- src_schedule_id 가 그 링크다. 원본이 사라지면 이 링크로 걷는다.

BEGIN;

ALTER TABLE app.contacts        ADD COLUMN IF NOT EXISTS src_schedule_id bigint;
ALTER TABLE app.proposal_events ADD COLUMN IF NOT EXISTS src_schedule_id bigint;
CREATE INDEX IF NOT EXISTS contacts_src_sched ON app.contacts (src_schedule_id) WHERE src_schedule_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_src_sched   ON app.proposal_events (src_schedule_id) WHERE src_schedule_id IS NOT NULL;

-- 링크 없이 이미 태어난 고아 거울들은 정리한다(백필할 근거가 없다 — QA 재현분 포함)
DELETE FROM app.contacts WHERE auto AND target_type IN ('buyer','owner')
  AND note ~ '^\d{1,2}/\d{1,2}';
-- 죽은 제안을 가리키는 유령 일정
DELETE FROM app.schedules s WHERE s.proposal_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM app.proposals p WHERE p.id = s.proposal_id);

COMMIT;
