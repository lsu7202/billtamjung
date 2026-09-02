-- 0092 · ②매수자 사다리 — 확보 → 접촉 → 조건 → 살 물건 찾는 중 (S04b §4)
--
-- 매물(0091)과 같은 원칙: 단계는 사람이 찍지 않고 **필드에서 파생**한다.
-- 칸은 각자 근거로 판정된다 — 사다리는 순서 강제가 아니라 지도다.

BEGIN;

-- 통화 결과 — 매물과 같은 enum(call_result)을 쓴다. 매수자에게도 전화 돌리기가 업무다
-- (「매수로」 — 과거에 판 사람 명단에 전화를 돌려 매수자를 만든다).
ALTER TABLE app.buyers ADD COLUMN IF NOT EXISTS call_result text;

DROP VIEW IF EXISTS app.v_buyer_stage;
CREATE VIEW app.v_buyer_stage AS
WITH base AS (
  SELECT b.id, b.team_id,
    -- ① 확보 — 명단에 이름과 번호가 있다
    (b.phone IS NOT NULL AND b.phone <> '')                                    AS b1_have,
    -- ② 접촉 — 한 번이라도 말이 됐다. 증거는 구조화된 것만(0091과 같은 규칙):
    --    통화됨 칩, 또는 물어봐야 아는 값(등급·긴급도·협조도·친절도)이나 조건이 찍혀 있음.
    (COALESCE(b.call_result, '') = '통화됨'
     OR (b.grade       IS NOT NULL AND b.grade       NOT IN ('', '미지정'))
     OR (b.urgency     IS NOT NULL AND b.urgency     NOT IN ('', '미지정'))
     OR (b.cooperation IS NOT NULL AND b.cooperation NOT IN ('', '미지정'))
     OR (b.kindness    IS NOT NULL AND b.kindness    NOT IN ('', '미지정'))
     OR EXISTS (SELECT 1 FROM app.buyer_conditions c WHERE c.buyer_id = b.id)) AS b2_touch,
    -- ③ 조건 — 이 사람 조건으로 매물을 걸러낼 수 있다
    EXISTS (SELECT 1 FROM app.buyer_conditions c WHERE c.buyer_id = b.id)      AS b3_cond,
    -- ④ 매칭 — 살아 있는 제안이 있다(①매물 사다리와 만났다)
    EXISTS (SELECT 1 FROM app.proposals p
             WHERE p.buyer_id = b.id AND p.status NOT IN ('철회', '계약파기')) AS b4_match
  FROM app.buyers b
  WHERE b.deleted_at IS NULL
)
SELECT id, team_id, b1_have, b2_touch, b3_cond, b4_match,
       CASE WHEN NOT b1_have  THEN 'have'
            WHEN NOT b2_touch THEN 'touch'
            WHEN NOT b3_cond  THEN 'cond'
            WHEN NOT b4_match THEN 'match'
            ELSE 'done' END                                     AS stage,
       (b1_have::int + b2_touch::int + b3_cond::int + b4_match::int) AS passed
  FROM base;

COMMENT ON VIEW app.v_buyer_stage IS
  '매수자 사다리 단계 — 필드에서 파생(S04b §4). stage = 처음 못 넘은 칸.';

COMMIT;
