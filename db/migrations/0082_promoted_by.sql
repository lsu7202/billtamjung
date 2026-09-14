-- 0082: 약속 → 사건 승격도 원본 커밋을 기억한다.
--
-- 「계약일」 약속을 잡아 두고 나중에 계약을 적으면 그 약속이 사건으로 **승격**된다(한 사건 =
-- 한 표). 계약 커밋이 지워지면 승격도 되돌아가야 하는데, 어느 커밋이 승격시켰는지를
-- 기억하지 않으면 「그날 그 자리의 사건 표」를 어림해 강등하게 된다 — 어림은 계약파기
-- 표까지 잘못 되돌릴 수 있다. 참석자 거울(0079)·사건 거울(0081)과 같은 규칙: 기억해야 걷는다.
ALTER TABLE app.schedules ADD COLUMN IF NOT EXISTS promoted_by_contact_id bigint;
ALTER TABLE app.schedules ADD COLUMN IF NOT EXISTS promoted_by_event_id   bigint;
