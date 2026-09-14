-- C-1 조건 협의(2026-08-18) — 조율은 가격만이 아니다: 명도·멸실의 「언제까지」·이사기간을
-- 특약 원문 그대로 한 줄로 담는다(S04b §6 ③ 조건 협의 시점). 날짜로 쪼개지 않는다 —
-- 실무 문장이 「잔금 전」「1년」처럼 조건형이라, 쪼개는 순간 지어내게 된다(커밋 원문 원칙).
BEGIN;

ALTER TABLE app.proposals ADD COLUMN IF NOT EXISTS terms text;

INSERT INTO app.schema_migrations(version) VALUES ('0097_deal_terms.sql')
ON CONFLICT DO NOTHING;
COMMIT;
