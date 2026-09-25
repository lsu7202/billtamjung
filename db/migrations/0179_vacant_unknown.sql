-- 공실수를 3값에 맞춘다(2026-09-25).
--
-- `is_vacant` 는 0018 에서 모름·있음·없음 셋이 됐는데, 세는 쪽은 `count(*) FILTER (WHERE
-- is_vacant)` 라 **모름을 없음과 같이 센다.** 층별 줄 열 개가 전부 미지정이어도 공실수 0이
-- 나와, 「만실」과 「아무도 안 찍었다」가 한 값이 됐다.
--
-- 하나라도 찍힌 줄이 있어야 센다. 한 줄도 안 찍혔으면 NULL — 미지정은 null 이다.
-- 산식은 mirror.listing_values_fold 와 **같아야 한다**(한쪽만 고치면 다음 쓰기에 어긋난다).

WITH agg AS (
  SELECT building_pk, team_id,
         count(*) FILTER (WHERE is_vacant) AS vacant,
         count(*) FILTER (WHERE is_vacant IS NOT NULL) AS known
    FROM app.floor_rents WHERE deleted_at IS NULL GROUP BY building_pk, team_id)
UPDATE app.listings l
   SET vacant_cnt = CASE WHEN a.known > 0 THEN a.vacant END
  FROM agg a WHERE a.building_pk = l.building_pk AND a.team_id = l.team_id;

-- 층별 줄이 아예 없는 매물의 공실수·공실뺀월임대는 **셀 근거가 없다.** 0134 규칙대로 총액은
-- 손으로 적을 수 있지만 이 둘은 층별 줄에서만 나온다(mirror 의 CASE 에 ELSE 가 없다).
-- 화면으로는 들어올 수 없는 값이니 손으로 박힌 것이다. 여기서 비운다.
UPDATE app.listings l
   SET vacant_cnt = NULL, total_rent_exvac = NULL, roi_exvac = NULL
 WHERE (l.vacant_cnt IS NOT NULL OR l.total_rent_exvac IS NOT NULL)
   AND NOT EXISTS (SELECT 1 FROM app.floor_rents f
                    WHERE f.building_pk = l.building_pk AND f.team_id = l.team_id
                      AND f.deleted_at IS NULL);
