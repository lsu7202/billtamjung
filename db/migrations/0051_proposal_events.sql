-- 0051 · 제안 이벤트 장부 — 상태 변경을 덮어쓰지 않고 쌓는다
--
-- 왜: proposals는 현재 상태 한 줄이라, 실수로 계약으로 옮겼다 되돌리면 날짜·경위가 증발한다.
--     "언제 제안했고 왜 거절당했나"는 영업의 재산인데 mutable 컬럼에 두면 언젠가 초기화된다
--     (2026-08-10 지시). 현재 상태 = proposals(빠른 조회), 경위 = 여기(append-only).
--
-- 발행 시점 기록: 상태가 바뀔 때마다 한 줄. 거절이면 사유·상한, 브리핑 발송이면 channel도.

BEGIN;

CREATE TABLE IF NOT EXISTS app.proposal_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id      bigint NOT NULL,
  proposal_id  bigint NOT NULL,
  status       text   NOT NULL,          -- 이 시점에 어떤 상태가 됐나
  channel      text,                     -- 브리핑/전화 등(있을 때만)
  reject_reason text,
  reject_price bigint,
  note         text,
  created_by   bigint,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proposal_events_pid_idx ON app.proposal_events (proposal_id, created_at);

COMMIT;
