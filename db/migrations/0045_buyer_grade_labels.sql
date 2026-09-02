-- 0045 · 매수자 등급 라벨 — 알파벳 제거
--
-- "A · 확실"처럼 코드와 풀이를 병기했더니 화면 곳곳에 A/B/C가 그대로 노출됐다.
-- 한글 풀이가 이미 있으니 알파벳은 정보가 아니라 소음이다(2026-08-10 지시).
-- 코드(A/B/C)는 저장·정렬용으로 유지하고 **라벨만** 한글로 바꾼다.

BEGIN;

UPDATE ref.enums SET label = '확실' WHERE enum_key = 'buyer_grade' AND code = 'A';
UPDATE ref.enums SET label = '보통' WHERE enum_key = 'buyer_grade' AND code = 'B';
UPDATE ref.enums SET label = '관망' WHERE enum_key = 'buyer_grade' AND code = 'C';

COMMIT;
