-- 0089: 「사건」 축을 걷는다 — 일정은 **종류 + 완료 여부**로만 구분한다.
--
-- 왜: 캘린더에 표가 서는 길이 둘이었다. ①일정 창으로 만든 약속 ②계약 커밋이 자동으로
-- 세운 「사건」 표. ②는 사용자 눈에 없는 개념이라 「왜 이건 못 고치지」만 남겼고,
-- 0088 에서 종류(계약·중도금·잔금)가 생기면서 할 일도 없어졌다 —
-- 「계약이 일어났다」 = **계약 종류 일정이 완료된 것**으로 이미 표현된다.
--
-- 계약 사건 → 계약·완료 / 계약파기 사건 → 일반·완료(파기는 날짜를 찾아볼 일이 적다).
UPDATE app.schedules SET category = '계약', state = '완료', kind = '약속'
 WHERE kind = '사건' AND (title LIKE '계약%' AND title NOT LIKE '%파기%' OR category = '계약');
UPDATE app.schedules SET category = '일반', state = '완료', kind = '약속'
 WHERE kind = '사건';
