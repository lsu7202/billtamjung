-- 0060 · 매도 단계도 큰 축 셋으로 — 관심 · 제안 · 계약 (+ 철회)
--
-- 왜: 0059에서 다섯(리드·매도의향·가격제시·계약·철회)으로 줄였지만 아직 잘다.
--   「매도의향」과 「가격제시」의 경계는 실제로는 한 통화 안에서 오간다 — 팔겠다는 말과
--   얼마에 팔겠다는 말이 따로 오는 일이 드물다. 상태를 그렇게 잘게 두면 쓰는 사람이
--   매번 「지금 어느 칸이지」를 판단해야 한다.
--   자세한 사정은 접촉 기록(app.contacts)이 문장 그대로 들고 있고, 필요하면 거기서 읽어
--   요약해 주면 된다. 상태는 큰 축만 든다 — 매수를 넷으로 줄인 0057과 같은 판단이다.
--
--   관심   접촉했고 아직 팔지 안 팔지 모른다
--   제안   팔겠다고 했다 · 얼마에 팔지 말했다(매물로 나옴)
--   계약   성사
--   철회   안 팔겠다(줄기에서 꺾임 — 매수의 「거절」에 해당)
--
-- 매수와 같은 모양이 된다: 매수 후보·제안·계약·거절 / 매도 관심·제안·계약·철회.

BEGIN;

UPDATE app.listings SET status = '관심' WHERE status IN ('리드', '미지정', '준비중');
UPDATE app.listings SET status = '제안' WHERE status IN ('매도의향', '가격제시', '진행중');
UPDATE app.listings SET status = '계약' WHERE status = '매각';

UPDATE app.contacts SET status = '관심' WHERE status IN ('리드', '미지정', '준비중');
UPDATE app.contacts SET status = '제안' WHERE status IN ('매도의향', '가격제시', '진행중');
UPDATE app.contacts SET status = '계약' WHERE status = '매각';

DELETE FROM ref.enums WHERE enum_key = 'jindo';
INSERT INTO ref.enums(enum_key, code, label, sort_order, active) VALUES
  ('jindo', '관심', '관심', 1, true),
  ('jindo', '제안', '제안', 2, true),
  ('jindo', '계약', '계약', 3, true),
  ('jindo', '철회', '철회', 4, true);

COMMIT;
