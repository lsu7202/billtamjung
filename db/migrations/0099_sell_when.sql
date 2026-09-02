-- 매도 시기(2026-08-18·아티팩트 ③ 복원) — 「원함인데 26년 봄」처럼 팔 의사가 있으면서
-- 시기가 있는 경우의 자리. 정지의 깨우는 조건과 **다르다** — 정지는 연락할 차례에서
-- 빼버리지만, 시기는 원함인 채로 남는 정보다. 낱말은 깨움과 같은 것을 쓴다(wake_vague).
BEGIN;

ALTER TABLE app.listings ADD COLUMN IF NOT EXISTS sell_on date;      -- 날짜로 아는 경우
ALTER TABLE app.listings ADD COLUMN IF NOT EXISTS sell_vague text;   -- 막연한 시점(봄·연말…)

INSERT INTO app.schema_migrations(version) VALUES ('0099_sell_when.sql')
ON CONFLICT DO NOTHING;
COMMIT;
