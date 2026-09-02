-- 0054 · 계약 상태 분리 — 계약중 / 계약완료
--
-- 커밋 상태 집합(2026-08-10 확정): 후보 → 제안 → 관심 → 거절 → 계약중 → 계약완료.
-- 기존 '계약'은 "성사됐다"는 뜻이었으므로 계약완료로 옮긴다.

BEGIN;

UPDATE app.proposals       SET status = '계약완료' WHERE status = '계약';
UPDATE app.proposal_events SET status = '계약완료' WHERE status = '계약';

COMMIT;
