-- 0023_team_collab.sql — 정식 팀 협업(초대·제외·탈퇴·승계) 지원
-- 근거: specs/03-features/S0M-마이페이지.md §3.2~3.6 · 기능목록-베타vs정식.md(정식 ①)
BEGIN;

-- 한 계정 = 동시에 활성 팀 1개(초대 수락/탈퇴 시 이동). _issue/refresh의 team_id 도출 결정성 보장.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_membership
  ON app.team_members(account_id) WHERE left_at IS NULL;

-- 수락자 추적(누가 초대를 소진했는지). 초대는 이미 team_invites(0003)에 존재.
ALTER TABLE app.team_invites ADD COLUMN IF NOT EXISTS accepted_by bigint REFERENCES app.accounts(id);
ALTER TABLE app.team_invites ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

-- 대기 초대 목록 조회용
CREATE INDEX IF NOT EXISTS team_invites_pending ON app.team_invites(team_id) WHERE status='pending';

COMMIT;
