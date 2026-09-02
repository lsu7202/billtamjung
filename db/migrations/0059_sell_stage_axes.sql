-- 0059 · 매도 진행상태를 큰 축으로 + 접촉 이력을 장부로
--
-- 왜(축): 매도자와 할 일은 셋이다 — **팔 건지 / 팔면 얼마에 / 계약**.
--   기존 7칸(미지정·리드·준비중·진행중·가격제시·매각·철회)은 이 셋을 담기엔 잘고,
--   「준비중」과 「진행중」은 무엇이 다른지 쓰는 사람이 매번 헷갈렸다. 매수를 넷으로 줄인
--   0057과 같은 이유다 — 단계 사이의 사정은 상태가 아니라 기록이 말한다.
--
--   리드      아직 팔 건지 모른다(접촉만 함)
--   매도의향  팔겠다고 했다
--   가격제시  얼마에 팔지 말했다
--   계약      성사
--   철회      안 팔겠다(줄기에서 꺾임)
--
-- 왜(장부): 접촉 이력에 status 를 둔다. 그래야 「이 통화로 무엇이 바뀌었나」가 한 줄에 남고,
--   매수의 진행 기록(proposal_events)과 같은 방식으로 읽힌다.

BEGIN;

-- ── 상태 값 이관 ────────────────────────────────────────
UPDATE app.listings SET status = '리드'     WHERE status IN ('미지정', '준비중');
UPDATE app.listings SET status = '매도의향' WHERE status = '진행중';
UPDATE app.listings SET status = '계약'     WHERE status = '매각';

-- ── enum 레지스트리 ─────────────────────────────────────
DELETE FROM ref.enums WHERE enum_key = 'jindo';
INSERT INTO ref.enums(enum_key, code, label, sort_order, active) VALUES
  ('jindo', '리드',     '리드',     1, true),
  ('jindo', '매도의향', '매도의향', 2, true),
  ('jindo', '가격제시', '가격제시', 3, true),
  ('jindo', '계약',     '계약',     4, true),
  ('jindo', '철회',     '철회',     5, true);

-- ── 접촉 이력 = 장부 ────────────────────────────────────
-- 이 접촉으로 단계가 무엇이 됐나. 비어 있으면 단계는 그대로고 기록만 남은 것이다.
ALTER TABLE app.contacts ADD COLUMN IF NOT EXISTS status text;

COMMIT;
