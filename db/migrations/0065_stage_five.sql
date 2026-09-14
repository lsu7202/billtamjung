-- 0065 · 단계 확정 — 관심 · 제안 · 거절/철회 · 계약 · 계약파기
--
-- ① 매수의 「후보」 → 「관심」. 이 도구의 시점은 항상 중개인이다 —
--    매수 관심 = 이 매수자에게 보여줄까 눈여겨보는 매물, 매도 관심 = 팔지도 모른다고
--    눈여겨보는 소유자. 둘 다 같은 단계라 한 단어로 접는다(칩 다섯 개가 양쪽에서 같아진다).
--
-- ② 「계약파기」 신설. 거절(계약 전 이탈)과 다른 사건이다 — 계약까지 갔다가 계약서를
--    못 썼거나 계약금을 물고 깨진 것. 거절 사유(가격·위치…)가 안 맞고, 거절 패턴 집계를
--    오염시키면 안 되며, 「진짜 살 뻔한 사람」이라는 정보가 배지에 남아야 한다.
--    계약파기는 한 계약의 양면이라 매수·매도 같은 단어를 쓴다(자동화 때 거울 전파).
--
--   매수  관심 · 제안 · 거절 · 계약 · 계약파기
--   매도  관심 · 제안 · 철회 · 계약 · 계약파기   ← 철회만 다름(주체가 다르고 거울 전파 없음)

BEGIN;

UPDATE app.proposals       SET status = '관심' WHERE status = '후보';
UPDATE app.proposal_events SET status = '관심' WHERE status = '후보';

INSERT INTO ref.enums(enum_key, code, label, sort_order, active)
SELECT 'jindo', '계약파기', '계약파기', 5, true
WHERE NOT EXISTS (SELECT 1 FROM ref.enums WHERE enum_key='jindo' AND code='계약파기');

COMMIT;
