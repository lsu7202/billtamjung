-- 매수자 투자 가정(2026-08-27) — 자기자본·대출금리·취득 부대비용률.
-- 이 셋은 매물이 아니라 **그 사람의 형편**이라 매수자에 붙는다. 한 번 적으면 담은 매물
-- 전부에 그대로 적용돼, 매물마다 같은 숫자를 다시 치지 않는다.
-- 미지정은 null — 금리를 안 물어봤는데 4%로 채우면 안 한 계산이 화면에 선다.
ALTER TABLE app.buyers
  ADD COLUMN IF NOT EXISTS equity_won bigint,          -- 자기자본(원)
  ADD COLUMN IF NOT EXISTS loan_rate  numeric(5,2),    -- 대출 금리(연 %)
  ADD COLUMN IF NOT EXISTS fee_pct    numeric(5,2);    -- 취득 부대비용률(%)
