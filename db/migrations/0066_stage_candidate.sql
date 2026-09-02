-- 0066 · 첫 단계는 「후보」로 통일 — 0065의 '관심'을 되돌린다
--
-- 매수·매도 모두 「후보」다. 이 도구의 시점은 항상 중개인이라 양쪽이 같은 단계다 —
-- 매수 후보 = 이 매수자에게 보여줄 후보 매물, 매도 후보 = 매물이 될지 모르는 후보 소유자.
--
-- '관심'을 버린 이유: **일상 발화와 충돌한다.** 제안을 돌리면 매수자가 「관심 보임」이라고
-- 답하는 일이 아주 흔한데, 상태 이름이 관심이면 그 문장을 친 순간 제안 단계가 관심(제안 전)
-- 으로 역행하는 것처럼 읽힌다. 파서가 예외로 막을 수는 있어도, 상태 이름과 일상 문장이
-- 겹치는 단어는 같은 함정을 계속 만든다. '후보'는 그 충돌이 없다.
--
--   매수  후보 · 제안 · 거절 · 계약 · 계약파기
--   매도  후보 · 제안 · 철회 · 계약 · 계약파기   ← 철회만 다름(주체가 다르고 거울 전파 없음)

BEGIN;

UPDATE app.proposals       SET status = '후보' WHERE status = '관심';
UPDATE app.proposal_events SET status = '후보' WHERE status = '관심';
UPDATE app.listings        SET status = '후보' WHERE status = '관심';
UPDATE app.contacts        SET status = '후보' WHERE status = '관심';

DELETE FROM ref.enums WHERE enum_key = 'jindo';
INSERT INTO ref.enums(enum_key, code, label, sort_order, active) VALUES
  ('jindo', '미지정',   '미지정',   0, true),   -- 담아만 두고 아직 아무 기록 없음(0062)
  ('jindo', '후보',     '후보',     1, true),
  ('jindo', '제안',     '제안',     2, true),
  ('jindo', '철회',     '철회',     3, true),
  ('jindo', '계약',     '계약',     4, true),
  ('jindo', '계약파기', '계약파기', 5, true);

COMMIT;
