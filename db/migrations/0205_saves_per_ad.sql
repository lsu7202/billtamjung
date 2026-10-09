-- 0205 저장 · 관심은 광고(매물) 단위(대표 10-01)
--
-- 한 건물에 광고가 여럿일 수 있다. 저장은 「건물 + 그때 대표 광고」였고 관심 수도 건물 단위였다.
-- 이제 저장은 광고 하나에 붙고(ad_id 필수), 「오늘 본 사람」도 광고마다 센다.
-- 광고 없는 건물 저장(+ 새 광고 알림)은 없앤다 — 「이 건물이 나오면」은 구해요가 맡는다.
-- 알림은 출처가 다 사라져 accounts.alerts_seen_at 도 걷는다(구해요 제안 알림을 만들 때 다시 세운다).
BEGIN;
DELETE FROM app.saves WHERE ad_id IS NULL;
DROP INDEX IF EXISTS app.saves_one;
ALTER TABLE app.saves ALTER COLUMN ad_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS saves_one_ad ON app.saves(account_id, ad_id);

DROP TABLE IF EXISTS app.building_views;
CREATE TABLE IF NOT EXISTS app.ad_views (
  ad_id      bigint NOT NULL REFERENCES app.ads(id) ON DELETE CASCADE,
  account_id bigint NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  viewed_on  date   NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,
  PRIMARY KEY (ad_id, viewed_on, account_id)
);

ALTER TABLE app.accounts DROP COLUMN IF EXISTS alerts_seen_at;
COMMIT;
