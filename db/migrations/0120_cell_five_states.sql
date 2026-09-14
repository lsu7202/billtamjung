-- 칸 상태 다섯(2026-08-19) — **빈 것과 회색은 다르다**.
--     none  아직 시작도 안 했다        (빈 원)
--     open  시작은 했다 · 값이 덜 찼다  (회색 채움) — 매수자를 담아 뒀다 · 전화는 걸었다
--     busy  지금 붙어서 하는 중         (노랑)     — 계약 상대가 정해졌다
--     done  끝났다                     (초록)
--     stop  멈췄다                     (빨강)
--   담긴 쌍이 어디에도 안 나타나 매수자가 「매수자」 칸에 머물러 있던 것이 이 갈래를 만든 계기다.
BEGIN;

DROP VIEW IF EXISTS app.v_listing_stage;
CREATE VIEW app.v_listing_stage AS
WITH base AS (
  SELECT
    l.building_pk, l.team_id,
    (l.owner_id IS NOT NULL AND o.phone IS NOT NULL AND o.phone <> '')        AS s1_owner,
    (l.owner_id IS NOT NULL)                                                   AS s1_try,
    (COALESCE(l.call_result, '') = '통화됨'
     OR (l.intent  IS NOT NULL AND l.intent  <> '미지정')
     OR (l.urgency IS NOT NULL AND l.urgency <> '미지정')
     OR COALESCE(l.meongdo,    '미지정') <> '미지정'
     OR COALESCE(l.use_change, '미지정') <> '미지정'
     OR COALESCE(l.myeolsil,   '미지정') <> '미지정')                          AS s2_touch,
    (COALESCE(l.call_result, '') <> '')                                        AS s2_try,
    (l.intent = '원함')                                                        AS s3_intent,
    (l.intent = '검토')                                                        AS s3_try,
    (COALESCE(l.meongdo,    '미지정') NOT IN ('미지정','확인중')
     AND COALESCE(l.use_change, '미지정') NOT IN ('미지정','확인중')
     AND COALESCE(l.myeolsil,   '미지정') NOT IN ('미지정','확인중'))         AS s4_info,
    (COALESCE(l.meongdo,   '미지정') <> '미지정'
     OR COALESCE(l.use_change,'미지정') <> '미지정'
     OR COALESCE(l.myeolsil, '미지정') <> '미지정')                             AS s4_try,
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
    -- 노랑 = 계약 상대가 정해졌다
    (EXISTS (SELECT 1 FROM app.proposals pr
              WHERE pr.team_id = l.team_id AND pr.building_pk = l.building_pk
                AND pr.picked_at IS NOT NULL
                AND pr.status NOT IN ('철회', '계약파기')))                     AS s6_open,
    -- 회색 채움 = 후보를 담아 뒀다(아직 계약 이야기는 아니지만 시작은 했다)
    (EXISTS (SELECT 1 FROM app.proposals pr
              WHERE pr.team_id = l.team_id AND pr.building_pk = l.building_pk
                AND pr.status NOT IN ('철회', '계약파기')))                     AS s6_try,
    (CASE WHEN COALESCE(l.meongdo,   '미지정') NOT IN ('미지정','확인중') THEN 1 ELSE 0 END
   + CASE WHEN COALESCE(l.use_change,'미지정') NOT IN ('미지정','확인중') THEN 1 ELSE 0 END
   + CASE WHEN COALESCE(l.myeolsil,  '미지정') NOT IN ('미지정','확인중') THEN 1 ELSE 0 END)  AS info_filled
  FROM app.listings l
  LEFT JOIN app.owners o ON o.id = l.owner_id AND o.deleted_at IS NULL
), st AS (
  SELECT s.target_id AS building_pk, s.team_id, s.stage
    FROM app.stops s
   WHERE s.target_type = 'listing' AND s.resolved_at IS NULL
)
SELECT b.building_pk, b.team_id,
       b.s1_owner, b.s2_touch, b.s3_intent, b.s4_info, b.s5_asset, b.s6_match, b.s6_open,
       b.info_filled,
       jsonb_build_object(
         'owner',  CASE WHEN st.stage='owner'  THEN 'stop' WHEN b.s1_owner  THEN 'done'
                        WHEN b.s1_try THEN 'open' ELSE 'none' END,
         'touch',  CASE WHEN st.stage='touch'  THEN 'stop' WHEN b.s2_touch  THEN 'done'
                        WHEN b.s2_try THEN 'open' ELSE 'none' END,
         'intent', CASE WHEN st.stage='intent' THEN 'stop' WHEN b.s3_intent THEN 'done'
                        WHEN b.s3_try THEN 'open' ELSE 'none' END,
         'info',   CASE WHEN st.stage='info'   THEN 'stop' WHEN b.s4_info   THEN 'done'
                        WHEN b.s4_try THEN 'open' ELSE 'none' END,
         'match',  CASE WHEN st.stage='match'  THEN 'stop' WHEN b.s6_match  THEN 'done'
                        WHEN b.s6_open THEN 'busy' WHEN b.s6_try THEN 'open' ELSE 'none' END
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
               AND p.status NOT IN ('철회', '계약파기'))                          AS b4_open,
    -- 회색 채움 = 이 사람에게 매물을 담아 뒀다
    EXISTS (SELECT 1 FROM app.proposals p
             WHERE p.buyer_id = b.id AND p.status NOT IN ('철회', '계약파기'))    AS b4_try
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
         'match', CASE WHEN b.b4_match THEN 'done' WHEN b.b4_open THEN 'busy'
                       WHEN b.b4_try THEN 'open' ELSE 'none' END
       )                                                        AS cells,
       CASE WHEN NOT b.b1_buyer THEN 'buyer'
            WHEN NOT b4_match THEN 'match'
            ELSE 'done' END                                     AS stage,
       (b.b1_buyer::int + b.b4_match::int)                      AS passed
  FROM base b
  LEFT JOIN st ON st.buyer_id = b.id AND st.team_id = b.team_id;

INSERT INTO app.schema_migrations(version) VALUES ('0120_cell_five_states.sql')
ON CONFLICT DO NOTHING;
COMMIT;
