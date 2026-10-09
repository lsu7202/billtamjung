-- 0203 조건 알림 폐지(대표 09-30)
--
-- 매물 찾기 목록 머리의 종(조건 남기기 + 알림 받기)을 뺐다. 조건에 맞는 새 광고를 맞춰 쌓던
-- want_alerts 와 saved_searches.notify · notify_since 를 걷는다. 저장한 조건 자체와
-- 저장한 건물 알림(saves)은 남는다.
BEGIN;
DROP TABLE IF EXISTS app.want_alerts;
ALTER TABLE app.saved_searches DROP COLUMN IF EXISTS notify, DROP COLUMN IF EXISTS notify_since;
COMMIT;
