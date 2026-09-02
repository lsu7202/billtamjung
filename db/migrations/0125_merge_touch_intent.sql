-- 접촉과 의사를 **한 칸으로 합친다**(2026-08-20).
--   둘은 같은 통화에서 끝난다 — 전화가 되면 그 자리에서 「파실 생각 있으세요」를 묻는다.
--   칸을 둘로 두면 같은 사람에게 같은 창을 두 번 열게 되고, 「접촉은 초록인데 의사는 회색」
--   같은 반쪽 상태가 화면에 늘어선다.
--     none  걸어보지 않았다
--     open  걸었는데 말이 안 됐다(부재·전원꺼짐)
--     busy  말은 됐다 · 아직 팔 생각은 모른다(검토 포함)
--     done  팔 생각을 안다(원함)
BEGIN;

DROP VIEW IF EXISTS app.v_listing_stage;
CREATE VIEW app.v_listing_stage AS
WITH base AS (
  SELECT
    l.building_pk, l.team_id,
    (l.owner_id IS NOT NULL AND o.phone IS NOT NULL AND o.phone <> '')        AS s1_owner,
    (l.owner_id IS NOT NULL)                                                   AS s1_try,
    -- ② 접촉 — 말이 됐다(구 s2). 합친 칸의 「중간」이다
    (COALESCE(l.call_result, '') = '통화됨'
     OR (l.intent  IS NOT NULL AND l.intent  <> '미지정')
     OR (l.urgency IS NOT NULL AND l.urgency <> '미지정')
     OR COALESCE(l.meongdo,    '미지정') <> '미지정'
     OR COALESCE(l.use_change, '미지정') <> '미지정'
     OR COALESCE(l.myeolsil,   '미지정') <> '미지정')                          AS s2_talked,
    (COALESCE(l.call_result, '') <> '')                                        AS s2_try,
    -- 합친 칸의 완료 = **팔 생각을 안다**
    (l.intent = '원함')                                                        AS s2_touch,
    (l.intent = '원함')                                                        AS s3_intent,
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
  SELECT s.target_id AS building_pk, s.team_id,
         CASE WHEN s.stage = 'intent' THEN 'touch' ELSE s.stage END AS stage
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
                        WHEN b.s2_talked THEN 'busy' WHEN b.s2_try THEN 'open' ELSE 'none' END,
         'info',   CASE WHEN st.stage='info'   THEN 'stop' WHEN b.s4_info   THEN 'done'
                        WHEN b.s4_busy THEN 'busy' WHEN b.s4_try THEN 'open' ELSE 'none' END,
         'match',  CASE WHEN st.stage='match'  THEN 'stop' WHEN b.s6_match  THEN 'done'
                        WHEN b.s6_open THEN 'busy' WHEN b.s6_try THEN 'open' ELSE 'none' END
       )                                                        AS cells,
       CASE WHEN NOT b.s1_owner  THEN 'owner'
            WHEN NOT b.s2_touch  THEN 'touch'
            WHEN NOT b.s4_info   THEN 'info'
            WHEN NOT b.s6_match  THEN 'match'
            ELSE 'done' END                                     AS stage,
       (b.s1_owner::int + b.s2_touch::int + b.s4_info::int + b.s6_match::int)  AS passed
  FROM base b
  LEFT JOIN st ON st.building_pk = b.building_pk AND st.team_id = b.team_id;

COMMENT ON VIEW app.v_listing_stage IS
  '매물 사다리 — 소유자·접촉(의사 포함)·정보·계약 네 칸(0125). 상태는 cells 가 낸다.';

INSERT INTO app.schema_migrations(version) VALUES ('0125_merge_touch_intent.sql')
ON CONFLICT DO NOTHING;
COMMIT;
