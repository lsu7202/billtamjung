-- 0070 · 일정 — 커밋에서 자동으로 태어나는 약속
--
-- 「다음주 수에 브리핑 하기로함」이라고 기록하면 그 자체가 일정이다. 사람이 캘린더에
-- 옮겨 적게 하지 않는다 — 파서가 약속(시간 표현 + 하기로/만나기로…)을 읽어 여기 넣고,
-- 원본 커밋이 지워지면 일정도 걷힌다(거울 전파와 같은 생명주기: 쓰면 생기고 지우면 걷힌다).
--
-- 확실/불확실 두 급:
--   확실   날짜가 하나로 떨어짐(다음주 수·8월 20일) → on_date. 캘린더 칸에 박힌다.
--   불확실 창만 있음(다음주 중·내년) → from_date~to_date. 캘린더 아래 「일정 후보」로 선다.

BEGIN;

CREATE TABLE IF NOT EXISTS app.schedules (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id     bigint NOT NULL,
  side        text   NOT NULL,             -- buy | sell : 어느 장부의 커밋에서 왔나
  event_id    bigint,                      -- buy → proposal_events.id (걷을 때의 열쇠)
  contact_id  bigint,                      -- sell → contacts.id
  proposal_id bigint,                      -- buy: 클릭하면 돌아갈 곳
  building_pk text   NOT NULL,
  title       text   NOT NULL,             -- 무엇을(브리핑·협의·연락…)
  certain     boolean NOT NULL,
  on_date     date,                        -- 확실
  from_date   date, to_date date,          -- 불확실 창
  hint        text,                        -- 원문의 시간 표현(「다음주 중」·「내년」)
  done        boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS schedules_team_on   ON app.schedules (team_id, on_date) WHERE certain;
CREATE INDEX IF NOT EXISTS schedules_team_from ON app.schedules (team_id, from_date) WHERE NOT certain;

COMMIT;
