-- 매수자 사다리 정리(2026-08-18) — 확보·접촉·조건은 **한 칸**이다.
-- 실무에서 셋은 한 통화에서 같이 끝난다(이름 받고 말 되고 조건 듣는 게 한 자리다).
-- 그 뒤는 매물과 같은 레일을 쓴다: 매칭 → 브리핑 → … → 신고.
BEGIN;

DROP VIEW IF EXISTS app.v_buyer_stage;
CREATE VIEW app.v_buyer_stage AS
WITH base AS (
  SELECT b.id, b.team_id,
    -- ① 매수자 — 누구인지 알고(전화) **무엇을 원하는지 안다**(조건).
    --    통화 결과·성향은 같은 창에서 받지만 판정에는 안 넣는다 — 조건이 곧 접촉의 증거다.
    ((b.phone IS NOT NULL AND b.phone <> '')
     AND EXISTS (SELECT 1 FROM app.buyer_conditions c WHERE c.buyer_id = b.id))  AS b1_buyer,
    -- ② 매칭 — 살아있는 쌍이 있다(그 뒤 칸은 제안 사다리 v_proposal_stage 가 잇는다)
    EXISTS (SELECT 1 FROM app.proposals p
             WHERE p.buyer_id = b.id AND p.status NOT IN ('철회', '계약파기'))   AS b4_match
  FROM app.buyers b
  WHERE b.deleted_at IS NULL
)
SELECT id, team_id, b1_buyer, b4_match,
       CASE WHEN NOT b1_buyer THEN 'buyer'
            WHEN NOT b4_match THEN 'match'
            ELSE 'done' END                                     AS stage,
       (b1_buyer::int + b4_match::int)                          AS passed
  FROM base;

COMMENT ON VIEW app.v_buyer_stage IS
  '매수자 사다리 — 매수자(확보·접촉·조건 한 칸) → 매칭. 그 뒤는 제안 사다리(0093).';

INSERT INTO app.schema_migrations(version) VALUES ('0106_buyer_one_cell.sql')
ON CONFLICT DO NOTHING;
COMMIT;
