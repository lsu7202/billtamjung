-- 의사 칸 정리(2026-08-18): 「원치않음」은 의사의 값이 아니라 **정지 그 자체**다 —
-- 거절은 stop_reason_intent(안판다·나중에)로만 표현한다. 칩은 「원함」 하나(토글).
-- 급함의 「안팔아도됨」도 내린다 — 원함(팔 의사)과 모순되는 낱말이라 함께 서면 말이 안 된다.
BEGIN;

UPDATE ref.enums SET active = false
 WHERE (enum_key = 'intent'  AND code = '원치않음')
    OR (enum_key = 'urgency' AND code = '안팔아도됨');

-- 이미 찍힌 값은 정지로 옮기지 않고 비운다(미지정은 null) — 로컬 시드뿐이라 잃는 것 없음
UPDATE app.listings SET intent  = NULL WHERE intent  = '원치않음';
UPDATE app.listings SET urgency = NULL WHERE urgency = '안팔아도됨';

INSERT INTO app.schema_migrations(version) VALUES ('0094_intent_wants_only.sql')
ON CONFLICT DO NOTHING;
COMMIT;
