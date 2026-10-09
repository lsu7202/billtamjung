-- 베타 현황 — 누가 가입했고 무엇을 했는가. **읽기 전용**.
--
-- 프로덕션에는 아직 화면 조회 로그(app.view_log, 0048)가 없다.
-- 대신 "행동의 결과물"(내 매물·수정·리포트·사진·저장조건)로 활동을 읽는다 —
-- 클릭보다 결과물이 실제 사용을 더 정확히 말해준다.
--
--   cloud-sql-proxy --gcloud-auth --port 55433 <INSTANCE> &
--   psql "postgresql://<user>:<pw>@localhost:55433/billtamjung" -f scripts/beta_status.sql

\pset border 2
\timing off

\echo ''
\echo '━━━ 1. 가입자 ━━━'
SELECT a.id,
       a.name        AS 이름,
       a.office_name AS 사무소,
       a.email,
       to_char(a.created_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS 가입,
       CASE WHEN a.phone_verified_at IS NOT NULL THEN '✓' ELSE '' END   AS 폰인증,
       CASE WHEN s.provider IS NOT NULL THEN s.provider ELSE '이메일' END AS 가입경로
FROM app.accounts a
LEFT JOIN LATERAL (SELECT provider FROM app.social_accounts WHERE account_id = a.id LIMIT 1) s ON true
WHERE a.deleted_at IS NULL AND NOT a.is_admin
ORDER BY a.created_at DESC;

\echo ''
\echo '━━━ 2. 사람별 활동 (0이 많으면 = 들어왔다 나갔다) ━━━'
WITH t AS (
  SELECT a.id, a.name, tm.team_id
  FROM app.accounts a
  LEFT JOIN app.team_members tm ON tm.account_id = a.id
  WHERE a.deleted_at IS NULL AND NOT a.is_admin
)
SELECT t.name AS 이름,
       (SELECT count(*) FROM app.listing_office l WHERE l.assignee_account_id = t.id)      AS 내매물,
       (SELECT count(*) FROM app.overlays   o WHERE o.updated_by = t.id)                   AS 값수정,
       (SELECT count(*) FROM app.photos     p WHERE p.uploaded_by = t.id AND p.deleted_at IS NULL) AS 사진,
       (SELECT count(*) FROM app.saved_searches s WHERE s.account_id = t.id)               AS 저장조건,
       (SELECT count(*) FROM app.saves      f WHERE f.account_id = t.id)                   AS 광고저장,
       (SELECT count(*) FROM app.survey_responses v WHERE v.account_id = t.id)             AS 설문,
       to_char((SELECT max(x) FROM (VALUES
           ((SELECT max(updated_at) FROM app.overlays       WHERE updated_by = t.id)),
           ((SELECT max(updated_at) FROM app.listing_office WHERE assignee_account_id = t.id)),
           ((SELECT max(created_at) FROM app.saved_searches WHERE account_id = t.id)),
           ((SELECT max(created_at) FROM app.saves          WHERE account_id = t.id))
        ) AS v(x)) AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI')                             AS 마지막활동
FROM t
ORDER BY 마지막활동 DESC NULLS LAST;

\echo ''
\echo '━━━ 3. 최근 활동 50건 (무엇을 했는가) ━━━'
SELECT to_char(ts AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS 시각, 이름, 행동, 대상
FROM (
  SELECT l.created_at AS ts, a.name AS 이름, '내 매물 등록' AS 행동, app.parcel_addr(lp.pnu) AS 대상
    FROM app.listings l JOIN app.listing_office lo ON lo.listing_id = l.id
    JOIN app.accounts a ON a.id = lo.assignee_account_id
    LEFT JOIN app.listing_parcels lp ON lp.listing_id = l.id AND lp.main
  UNION ALL
  SELECT o.updated_at, a.name, '값 수정 · ' || o.field, o.target_id
    FROM app.overlays o JOIN app.accounts a ON a.id = o.updated_by
  UNION ALL
  SELECT p.created_at, a.name, '사진 올림', p.listing_id::text
    FROM app.photos p JOIN app.accounts a ON a.id = p.uploaded_by WHERE p.deleted_at IS NULL
  UNION ALL
  SELECT s.created_at, a.name, '조건 저장 · ' || s.name, ''
    FROM app.saved_searches s JOIN app.accounts a ON a.id = s.account_id
  UNION ALL
  SELECT f.created_at, a.name, '광고 저장', f.ad_id::text
    FROM app.saves f JOIN app.accounts a ON a.id = f.account_id
) x
ORDER BY ts DESC
LIMIT 50;

\echo ''
\echo '━━━ 5. 설문 응답 ━━━'
SELECT to_char(v.created_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS 시각,
       COALESCE(a.name, '익명') AS 이름, v.survey_key AS 회차, v.answers AS 응답
FROM app.survey_responses v LEFT JOIN app.accounts a ON a.id = v.account_id
ORDER BY v.created_at DESC LIMIT 30;

\echo ''
\echo '━━━ 6. 한눈에 ━━━'
SELECT (SELECT count(*) FROM app.accounts WHERE deleted_at IS NULL AND NOT is_admin) AS 가입자,
       (SELECT count(*) FROM app.listing_office)                                     AS 등록매물,
       (SELECT count(*) FROM app.overlays)                                           AS 값수정;
