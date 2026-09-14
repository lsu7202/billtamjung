-- 0057 · 제안 상태를 큰 축 넷으로 — 후보 · 제안 · 계약 · 거절
--
-- 왜: 제안과 계약 사이는 경우의 수가 너무 많다. 「128억에 제안했더니 120억으로 줄여달라 해서
--     매도자에게 다시 연락했다」 같은 일이 상태 하나로 안 접힌다. 억지로 접으려고 '관심'을
--     뒀지만, 관심은 단계가 아니라 그날 있었던 일이다 — 그런 건 장부(proposal_events)에
--     기록으로 남기면 된다. 상태는 큰 축만 들고, 사이의 사정은 기록이 말한다.
--
-- 접기: 관심 → 제안(아직 답을 기다리는 단계다) · 계약중/계약완료 → 계약
--       reject_price 는 이제 '상대가 부른 값'으로도 쓴다(거절 상한 + 역제안).

BEGIN;

UPDATE app.proposals       SET status = '제안' WHERE status = '관심';
UPDATE app.proposal_events SET status = '제안' WHERE status = '관심';

UPDATE app.proposals       SET status = '계약' WHERE status IN ('계약중', '계약완료');
UPDATE app.proposal_events SET status = '계약' WHERE status IN ('계약중', '계약완료');

COMMIT;
