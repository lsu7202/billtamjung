-- 크레딧 제도 폐지(2026-09-24 대표). 코드에서 전부 걷어냈고 표·함수·열을 내린다.
-- 쌓인 값은 베타 체험 크레딧뿐이다(credit_entries 16줄 · 6계정 / credit_balances 7줄).
BEGIN;
DROP FUNCTION IF EXISTS app.deduct_credit(bigint, integer, bigint);
-- 인자 꼴이 판마다 달라 이름으로 지운다(IF EXISTS 는 꼴이 맞아야 잡는다 — 실제로 안 잡혔다)
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT oid::regprocedure AS sig FROM pg_proc
            WHERE pronamespace='app'::regnamespace AND proname ILIKE '%credit%'
  LOOP EXECUTE 'DROP FUNCTION ' || f.sig || ' CASCADE'; END LOOP;
END $$;
DROP TABLE IF EXISTS app.credit_entries;
DROP TABLE IF EXISTS app.credit_balances;
ALTER TABLE app.reports DROP COLUMN IF EXISTS credits_spent;
COMMIT;
