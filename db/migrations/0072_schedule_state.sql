-- 0072 · 일정에 상태와 성격을 준다 — 미뤄지고 깨지고 끝난다
--
-- 왜: 약속은 잡히면 끝이 아니다. 며칠 미뤄지고, 깨지고, 끝난다. 캘린더가 「잡힌 것」만
--   보여주면 지난 칸이 전부 참인지 거짓인지 모를 회색이 된다.
--
--   state  예정 · 완료 · 취소
--   kind   약속(사람이 잡은 것 — 옮기고 끝내고 취소할 수 있다)
--          사건(계약·계약파기 — 이미 일어난 일이라 캘린더에서 못 고친다.
--                고치려면 그 커밋을 고쳐야 한다. 장부가 정본이라는 규칙 그대로다)
--   moved_from  옮겨온 자리 — 「원래 19일이었다」가 남아야 미뤄진 걸 안다

BEGIN;

ALTER TABLE app.schedules ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT '예정';
ALTER TABLE app.schedules ADD COLUMN IF NOT EXISTS kind  text NOT NULL DEFAULT '약속';
ALTER TABLE app.schedules ADD COLUMN IF NOT EXISTS moved_from date;

-- done 은 state 로 흡수한다 — 같은 것을 두 칸에 두면 언젠가 어긋난다
UPDATE app.schedules SET state = '완료' WHERE done;
ALTER TABLE app.schedules DROP COLUMN IF EXISTS done;

-- 이미 들어와 있는 계약·계약파기 줄은 사건이다
UPDATE app.schedules SET kind = '사건' WHERE title IN ('계약', '계약파기');

COMMIT;
