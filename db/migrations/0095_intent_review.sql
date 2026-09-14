-- 의사 값(2026-08-18 확정): 원함 · 검토. 거절(원치않음)은 값이 아니라 정지(0094).
-- 검토 = 팔까 생각 중 — 확인 끝(초록)이 아니라 진행(노랑)이다.
BEGIN;

INSERT INTO ref.enums(enum_key, code, label, sort_order)
VALUES ('intent', '검토', '검토', 25)
ON CONFLICT (enum_key, code) DO UPDATE SET active = true, sort_order = 25;

INSERT INTO app.schema_migrations(version) VALUES ('0095_intent_review.sql')
ON CONFLICT DO NOTHING;
COMMIT;
