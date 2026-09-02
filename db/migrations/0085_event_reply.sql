-- 0085: 거절은 제안에 대한 **답글**이다.
--
-- 거절이 관계(매수자×매물)에만 붙으면 장부에서 「170억 제안」과 「거절」이 남남으로 선다.
-- 어느 제안에 대한 답인지를 줄 자체가 기억해야 레일이 스레드로 그려진다(↳).
-- 링크는 서버가 자동으로 건다 — 거절은 항상 그 관계의 마지막 제안에 대한 답이다.
ALTER TABLE app.proposal_events ADD COLUMN IF NOT EXISTS reply_to_event_id bigint;
