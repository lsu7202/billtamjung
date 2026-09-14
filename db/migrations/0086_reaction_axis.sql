-- 0086: 거절·수락은 상태가 아니라 **제안의 갈래(답글)**다.
--
-- 축 재정의(2026-08-15): 상태 = 관계가 어디 있나(후보→제안→계약 / 이탈: 철회·계약파기 —
-- 양측 대칭). 거절은 특정 제안에 대한 답이라 관계를 끝내지 않는다(재제안이 일상이다).
-- 판에서 발을 뺀 것만 철회다. 화면의 「제안수락·제안거절」은 마지막 제안의 마지막 답글에서
-- 파생된다 — 저장하지 않는다.
ALTER TABLE app.proposal_events ADD COLUMN IF NOT EXISTS reaction text;

-- 기존 거절 상태 이벤트 → 무단계 거절 답글
UPDATE app.proposal_events SET reaction = '거절', status = NULL WHERE status = '거절';

-- 답글 링크 백필 — 같은 관계의 직전 제안 이벤트에
UPDATE app.proposal_events e SET reply_to_event_id = (
  SELECT o.id FROM app.proposal_events o
   WHERE o.proposal_id = e.proposal_id AND o.status = '제안'
     AND (o.created_at, o.id) < (e.created_at, e.id)
   ORDER BY o.created_at DESC, o.id DESC LIMIT 1)
 WHERE e.reaction = '거절' AND e.reply_to_event_id IS NULL;

-- 거절이던 관계는 마지막 단계로 복귀(상태 = 장부의 파생값)
UPDATE app.proposals p SET status = COALESCE((
  SELECT e.status FROM app.proposal_events e
   WHERE e.proposal_id = p.id AND e.status IS NOT NULL
   ORDER BY e.created_at DESC, e.id DESC LIMIT 1), '후보')
 WHERE p.status = '거절';
