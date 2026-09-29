-- 0199 상태는 사람이 고른다(대표 2026-09-29)
--
-- 자동 판정 엔진을 걷는다. 통화 · 의사 · 명도 같은 칸으로 「지금 어느 단계인가」를 계산하던 사다리는
-- 사용자가 우리 예상대로 칸을 채운다는 보장이 없어 따라올 수 없는 구조였다. 부가 기능이 쓰기를 어렵게 하면 없는 게 낫다.
-- 대신 부기사처럼 **상태를 사무소가 만들고(이름 · 색 · 순서) 매물 · 고객마다 손으로 고른다.**
--
-- · 판정 재료(통화 · 의사 · 급함 · 매도 시기 · 명도 · 용도변경 · 멸실 · 임대 확인)는 **정보 칸으로 남는다**
-- · 사람이 누르는 채택(picked_at) · 안 산다(dropped_at)도 남는다. 계약 일정 완료가 채택을 켜 주던 거울은 코드에서 뺀다
-- · 지우는 것: 사다리 뷰 셋 · nego_rank() · 보류 표(stops). 보류는 이제 상태 값 하나다
-- · 기본 상태(부기사): 매물 작업 · 준비 · 보류 · 완료 / 고객 진행 · 계약 · 보류 · 종료 · 해약. 팀이 생기면 트리거가 넣는다
-- · 완료로 바꿀 때 매각일 · 매각금액을 받는다(부기사 「매물상태변경」)
-- · 지금 매물 · 고객은 미지정(null)으로 시작한다(테스트 계정을 지우고 새로 시작, 대표 09-29)
BEGIN;

CREATE TABLE IF NOT EXISTS app.statuses (
  id         bigserial PRIMARY KEY,
  team_id    bigint NOT NULL REFERENCES app.teams(id) ON DELETE CASCADE,
  kind       text   NOT NULL CHECK (kind IN ('listing','buyer')),
  name       text   NOT NULL CHECK (length(name) BETWEEN 1 AND 12),
  color      text   NOT NULL DEFAULT '#8B95A1' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort       int    NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, kind, name)
);

CREATE OR REPLACE FUNCTION app.seed_statuses(t bigint) RETURNS void LANGUAGE sql AS $$
  INSERT INTO app.statuses(team_id, kind, name, color, sort) VALUES
    (t,'listing','작업','#3182F6',1), (t,'listing','준비','#8B95A1',2), (t,'listing','보류','#F04452',3), (t,'listing','완료','#191F28',4),
    (t,'buyer','진행','#3182F6',1), (t,'buyer','계약','#191F28',2), (t,'buyer','보류','#F04452',3),
    (t,'buyer','종료','#8B95A1',4), (t,'buyer','해약','#B0B8C1',5)
  ON CONFLICT DO NOTHING;
$$;
CREATE OR REPLACE FUNCTION app.t_team_statuses() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM app.seed_statuses(NEW.id); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS team_statuses ON app.teams;
CREATE TRIGGER team_statuses AFTER INSERT ON app.teams FOR EACH ROW EXECUTE FUNCTION app.t_team_statuses();
SELECT app.seed_statuses(id) FROM app.teams;

ALTER TABLE app.listings ADD COLUMN IF NOT EXISTS status_id bigint REFERENCES app.statuses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sold_on date, ADD COLUMN IF NOT EXISTS sold_price bigint;
ALTER TABLE app.buyers ADD COLUMN IF NOT EXISTS status_id bigint REFERENCES app.statuses(id) ON DELETE SET NULL;

-- 자동 판정 엔진
DROP VIEW IF EXISTS app.v_listing_stage;
DROP VIEW IF EXISTS app.v_buyer_stage;
DROP VIEW IF EXISTS app.v_proposal_stage;
DROP FUNCTION IF EXISTS app.nego_rank(app.proposals);
DROP TABLE IF EXISTS app.stops;
DROP TABLE IF EXISTS app._proposals_bak_0141;
DROP TABLE IF EXISTS app._proposal_events_bak_0141;

COMMIT;
