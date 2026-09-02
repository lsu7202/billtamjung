-- 0080: DB 기본 시간대 = Asia/Seoul
--
-- 왜: 손님은 전부 한국 중개인인데 DB가 UTC로 돌면 자정~오전 9시(KST) 사이에
--     current_date 가 **어제**다. 실측(2026-08-15 00:07): 오늘 15:00 약속이
--     대시보드에서 in_days=1(내일)로 밀리고 「오늘」이 빈다. 커밋의
--     occurred_on 기본값(current_date)도 하루 어긋난다.
--
-- 애플리케이션 풀도 server_settings 로 같은 값을 잡는다(backend/app/core/db.py) —
-- 이 마이그레이션은 psql·크론·배치처럼 풀 밖에서 붙는 세션까지 맞추는 안전망이다.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone = ''Asia/Seoul''', current_database());
END $$;
