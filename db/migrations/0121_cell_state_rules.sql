-- 칸마다 다섯 상태의 뜻을 정한다(2026-08-19) — 0120 의 마무리.
--   회색 채움(open) = **내가 손댔지만 답이 없다**   · 노랑(busy) = **진행 중이라고 값이 말한다**
--     소유자  open 소유자는 붙었는데 전화가 없다        done 이름+전화
--     접촉    open 걸었는데 부재중·전원꺼짐            done 말이 됐다
--     의사    busy 검토 중                            done 원함
--     정보    open 일부만 답함 · busy 확인중이 있다     done 셋 다 답
--     계약    open 후보를 담았다 · busy 상대·값 정함    done 계약 일정 소화
--     잔금    busy 잔금일이 잡혔다                     done 잔금을 치렀다
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
    (l.intent = '검토')                                                        AS s3_busy,
    (COALESCE(l.meongdo,    '미지정') NOT IN ('미지정','확인중')
     AND COALESCE(l.use_change, '미지정') NOT IN ('미지정','확인중')
     AND COALESCE(l.myeolsil,   '미지정') NOT IN ('미지정','확인중'))         AS s4_info,
    (l.meongdo = '확인중' OR l.use_change = '확인중' OR l.myeolsil = '확인중')  AS s4_busy,
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
    (EXISTS (SELECT 1 FROM app.proposals pr
              WHERE pr.team_id = l.team_id AND pr.building_pk = l.building_pk
                AND pr.picked_at IS NOT NULL
                AND pr.status NOT IN ('철회', '계약파기')))                     AS s6_open,
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
                        WHEN b.s3_busy THEN 'busy' ELSE 'none' END,
         'info',   CASE WHEN st.stage='info'   THEN 'stop' WHEN b.s4_info   THEN 'done'
                        WHEN b.s4_busy THEN 'busy' WHEN b.s4_try THEN 'open' ELSE 'none' END,
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

INSERT INTO app.schema_migrations(version) VALUES ('0121_cell_state_rules.sql')
ON CONFLICT DO NOTHING;
COMMIT;
