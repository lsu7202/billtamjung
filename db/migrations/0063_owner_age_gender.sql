-- 0063 · 매도자에게도 나이대·성별
--
-- 매수자(app.buyers)에는 age_band·gender 가 있는데 매도자에는 없었다. 사람을 파악하는
-- 항목이 한쪽에만 있으면 두 장부가 같은 사람 정보를 다르게 든다.
-- 값 목록은 매수자와 **같은 enum**(buyer_age·buyer_gender)을 쓴다 — 새 어휘를 만들지 않는다.

BEGIN;

ALTER TABLE app.owners ADD COLUMN IF NOT EXISTS age_band text;
ALTER TABLE app.owners ADD COLUMN IF NOT EXISTS gender   text;

COMMIT;
