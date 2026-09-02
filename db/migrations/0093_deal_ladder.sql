-- 0093 · ③제안 사다리 — 후보 → 브리핑 → 임장 → 조율 → 가계약 → 계약 → 잔금 → 완료 (S04b §5)
--
-- ①(0091)·②(0092)와 같은 원칙: 단계는 필드에서 파생, 칸은 각자 근거로 판정.
-- 계약 칸은 새 장치가 없다 — 기존 체인(계약 일정 ✓ = 체결 → resync → status='계약')을 그대로 읽는다.

BEGIN;

-- 단계의 근거가 되는 필드들. 전부 「그 일이 있었나」의 구조화된 증거다.
ALTER TABLE app.proposals ADD COLUMN IF NOT EXISTS briefed_on   date;    -- 브리핑 — 자료를 보여준 날
ALTER TABLE app.proposals ADD COLUMN IF NOT EXISTS visited_on   date;    -- 임장 — 같이 보러 간 날
ALTER TABLE app.proposals ADD COLUMN IF NOT EXISTS visit_note   text;    -- 임장 — 보고 온 결과
ALTER TABLE app.proposals ADD COLUMN IF NOT EXISTS pre_contract_on     date;    -- 가계약 날
ALTER TABLE app.proposals ADD COLUMN IF NOT EXISTS pre_contract_amount bigint;  -- 가계약(계약금) 금액
ALTER TABLE app.proposals ADD COLUMN IF NOT EXISTS commission_amount   bigint;  -- 수수료
ALTER TABLE app.proposals ADD COLUMN IF NOT EXISTS commission_split    text;    -- 단독 · 공동 · 전속
ALTER TABLE app.proposals ADD COLUMN IF NOT EXISTS report_filed_on     date;    -- 부동산 거래신고한 날

-- 서류 체크리스트(§5.3) — 항목은 조합(매도 개인/법인 × 매수 개인/법인)에서 서버가 만들어 주고,
-- 여기엔 **체크된 것만** 남는다. 행이 없다 = 아직 준비 안 됨.
CREATE TABLE IF NOT EXISTS app.deal_docs (
  id          bigserial PRIMARY KEY,
  team_id     bigint NOT NULL REFERENCES app.teams(id) ON DELETE CASCADE,
  proposal_id bigint NOT NULL REFERENCES app.proposals(id) ON DELETE CASCADE,
  code        text   NOT NULL,          -- 항목 키(서버 체크리스트 정의와 맞물린다)
  done_by     bigint REFERENCES app.accounts(id),
  done_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (proposal_id, code)
);

DROP VIEW IF EXISTS app.v_proposal_stage;
CREATE VIEW app.v_proposal_stage AS
WITH base AS (
  SELECT p.id, p.team_id,
    -- ② 브리핑 — 자료를 보여줬다. 제안이 나갔다면 브리핑은 자명하다(값을 불렀다 = 보여줬다)
    -- 브리핑 완료 = **방식이 찍혔다**(2026-08-18) — 자료 발송·만나서·전화·현장에서.
    -- 날짜는 안 센다: 「언제 보여줬나」는 장부 줄이 시각까지 들고 있다.
    (COALESCE(array_length(p.brief_how, 1), 0) > 0 OR p.proposed_on IS NOT NULL) AS d2_brief,
    -- ③ 임장 — 같이 보러 갔다
    (p.visited_on IS NOT NULL)                                                 AS d3_visit,
    -- ④ 조율 — 양쪽 값이 오간다(0090 side). 상대가 값을 불렀거나(거절가·희망가) 매도 쪽 줄이 섰다
    (p.hope_price IS NOT NULL OR p.reject_price IS NOT NULL
     OR EXISTS (SELECT 1 FROM app.proposal_events pe
                 WHERE pe.proposal_id = p.id AND pe.side = '매도'))            AS d4_nego,
    -- ⑤ 가계약 — 계약금이 오갔다
    (p.pre_contract_on IS NOT NULL OR p.pre_contract_amount IS NOT NULL)       AS d5_pre,
    -- ⑥ 계약 — 계약서를 썼다(계약 일정 ✓ = 체결의 기존 체인이 status 를 만든다)
    (p.status = '계약')                                                        AS d6_sign,
    -- ⑦ 잔금 — 잔금 일정이 완료됐다
    EXISTS (SELECT 1 FROM app.schedules s
             WHERE s.proposal_id = p.id AND s.category = '잔금'
               AND s.state = '완료')                                           AS d7_pay,
    -- ⑧ 완료 — 잔금 + 30일 거래신고(중개사 본인의 법적 의무·과태료 500만원)
    (p.report_filed_on IS NOT NULL)                                            AS d8_file,
    p.status
  FROM app.proposals p
)
SELECT id, team_id, d2_brief, d3_visit, d4_nego, d5_pre, d6_sign, d7_pay, d8_file,
       CASE WHEN status IN ('철회', '계약파기') THEN 'out'    -- 이탈 — 배지는 화면이 따로 단다
            WHEN NOT d2_brief THEN 'brief'
            WHEN NOT d4_nego  THEN 'nego'
            WHEN NOT d5_pre   THEN 'pre'
            WHEN NOT d6_sign  THEN 'sign'
            WHEN NOT d7_pay   THEN 'pay'
            WHEN NOT d8_file  THEN 'file'
            ELSE 'done' END                                     AS stage
  FROM base;

COMMENT ON VIEW app.v_proposal_stage IS
  '제안 사다리 단계 — 필드에서 파생(S04b §5). stage = 처음 못 넘은 칸 · out = 이탈.';

COMMIT;
