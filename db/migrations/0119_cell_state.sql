-- **칸의 상태를 DB가 낸다**(2026-08-19) — 화면은 색만 칠한다.
--   지금까지 뷰는 칸마다 참/거짓만 내고, 그걸 색으로 옮기는 규칙이 화면마다 따로 있었다
--   (목록은 「최근 7일 움직임」도 노랑, 레일은 지금 칸만 색칠, 창은 「쌍이 있으면 노랑」).
--   같은 사실이 세 가지 색으로 보였다. 판정은 한 곳이어야 한다.
--
--   cells jsonb — 칸 키 → 상태 넷 중 하나:
--     done  끝났다        open  진행 중(값이 서는 중)      stop  멈췄다      none  시작 전
--   색 이름은 넣지 않는다 — done/open/stop/none 은 **상태**고, 무슨 색으로 칠할지는 화면의 몫이다.
BEGIN;

DROP VIEW IF EXISTS app.v_listing_stage;
CREATE VIEW app.v_listing_stage AS
WITH base AS (
  SELECT
    l.building_pk, l.team_id,
    (l.owner_id IS NOT NULL AND o.phone IS NOT NULL AND o.phone <> '')        AS s1_owner,
    (COALESCE(l.call_result, '') = '통화됨'
     OR (l.intent  IS NOT NULL AND l.intent  <> '미지정')
     OR (l.urgency IS NOT NULL AND l.urgency <> '미지정')
     OR COALESCE(l.meongdo,    '미지정') <> '미지정'
     OR COALESCE(l.use_change, '미지정') <> '미지정'
     OR COALESCE(l.myeolsil,   '미지정') <> '미지정')                          AS s2_touch,
    (l.intent = '원함')                                                        AS s3_intent,
    (COALESCE(l.meongdo,    '미지정') NOT IN ('미지정','확인중')
     AND COALESCE(l.use_change, '미지정') NOT IN ('미지정','확인중')
     AND COALESCE(l.myeolsil,   '미지정') NOT IN ('미지정','확인중'))         AS s4_info,
    (EXISTS (SELECT 1 FROM app.photos p
              WHERE p.building_pk = l.building_pk AND p.team_id = l.team_id
                AND p.deleted_at IS NULL)
     AND EXISTS (SELECT 1 FROM app.reports r
                  JOIN app.team_members tm ON tm.account_id = r.account_id
                  WHERE r.building_pk = l.building_pk AND tm.team_id = l.team_id
                    AND r.status = 'done'))                                    AS s5_asset,
    (EXISTS (SELECT 1 FROM app.proposals pr
              JOIN app.schedules sc ON sc.proposal_id = pr.id
                                   AND sc.category = '계약' AND sc.state = '완료'
              WHERE pr.team_id = l.team_id AND pr.building_pk = l.building_pk
                AND pr.picked_at IS NOT NULL))                                 AS s6_match,
    (EXISTS (SELECT 1 FROM app.proposals pr
              WHERE pr.team_id = l.team_id AND pr.building_pk = l.building_pk
                AND pr.picked_at IS NOT NULL
                AND pr.status NOT IN ('철회', '계약파기')))                     AS s6_open,
    -- 진행 중 판정에 쓰는 「손대는 중」 — 값이 반쯤 찬 칸(정보는 하나라도 찍힘, 접촉은 시도함)
    (COALESCE(l.call_result, '') <> '' AND COALESCE(l.call_result,'') <> '통화됨') AS s2_try,
    (l.intent = '검토')                                                        AS s3_try,
    (COALESCE(l.meongdo,   '미지정') <> '미지정'
     OR COALESCE(l.use_change,'미지정') <> '미지정'
     OR COALESCE(l.myeolsil, '미지정') <> '미지정')                             AS s4_try,
    (l.owner_id IS NOT NULL)                                                   AS s1_try,
    (CASE WHEN COALESCE(l.meongdo,   '미지정') NOT IN ('미지정','확인중') THEN 1 ELSE 0 END
   + CASE WHEN COALESCE(l.use_change,'미지정') NOT IN ('미지정','확인중') THEN 1 ELSE 0 END
   + CASE WHEN COALESCE(l.myeolsil,  '미지정') NOT IN ('미지정','확인중') THEN 1 ELSE 0 END)  AS info_filled
  FROM app.listings l
  LEFT JOIN app.owners o ON o.id = l.owner_id AND o.deleted_at IS NULL
), st AS (
  -- 멈춤 — 칸마다 열린 정지가 있으면 그 칸은 stop 이다(빨강)
  SELECT s.target_id AS building_pk, s.team_id, s.stage
    FROM app.stops s
   WHERE s.target_type = 'listing' AND s.resolved_at IS NULL
)
SELECT b.building_pk, b.team_id,
       b.s1_owner, b.s2_touch, b.s3_intent, b.s4_info, b.s5_asset, b.s6_match, b.s6_open,
       b.info_filled,
       jsonb_build_object(
         'owner',  CASE WHEN st.stage='owner'  THEN 'stop' WHEN b.s1_owner  THEN 'done'
                        WHEN b.s1_try  THEN 'open' ELSE 'none' END,
         'touch',  CASE WHEN st.stage='touch'  THEN 'stop' WHEN b.s2_touch  THEN 'done'
                        WHEN b.s2_try  THEN 'open' ELSE 'none' END,
         'intent', CASE WHEN st.stage='intent' THEN 'stop' WHEN b.s3_intent THEN 'done'
                        WHEN b.s3_try  THEN 'open' ELSE 'none' END,
         'info',   CASE WHEN st.stage='info'   THEN 'stop' WHEN b.s4_info   THEN 'done'
                        WHEN b.s4_try  THEN 'open' ELSE 'none' END,
         'match',  CASE WHEN st.stage='match'  THEN 'stop' WHEN b.s6_match  THEN 'done'
                        WHEN b.s6_open THEN 'open' ELSE 'none' END
       )                                                        AS cells,
       CASE WHEN NOT b.s1_owner  THEN 'owner'
            WHEN NOT b.s2_touch  THEN 'touch'
            WHEN NOT b.s3_intent THEN 'intent'
            WHEN NOT b.s4_info   THEN 'info'
            WHEN NOT b.s6_match  THEN 'match'
            ELSE 'done' END                                     AS stage,
       (b.s1_owner::int + b.s2_touch::int + b.s3_intent::int
      + b.s4_info::int + b.s6_match::int)                       AS passed
  FROM base b
  LEFT JOIN st ON st.building_pk = b.building_pk AND st.team_id = b.team_id;

DROP VIEW IF EXISTS app.v_buyer_stage;
CREATE VIEW app.v_buyer_stage AS
WITH base AS (
  SELECT b.id, b.team_id,
    ((b.phone IS NOT NULL AND b.phone <> '')
     AND EXISTS (SELECT 1 FROM app.buyer_conditions c WHERE c.buyer_id = b.id))  AS b1_buyer,
    (b.phone IS NOT NULL AND b.phone <> '')                                      AS b1_try,
    EXISTS (SELECT 1 FROM app.proposals p
             JOIN app.schedules sc ON sc.proposal_id = p.id
                                  AND sc.category = '계약' AND sc.state = '완료'
             WHERE p.buyer_id = b.id AND p.picked_at IS NOT NULL)                AS b4_match,
    EXISTS (SELECT 1 FROM app.proposals p
             WHERE p.buyer_id = b.id AND p.picked_at IS NOT NULL
               AND p.status NOT IN ('철회', '계약파기'))                          AS b4_open
  FROM app.buyers b
  WHERE b.deleted_at IS NULL
), st AS (
  SELECT s.target_id::bigint AS buyer_id, s.team_id, s.stage
    FROM app.stops s
   WHERE s.target_type = 'buyer' AND s.resolved_at IS NULL
)
SELECT b.id, b.team_id, b.b1_buyer, b.b4_match, b.b4_open,
       jsonb_build_object(
         'buyer', CASE WHEN st.stage IS NOT NULL THEN 'stop' WHEN b.b1_buyer THEN 'done'
                       WHEN b.b1_try THEN 'open' ELSE 'none' END,
         'match', CASE WHEN b.b4_match THEN 'done' WHEN b.b4_open THEN 'open' ELSE 'none' END
       )                                                        AS cells,
       CASE WHEN NOT b.b1_buyer THEN 'buyer'
            WHEN NOT b.b4_match THEN 'match'
            ELSE 'done' END                                     AS stage,
       (b.b1_buyer::int + b.b4_match::int)                      AS passed
  FROM base b
  LEFT JOIN st ON st.buyer_id = b.id AND st.team_id = b.team_id;

DROP VIEW IF EXISTS app.v_proposal_stage;
CREATE VIEW app.v_proposal_stage AS
WITH base AS (
  SELECT p.id, p.team_id,
    (COALESCE(array_length(p.brief_how, 1), 0) > 0 OR p.proposed_on IS NOT NULL) AS d2_brief,
    (p.visited_on IS NOT NULL)                                                 AS d3_visit,
    (p.hope_price IS NOT NULL OR p.reject_price IS NOT NULL
     OR EXISTS (SELECT 1 FROM app.proposal_events pe
                 WHERE pe.proposal_id = p.id AND pe.side = '매도'))            AS d4_nego,
    (p.pre_contract_on IS NOT NULL OR p.pre_contract_amount IS NOT NULL)       AS d5_pre,
    (p.status = '계약')                                                        AS d6_sign,
    EXISTS (SELECT 1 FROM app.schedules s
             WHERE s.proposal_id = p.id AND s.category = '잔금'
               AND s.state = '완료')                                           AS d7_pay,
    -- 잔금 진행 중 — 날짜는 잡혔는데 아직 안 치렀다
    EXISTS (SELECT 1 FROM app.schedules s
             WHERE s.proposal_id = p.id AND s.category = '잔금'
               AND s.state = '예정')                                           AS d7_due,
    (p.report_filed_on IS NOT NULL)                                            AS d8_file,
    p.status
  FROM app.proposals p
)
SELECT id, team_id, d2_brief, d3_visit, d4_nego, d5_pre, d6_sign, d7_pay, d7_due, d8_file,
       jsonb_build_object(
         'pay',  CASE WHEN d7_pay THEN 'done' WHEN d7_due THEN 'open' ELSE 'none' END,
         'file', CASE WHEN d8_file THEN 'done' ELSE 'none' END
       )                                                        AS cells,
       CASE WHEN status IN ('철회', '계약파기') THEN 'out'
            WHEN NOT d2_brief THEN 'brief'
            WHEN NOT d4_nego  THEN 'nego'
            WHEN NOT d5_pre   THEN 'pre'
            WHEN NOT d6_sign  THEN 'sign'
            WHEN NOT d7_pay   THEN 'pay'
            WHEN NOT d8_file  THEN 'file'
            ELSE 'done' END                                     AS stage
  FROM base;

COMMENT ON VIEW app.v_listing_stage IS
  '매물 사다리 — 칸의 상태(cells)까지 여기서 낸다(0119). 화면은 색만 칠한다.';

INSERT INTO app.schema_migrations(version) VALUES ('0119_cell_state.sql')
ON CONFLICT DO NOTHING;
COMMIT;
