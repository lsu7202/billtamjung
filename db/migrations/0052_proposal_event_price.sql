-- 0052 · 제안 이벤트에 제안가·발행일 개념 보강
--
-- "얼마에 제안했나"는 경위의 핵심 지표인데 빠져 있었다(2026-08-10).
-- 가격을 낮춰 재제안하는 흐름(140억 → 128억)이 장부에 남아야
-- 나중에 "이 매수자는 어느 가격대에서 반응했나"를 읽을 수 있다.

BEGIN;

ALTER TABLE app.proposal_events
  ADD COLUMN IF NOT EXISTS price bigint;    -- 제안가(원) — 발행 시점에 부른 가격

COMMIT;
