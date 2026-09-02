-- 0083: 제안 장부도 단계 없는 줄(메모)을 받는다.
--
-- 왜: 「일정 내일모레 두시 계약 스타벅스에서」는 단계를 안 옮기는 문장인데, status 가
--     NOT NULL 이라 바가 현재 단계를 도로 찍어 넣었다 — 일정 문장이 「제안」 칩을 달고
--     장부에 서서 재제안처럼 읽혔다(2026-08-15 신고). 매도 쪽(contacts.status)은 원래
--     비울 수 있다 — 같은 규칙으로 맞춘다. 상태 파생(resync)은 단계 있는 줄만 본다.
ALTER TABLE app.proposal_events ALTER COLUMN status DROP NOT NULL;
