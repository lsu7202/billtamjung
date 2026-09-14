-- 0138 · 합의 단계를 잔금 이후까지 늘린다 (2026-08-28)
--
-- 지금은 계약이 끝나고 잔금 일정이 남아 있어도 현황판에서 「계약예정」으로 서 있었다.
-- nego_rank 가 계약 일정 완료(4)에서 멈춰 있고, 그 뒤 중도금·잔금을 안 봤기 때문이다.
-- 거래는 계약으로 끝나지 않는다 — 중개보수도 잔금 날 받는다.
--
--   1 합의 전 · 2 합의중 · 3 계약예정 · 4 계약완료 · 5 중도금 · 6 거래종료(잔금 완료)
--
-- 중도금은 있는 거래도 없는 거래도 있어 **일정이 잡혀 완료됐을 때만** 5로 선다.
-- 잔금이 끝나면 중도금 유무와 무관하게 6이다.

CREATE OR REPLACE FUNCTION app.nego_rank(p app.proposals)
 RETURNS integer
 LANGUAGE sql
 STABLE
AS $function$
  SELECT CASE
    WHEN p.status IN ('철회','계약파기') THEN 0
    WHEN EXISTS (SELECT 1 FROM app.schedules s
                  WHERE s.proposal_id = p.id AND s.category='잔금' AND s.state='완료')
         AND p.picked_at IS NOT NULL                            THEN 6   -- 거래종료
    WHEN EXISTS (SELECT 1 FROM app.schedules s
                  WHERE s.proposal_id = p.id AND s.category='중도금' AND s.state='완료')
         AND p.picked_at IS NOT NULL                            THEN 5   -- 중도금
    WHEN EXISTS (SELECT 1 FROM app.schedules s
                  WHERE s.proposal_id = p.id AND s.category='계약' AND s.state='완료')
         AND p.picked_at IS NOT NULL                            THEN 4   -- 계약완료
    WHEN p.picked_at IS NOT NULL                                THEN 3   -- 계약예정
    WHEN p.hope_price IS NOT NULL
         OR COALESCE(array_length(p.brief_how, 1), 0) > 0       THEN 2   -- 합의중
    ELSE 1                                                               -- 합의 전
  END;
$function$;
