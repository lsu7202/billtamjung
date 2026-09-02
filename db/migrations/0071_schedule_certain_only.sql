-- 0071 · 일정은 확실한 것만 — 「일정 후보」를 걷는다
--
-- 왜: 0070에서 불확실한 약속(「다음주 중에 계약」·「내년에 다시 연락」)을 창(from~to)으로
--   따로 세웠다. 써 보니 관리가 안 된다 — 창은 아무 행동도 부르지 않는다. 언제 확인할지,
--   언제 지울지, 지났으면 뭘 해야 하는지가 전부 애매해서 목록만 길어진다.
--   말 자체는 기록(커밋)에 그대로 남으므로 잃는 정보도 없다. 날이 잡히면 그때 한 줄 더 친다.
--
-- 캘린더에 서는 것은 **날짜가 하나로 떨어지는 약속**뿐이다.

BEGIN;

DELETE FROM app.schedules WHERE NOT certain;

ALTER TABLE app.schedules DROP COLUMN IF EXISTS certain;
ALTER TABLE app.schedules DROP COLUMN IF EXISTS from_date;
ALTER TABLE app.schedules DROP COLUMN IF EXISTS to_date;
ALTER TABLE app.schedules ALTER COLUMN on_date SET NOT NULL;

DROP INDEX IF EXISTS app.schedules_team_from;
DROP INDEX IF EXISTS app.schedules_team_on;
CREATE INDEX IF NOT EXISTS schedules_team_on ON app.schedules (team_id, on_date);

COMMIT;
