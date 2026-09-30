-- 0201 보류 사유(대표 2026-09-29)
--
-- 상태 「보류」를 고르면 사유를 하나 받는다. 화면은 「보류」 대신 **사유만** 빨갛게 보인다(빨강이 곧 보류).
-- 사다리 단계별로 갈라져 있던 옛 사유 사전(stop_reason_*)은 사다리와 함께 의미를 잃어 지우고, 한 목록으로 합친다.
--   매물: 매각됨 · 안판다 · 나중에 · 연락두절 · 통화거부 · 연락처못캠 · 매수자없음 · 가격 · 수익률 · 물건자체 · 기타
--         (매도의사없음 → 안판다로 합침 · 담당못찾음 뺌)
--   고객: 매물없음 · 자금 · 기타
-- 보류가 아닌 상태로 바꾸면 사유는 비운다(API).
BEGIN;
ALTER TABLE app.listings ADD COLUMN IF NOT EXISTS hold_reason text;
ALTER TABLE app.buyers   ADD COLUMN IF NOT EXISTS hold_reason text;

DELETE FROM ref.enums       WHERE enum_key LIKE 'stop_reason_%';
DELETE FROM ref.enum_groups WHERE enum_key LIKE 'stop_reason_%';

INSERT INTO ref.enum_groups(enum_key, label) VALUES
  ('hold_reason_listing', '보류 사유 · 매물'), ('hold_reason_buyer', '보류 사유 · 고객')
ON CONFLICT DO NOTHING;
INSERT INTO ref.enums(enum_key, code, label, sort_order)
SELECT 'hold_reason_listing', x, x, i FROM unnest(ARRAY['매각됨','안판다','나중에','연락두절','통화거부','연락처못캠',
  '매수자없음','가격','수익률','물건자체','기타']) WITH ORDINALITY t(x, i)
ON CONFLICT DO NOTHING;
INSERT INTO ref.enums(enum_key, code, label, sort_order)
SELECT 'hold_reason_buyer', x, x, i FROM unnest(ARRAY['매물없음','자금','기타']) WITH ORDINALITY t(x, i)
ON CONFLICT DO NOTHING;
COMMIT;
