-- 신고 칸은 **체크리스트가 만든다**(2026-08-20).
--   창의 「중개 · 부동산 거래신고」를 체크해도 레일의 신고 칸이 회색으로 남았다.
--   판정이 report_filed_on(날짜 필드)만 봤기 때문인데, 정작 그 날짜를 찍는 자리는 화면에서
--   없앴다(잔금·신고 전용 창 폐기). 체크가 유일한 입구이므로 그것을 근거로 삼는다.
--   날짜를 아는 경우(파서·거울)는 여전히 report_filed_on 이 이긴다 — 둘 중 하나면 참.
BEGIN;

DROP VIEW IF EXISTS app.v_proposal_stage;
CREATE VIEW app.v_proposal_stage AS
WITH base AS (
  SELECT p.id, p.team_id,
    (COALESCE(array_length(p.brief_how, 1), 0) > 0 OR p.proposed_on IS NOT NULL) AS d2_brief,
    (p.visited_on IS NOT NULL)                                                 AS d3_visit,
    (p.hope_price IS NOT NULL OR p.reject_price IS NOT NULL
     OR EXISTS (SELECT 1 FROM app.proposal_events pe
                 WHERE pe.proposal_id = p.id AND pe.side = '매도'))            AS d4_nego,
    (p.pre_contract_on IS NOT NULL OR p.pre_contract_amount IS NOT NULL)       AS d5_pre,
    (p.status = '계약')                                                        AS d6_sign,
    EXISTS (SELECT 1 FROM app.schedules s
             WHERE s.proposal_id = p.id AND s.category = '잔금'
               AND s.state = '완료')                                           AS d7_pay,
    EXISTS (SELECT 1 FROM app.schedules s
             WHERE s.proposal_id = p.id AND s.category = '잔금'
               AND s.state = '예정')                                           AS d7_due,
    -- ⑧ 신고 — 날짜가 찍혔거나 **체크리스트에서 신고를 체크했거나**
    (p.report_filed_on IS NOT NULL
     OR EXISTS (SELECT 1 FROM app.deal_docs d
                 WHERE d.proposal_id = p.id AND d.code = 'r_file'))            AS d8_file,
    p.status
  FROM app.proposals p
)
SELECT id, team_id, d2_brief, d3_visit, d4_nego, d5_pre, d6_sign, d7_pay, d7_due, d8_file,
       jsonb_build_object(
         'pay',  CASE WHEN d7_pay THEN 'done' WHEN d7_due THEN 'busy' ELSE 'none' END,
         'file', CASE WHEN d8_file THEN 'done' ELSE 'none' END
       )                                                        AS cells,
       CASE WHEN status IN ('철회', '계약파기') THEN 'out'
            WHEN NOT d2_brief THEN 'brief'
            WHEN NOT d4_nego  THEN 'nego'
            WHEN NOT d5_pre   THEN 'pre'
            WHEN NOT d6_sign  THEN 'sign'
            WHEN NOT d7_pay   THEN 'pay'
            WHEN NOT d8_file  THEN 'file'
            ELSE 'done' END                                     AS stage
  FROM base;

COMMENT ON VIEW app.v_proposal_stage IS
  '제안 사다리 — 잔금=일정 소화 · 신고=신고일 또는 체크리스트(0124).';

INSERT INTO app.schema_migrations(version) VALUES ('0124_file_by_doc.sql')
ON CONFLICT DO NOTHING;
COMMIT;
