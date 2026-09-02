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
       a.tier        AS 등급,
       to_char(a.created_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS 가입,
       CASE WHEN a.phone_verified_at IS NOT NULL THEN '✓' ELSE '' END   AS 폰인증,
       CASE WHEN s.provider IS NOT NULL THEN s.provider ELSE '이메일' END AS 가입경로,
       COALESCE(b.balance, 0) AS 남은크레딧
FROM app.accounts a
LEFT JOIN LATERAL (SELECT provider FROM app.social_accounts WHERE account_id = a.id LIMIT 1) s ON true
LEFT JOIN LATERAL (SELECT sum(amount) AS balance FROM app.credit_entries WHERE account_id = a.id) b ON true
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
       (SELECT count(*) FROM app.listings   l WHERE l.assignee_account_id = t.id)          AS 내매물,
       (SELECT count(*) FROM app.overlays   o WHERE o.updated_by = t.id)                   AS 값수정,
       (SELECT count(*) FROM app.photos     p WHERE p.uploaded_by = t.id AND p.deleted_at IS NULL) AS 사진,
       (SELECT count(*) FROM app.saved_searches s WHERE s.account_id = t.id)               AS 저장조건,
       (SELECT count(*) FROM app.favorites  f WHERE f.account_id = t.id)                   AS 관심,
       (SELECT count(*) FROM app.memos      m WHERE m.author_account_id = t.id AND m.deleted_at IS NULL) AS 메모,
       (SELECT count(*) FROM app.reports    r WHERE r.account_id = t.id AND r.kind = 'briefing') AS 브리핑,
       (SELECT count(*) FROM app.reports    r WHERE r.account_id = t.id AND r.kind = 'analysis') AS 리포트,
       (SELECT count(*) FROM app.survey_responses v WHERE v.account_id = t.id)             AS 설문,
       to_char((SELECT max(x) FROM (VALUES
           ((SELECT max(created_at) FROM app.reports        WHERE account_id = t.id)),
           ((SELECT max(updated_at) FROM app.overlays       WHERE updated_by = t.id)),
           ((SELECT max(updated_at) FROM app.listings       WHERE assignee_account_id = t.id)),
           ((SELECT max(created_at) FROM app.saved_searches WHERE account_id = t.id)),
           ((SELECT max(created_at) FROM app.favorites      WHERE account_id = t.id))
        ) AS v(x)) AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI')                             AS 마지막활동
FROM t
ORDER BY 마지막활동 DESC NULLS LAST;

\echo ''
\echo '━━━ 3. 최근 활동 50건 (무엇을 했는가) ━━━'
SELECT to_char(ts AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS 시각, 이름, 행동, 대상
FROM (
  SELECT r.created_at AS ts, a.name AS 이름,
         CASE r.kind::text WHEN 'briefing' THEN '브리핑 만듦' ELSE '리포트 만듦' END AS 행동,
         r.building_pk AS 대상
    FROM app.reports r JOIN app.accounts a ON a.id = r.account_id
  UNION ALL
  SELECT l.created_at, a.name, '내 매물 등록', l.building_pk
    FROM app.listings l JOIN app.accounts a ON a.id = l.assignee_account_id
  UNION ALL
  SELECT o.updated_at, a.name, '값 수정 · ' || o.field, o.target_id
    FROM app.overlays o JOIN app.accounts a ON a.id = o.updated_by
  UNION ALL
  SELECT p.created_at, a.name, '사진 올림', p.building_pk
    FROM app.photos p JOIN app.accounts a ON a.id = p.uploaded_by WHERE p.deleted_at IS NULL
  UNION ALL
  SELECT s.created_at, a.name, '조건 저장 · ' || s.name, ''
    FROM app.saved_searches s JOIN app.accounts a ON a.id = s.account_id
  UNION ALL
  SELECT f.created_at, a.name, '관심 담음', f.building_pk
    FROM app.favorites f JOIN app.accounts a ON a.id = f.account_id
) x
ORDER BY ts DESC
LIMIT 50;

\echo ''
\echo '━━━ 4. 리포트 실패 (있으면 즉시 봐야 함) ━━━'
SELECT to_char(r.created_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS 시각,
       a.name AS 이름, r.kind AS 종류, r.building_pk AS 매물, r.failed_reason AS 사유
FROM app.reports r JOIN app.accounts a ON a.id = r.account_id
WHERE r.status = 'failed'
ORDER BY r.created_at DESC LIMIT 20;

\echo ''
\echo '━━━ 5. 설문 응답 ━━━'
SELECT to_char(v.created_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS 시각,
       COALESCE(a.name, '익명') AS 이름, v.survey_key AS 회차, v.answers AS 응답
FROM app.survey_responses v LEFT JOIN app.accounts a ON a.id = v.account_id
ORDER BY v.created_at DESC LIMIT 30;

\echo ''
\echo '━━━ 6. 한눈에 ━━━'
SELECT (SELECT count(*) FROM app.accounts WHERE deleted_at IS NULL AND NOT is_admin) AS 가입자,
       (SELECT count(DISTINCT account_id) FROM app.reports)                          AS 리포트만든사람,
       (SELECT count(*) FROM app.reports WHERE kind = 'analysis')                    AS 분석리포트,
       (SELECT count(*) FROM app.reports WHERE kind = 'briefing')                    AS 브리핑,
       (SELECT count(*) FROM app.reports WHERE status = 'failed')                    AS 실패,
       (SELECT count(*) FROM app.listings)                                           AS 등록매물,
       (SELECT count(*) FROM app.overlays)                                           AS 값수정;
