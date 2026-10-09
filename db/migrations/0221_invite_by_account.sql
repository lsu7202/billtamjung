-- 0221 팀 초대 = 중개사 계정을 골라 보낸다(2026-10-04 대표 「게임 초대처럼」)
--
-- 예전: 이메일 · 전화를 적으면 코드가 나오고, 대표가 코드를 직접 전하고, 받은 사람이 코드를 쳤다.
-- 이제: 관리자가 이름으로 중개사를 찾아 「초대」 → 받은 사람 화면에 「받은 초대」(수락 · 거절).
-- channel · target · token 은 옛 초대 줄에만 남는다(새 줄은 비운다).

ALTER TABLE app.team_invites ADD COLUMN IF NOT EXISTS invitee_account_id bigint REFERENCES app.accounts(id);
ALTER TABLE app.team_invites ALTER COLUMN channel DROP NOT NULL,
                             ALTER COLUMN target  DROP NOT NULL,
                             ALTER COLUMN token   DROP NOT NULL;
ALTER TYPE app.invite_status ADD VALUE IF NOT EXISTS 'declined';

-- 같은 팀이 같은 사람에게 대기 중인 초대는 하나
CREATE UNIQUE INDEX IF NOT EXISTS team_invites_one_pending
  ON app.team_invites(team_id, invitee_account_id) WHERE status = 'pending' AND invitee_account_id IS NOT NULL;
-- 받은 초대 찾기
CREATE INDEX IF NOT EXISTS team_invites_invitee ON app.team_invites(invitee_account_id) WHERE status = 'pending';
