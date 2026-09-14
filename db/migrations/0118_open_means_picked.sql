-- 노랑의 문턱을 올린다(2026-08-19) — **담은 것은 계약이 아니다**.
--   후보로 담기만 해도 계약 칸이 노랑이라, 소개하려고 담아 둔 사람이 「거의 산다」로 읽혔다.
--   색이 사실보다 앞서 나가면 대시보드도 거짓 신호를 낸다.
--     회색  담은 후보만 있다(또는 없다) — 아직 계약 이야기가 아니다
--     노랑  계약 상대와 계약가가 정해졌다
--     초록  그 계약 일정을 소화했다(0116)
--   담아 둔 후보 수는 색이 아니라 숫자로 말한다(매물 카드의 매수자 줄 · 매수자 카드의 담은 매물).
BEGIN;

CREATE OR REPLACE VIEW app.v_listing_stage AS
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
    -- 진행 중 = **계약 상대가 정해졌다**(담김이 아니다)
    (EXISTS (SELECT 1 FROM app.proposals pr
              WHERE pr.team_id = l.team_id AND pr.building_pk = l.building_pk
                AND pr.picked_at IS NOT NULL
                AND pr.status NOT IN ('철회', '계약파기')))                     AS s6_open,
    (CASE WHEN COALESCE(l.meongdo,   '미지정') NOT IN ('미지정','확인중') THEN 1 ELSE 0 END
   + CASE WHEN COALESCE(l.use_change,'미지정') NOT IN ('미지정','확인중') THEN 1 ELSE 0 END
   + CASE WHEN COALESCE(l.myeolsil,  '미지정') NOT IN ('미지정','확인중') THEN 1 ELSE 0 END)  AS info_filled
  FROM app.listings l
  LEFT JOIN app.owners o ON o.id = l.owner_id AND o.deleted_at IS NULL
)
SELECT building_pk, team_id,
       s1_owner, s2_touch, s3_intent, s4_info, s5_asset, s6_match, s6_open, info_filled,
       CASE WHEN NOT s1_owner  THEN 'owner'
            WHEN NOT s2_touch  THEN 'touch'
            WHEN NOT s3_intent THEN 'intent'
            WHEN NOT s4_info   THEN 'info'
            WHEN NOT s6_match  THEN 'match'
            ELSE 'done' END                                     AS stage,
       (s1_owner::int + s2_touch::int + s3_intent::int
      + s4_info::int + s6_match::int)                           AS passed
  FROM base;

CREATE OR REPLACE VIEW app.v_buyer_stage AS
WITH base AS (
  SELECT b.id, b.team_id,
    ((b.phone IS NOT NULL AND b.phone <> '')
     AND EXISTS (SELECT 1 FROM app.buyer_conditions c WHERE c.buyer_id = b.id))  AS b1_buyer,
    EXISTS (SELECT 1 FROM app.proposals p
             JOIN app.schedules sc ON sc.proposal_id = p.id
                                  AND sc.category = '계약' AND sc.state = '완료'
             WHERE p.buyer_id = b.id AND p.picked_at IS NOT NULL)                AS b4_match,
    EXISTS (SELECT 1 FROM app.proposals p
             WHERE p.buyer_id = b.id AND p.picked_at IS NOT NULL
               AND p.status NOT IN ('철회', '계약파기'))                          AS b4_open
  FROM app.buyers b
  WHERE b.deleted_at IS NULL
)
SELECT id, team_id, b1_buyer, b4_match, b4_open,
       CASE WHEN NOT b1_buyer THEN 'buyer'
            WHEN NOT b4_match THEN 'match'
            ELSE 'done' END                                     AS stage,
       (b1_buyer::int + b4_match::int)                          AS passed
  FROM base;

INSERT INTO app.schema_migrations(version) VALUES ('0118_open_means_picked.sql')
ON CONFLICT DO NOTHING;
COMMIT;
