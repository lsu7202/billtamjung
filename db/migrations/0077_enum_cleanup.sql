-- 0077 · 죽은 상태값 정리 — enum 에서 「미지정」을 뺀다
--
-- 왜: 0062에서 **미지정 = null** 로 통일했다(모르면 비워 둔다). 그런데 enum 목록엔
--   「미지정」 코드가 남아 있어 칩으로 뜰 수 있었다 — 고르면 문자열 '미지정'이 저장되고,
--   그러면 「값이 없음」과 「미지정이라는 값」 둘이 생겨 집계가 갈린다.
--   화면의 「미지정」 칩은 코드가 아니라 **비우기**를 뜻한다(EnumField 가 null 로 보낸다).
--
-- 0060에서 없앤 「리드」도 혹시 남아 있으면 같이 판다.

BEGIN;

DELETE FROM ref.enums WHERE enum_key = 'jindo' AND code IN ('미지정', '리드');
UPDATE app.listings SET status = NULL WHERE status IN ('미지정', '리드');
UPDATE app.contacts SET status = NULL WHERE status IN ('미지정', '리드');

COMMIT;
