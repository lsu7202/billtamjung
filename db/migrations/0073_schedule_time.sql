-- 0073 · 일정에 시각 — 있으면 쓰고, 없으면 없는 대로 둔다
--
-- 왜: 「내일 2시에 보기로」와 「내일 보기로」는 다른 말이다. 앞엣것은 시각이 정해졌고
--   뒤엣것은 그 날 안에 만나기로 한 것이다. 시각을 못 받으면 앞엣것도 뒤엣것처럼 남는다.
--
-- 안 말했을 때 무엇을 넣을 것인가 — **아무것도 안 넣는다(NULL)**.
--   9시로 채워 두면 캘린더에 「9시」라고 적히고, 그건 아무도 한 적 없는 약속이다.
--   화면에서는 시각 있는 것들 뒤에 「시간 미정」으로 세운다. 미정인 채로 두는 게
--   거짓 시각보다 낫다 — data-overview 의 「null=미지정」과 같은 태도다.

BEGIN;

ALTER TABLE app.schedules ADD COLUMN IF NOT EXISTS at_time time;
CREATE INDEX IF NOT EXISTS schedules_team_on_at ON app.schedules (team_id, on_date, at_time NULLS LAST);

COMMIT;
