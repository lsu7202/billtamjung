-- 0200 대시보드 뒷단 삭제(대표 2026-09-29)
--
-- 대시보드(오늘 탭) 화면은 09-28 에 뺐고, 서버의 /sales/today · /sales/profile 도 지웠다.
-- 「시작해볼 곳」 개인화(F-23 1단계)가 쓰던 중개사 프로필 표는 이제 읽는 곳이 없다.
-- 안 쓰는 것이 남아 있으면 계속 오류를 만든다. 필요하면 커밋 기록에서 되살린다.
BEGIN;
DROP TABLE IF EXISTS app.broker_profile;
COMMIT;
