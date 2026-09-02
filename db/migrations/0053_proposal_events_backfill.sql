-- 0053 · 제안 이벤트 백필 — 장부(0051) 도입 전에 만들어진 제안들
--
-- 커밋 모델에서 현재 상태 = 마지막 이벤트다. 이벤트가 하나도 없는 제안은
-- 마지막 이벤트를 지우면 근거 없이 후보로 떨어진다. 도입 전 행들에
-- 현재 상태를 첫 커밋으로 넣어 장부를 완결시킨다(시각 = 그 행의 updated_at).

BEGIN;

INSERT INTO app.proposal_events(team_id, proposal_id, status, channel,
                                reject_reason, reject_price, note, created_by, created_at)
SELECT p.team_id, p.id, p.status, p.channel,
       p.reject_reason, p.reject_price, p.note, p.created_by, p.updated_at
FROM app.proposals p
WHERE NOT EXISTS (SELECT 1 FROM app.proposal_events e WHERE e.proposal_id = p.id);

COMMIT;
