-- 협의 어디까지 왔나 — **짝(매수자 하나)의 상태**다(2026-08-20).
--   협의 전  담기만 했다
--   협의중   값이 오갔거나 브리핑을 했다
--   계약예정 계약 상대를 정했다(picked)
--   계약완료 계약 일정을 소화했다
--
-- 매물은 여러 매수자를 달고 있으므로 **그중 가장 앞선 것**이 그 매물의 협의 상태다
-- (김씨는 협의 전, 이씨는 협의중이면 그 매물은 협의중이다).
BEGIN;

CREATE OR REPLACE FUNCTION app.nego_rank(p app.proposals) RETURNS int
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p.status IN ('철회','계약파기') THEN 0
    WHEN EXISTS (SELECT 1 FROM app.schedules s
                  WHERE s.proposal_id = p.id AND s.category='계약' AND s.state='완료')
         AND p.picked_at IS NOT NULL                            THEN 4   -- 계약완료
    WHEN p.picked_at IS NOT NULL                                THEN 3   -- 계약예정
    WHEN p.hope_price IS NOT NULL
         OR COALESCE(array_length(p.brief_how, 1), 0) > 0       THEN 2   -- 협의중
    ELSE 1                                                               -- 협의 전
  END;
$$;

COMMENT ON FUNCTION app.nego_rank(app.proposals) IS
  '짝의 협의 단계 1~4(협의 전·협의중·계약예정·계약완료). 0=판에서 빠진 것(0127).';

INSERT INTO app.schema_migrations(version) VALUES ('0127_nego_state.sql')
ON CONFLICT DO NOTHING;
COMMIT;
