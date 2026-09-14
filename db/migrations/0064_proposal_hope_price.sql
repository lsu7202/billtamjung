-- 0064 · 매수희망가를 제안(매수자×건물)에 — proposals.hope_price
--
-- 매수희망가는 「이 매수자가 이 건물을 얼마에 사고 싶어 하나」다. 매수자가 둘이면 값도 둘이라
-- 건물 하나에 못 붙는다 — 매수자×건물 관계인 app.proposals 가 맞는 자리다.
--
-- S02 가격 협의의 bid_price(건물 오버레이)는 매물상세 탭 개편 때 정리한다 —
-- 그때 「열린 제안들의 hope_price 중 최고값」을 보여주는 파생값이 되는 게 자연스럽다.
-- (매도희망가 ask_price 는 건물주×건물이라 건물 오버레이가 원래 맞는 자리 — 그대로 쓴다.)

BEGIN;

ALTER TABLE app.proposals ADD COLUMN IF NOT EXISTS hope_price bigint;   -- 원

COMMIT;
