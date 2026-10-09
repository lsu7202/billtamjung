-- 0219 플랜 삭제 · 직함은 계정 직급 하나로 · 프로필 사진(2026-10-04 대표)
--
-- 1) 플랜(tier · 무료체험 기간) — 지금 필요 없는 기능이라 개념째 지운다. 토큰에서도 뺐다.
-- 2) 사무소 「직함」(teams.agent_title)은 사람 값을 사무소에 하나 더 둔 것이었다.
--    사람의 직함은 계정 「직급」(accounts.job_title) 하나다. 이름이 같은 팀원의 직급이 비어 있으면 옮겨 둔다.
--    칸(teams.agent_title)은 지우지 않는다 — 화면 · 읽는 곳만 끊는다.
-- 3) 프로필 사진 — 저장소 키(사무소 로고와 같은 방식).

UPDATE app.accounts a SET job_title = t.agent_title
  FROM app.teams t JOIN app.team_members m ON m.team_id = t.id AND m.left_at IS NULL
 WHERE m.account_id = a.id AND a.name = t.agent_name
   AND NULLIF(t.agent_title, '') IS NOT NULL AND NULLIF(a.job_title, '') IS NULL;

ALTER TABLE app.accounts DROP COLUMN IF EXISTS tier,
                         DROP COLUMN IF EXISTS trial_started_at,
                         DROP COLUMN IF EXISTS trial_ends_at;

ALTER TABLE app.accounts ADD COLUMN IF NOT EXISTS photo_path text;
