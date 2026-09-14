-- 0056 · '후보' 기록을 맨 앞으로 + 상태 재정렬
--
-- 0055가 후보 기록을 proposals.created_at으로 넣었는데, 0053이 백필한 기록이 그보다
-- 이른 경우가 있었다(효제동: 제안 → 후보 순서로 뒤집힘). 그러면 "마지막 기록 = 현재 상태"가
-- 깨진다. 후보는 언제나 그 제안의 첫 기록이어야 한다.

BEGIN;

-- ① 후보 기록을 가장 이른 기록보다 1초 앞으로
UPDATE app.proposal_events e SET created_at = f.first_at - interval '1 second'
FROM (SELECT proposal_id, min(created_at) AS first_at
        FROM app.proposal_events GROUP BY 1) f
WHERE e.proposal_id = f.proposal_id AND e.status = '후보' AND e.created_at > f.first_at;

-- ② 현재 상태를 마지막 기록에서 다시 뽑는다(기록이 진실).
WITH last AS (
  SELECT DISTINCT ON (proposal_id) proposal_id, status, reject_reason, reject_price, channel
    FROM app.proposal_events ORDER BY proposal_id, created_at DESC, id DESC),
first_prop AS (
  SELECT proposal_id, min(created_at)::date AS first_on, count(*) AS n
    FROM app.proposal_events WHERE status = '제안' GROUP BY 1)
UPDATE app.proposals p SET
  status = l.status,
  reject_reason = l.reject_reason,
  reject_price = l.reject_price,
  channel = l.channel,
  proposed_on = fp.first_on,
  propose_count = COALESCE(fp.n, 0)
FROM last l
LEFT JOIN first_prop fp ON fp.proposal_id = l.proposal_id
WHERE l.proposal_id = p.id;

COMMIT;
