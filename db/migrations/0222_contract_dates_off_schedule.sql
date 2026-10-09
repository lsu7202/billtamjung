-- 0222 계약 날짜는 짝의 칸이다 — 일정이 매물에 영향을 주는 선을 끊는다(2026-10-04 대표)
--
-- 예전엔 매물 모달의 계약일 · 중도금(날짜 · 금액) · 잔금일이 일정 줄을 그릇으로 썼다
-- (category 계약 · 중도금 · 잔금, 중도금 금액은 schedules.amount). 계약서도 거기서 읽었다.
-- 이제 짝(proposals) 칸에 둔다. 일정은 일정대로 남고 매물 쪽으로 아무것도 쓰지 않는다.
-- 일정 줄은 지우지 않는다 — 달력에 그대로 선다.

ALTER TABLE app.proposals
  ADD COLUMN IF NOT EXISTS contract_on date,     -- 계약일
  ADD COLUMN IF NOT EXISTS mid_on      date,     -- 중도금 날짜
  ADD COLUMN IF NOT EXISTS mid_amount  bigint,   -- 중도금 금액
  ADD COLUMN IF NOT EXISTS balance_on  date;     -- 잔금일

-- 짝에 붙은 일정에서 한 번 옮긴다(종류마다 가장 늦게 잡힌 것)
UPDATE app.proposals p SET contract_on = s.on_date
  FROM (SELECT DISTINCT ON (proposal_id) proposal_id, on_date FROM app.schedules
         WHERE category = '계약' AND proposal_id IS NOT NULL ORDER BY proposal_id, on_date DESC) s
 WHERE s.proposal_id = p.id AND p.contract_on IS NULL;
UPDATE app.proposals p SET mid_on = s.on_date, mid_amount = COALESCE(p.mid_amount, s.amount)
  FROM (SELECT DISTINCT ON (proposal_id) proposal_id, on_date, amount FROM app.schedules
         WHERE category = '중도금' AND proposal_id IS NOT NULL ORDER BY proposal_id, on_date DESC) s
 WHERE s.proposal_id = p.id AND p.mid_on IS NULL;
UPDATE app.proposals p SET balance_on = s.on_date
  FROM (SELECT DISTINCT ON (proposal_id) proposal_id, on_date FROM app.schedules
         WHERE category = '잔금' AND proposal_id IS NOT NULL ORDER BY proposal_id, on_date DESC) s
 WHERE s.proposal_id = p.id AND p.balance_on IS NULL;
