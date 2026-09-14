-- 0061 · 매물 진행상태 기본값을 「관심」으로 — 「미지정」을 없앤다
--
-- 왜: 0060에서 단계를 넷(관심·제안·계약·철회)으로 줄였는데, 새로 만든 매물은 status 가
--   NULL 로 남아 화면이 「미지정」이라는 다섯 번째 칸을 그려 왔다. DB에는 없는 칸을
--   화면만 알고 있는 상태다 — 언젠가 어긋난다.
--   담아둔 매물은 이미 「관심」이다(관심 있으니 담았다). 빈 칸을 따로 둘 이유가 없다.

BEGIN;

UPDATE app.listings SET status = '관심' WHERE status IS NULL OR status = '미지정';
ALTER TABLE app.listings ALTER COLUMN status SET DEFAULT '관심';

COMMIT;
