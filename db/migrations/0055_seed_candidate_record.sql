-- 0055 · 첫 기록('후보') 보장
--
-- 진행 기록의 바닥은 "리스트에 담았다(후보)"여야 한다. 그게 없으면 마지막 기록을 지울 때
-- 돌아갈 자리가 없다. 후보 기록은 지울 수 없고(지우려면 리스트에서 뺀다),
-- 그래서 모든 제안에 하나씩 있어야 한다(2026-08-11 확정).

BEGIN;

INSERT INTO app.proposal_events(team_id, proposal_id, status, created_by, created_at)
SELECT p.team_id, p.id, '후보', p.created_by, p.created_at
FROM app.proposals p
WHERE NOT EXISTS (
  SELECT 1 FROM app.proposal_events e WHERE e.proposal_id = p.id AND e.status = '후보');

COMMIT;
