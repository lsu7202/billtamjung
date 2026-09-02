-- 매칭의 끝 = 채택(2026-08-19) — 「이 사람과 간다」가 서야 매칭이 성공이다.
--   전에는 제안이 하나라도 서면 초록이었다. 그런데 제안이 섰다는 건 후보를 담았다는 뜻일
--   뿐이라, 아무와도 합의 못 한 매물이 「매칭 완료」로 서서 다음 할 일을 숨겼다.
--   이제 초록은 채택된 쌍(picked_at)이 있을 때만. 담기만 한 상태는 **노랑(진행 중)**이다.
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
    -- ⑤ 매칭 — **채택됐다**(0113). 값(확정가)이 만든 초록이다.
    (EXISTS (SELECT 1 FROM app.proposals pr
              WHERE pr.team_id = l.team_id AND pr.building_pk = l.building_pk
                AND pr.picked_at IS NOT NULL))                                 AS s6_match,
    -- 진행 중 — 후보는 담았으나 아직 아무도 못 골랐다(레일에서 노랑)
    (EXISTS (SELECT 1 FROM app.proposals pr
              WHERE pr.team_id = l.team_id AND pr.building_pk = l.building_pk
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

COMMENT ON VIEW app.v_listing_stage IS
  '매물 사다리 — 필드 파생(S04b §2.1). 매칭 초록 = 채택된 쌍(0113·0114).';

DROP VIEW IF EXISTS app.v_buyer_stage;
CREATE VIEW app.v_buyer_stage AS
WITH base AS (
  SELECT b.id, b.team_id,
    ((b.phone IS NOT NULL AND b.phone <> '')
     AND EXISTS (SELECT 1 FROM app.buyer_conditions c WHERE c.buyer_id = b.id))  AS b1_buyer,
    -- ② 매칭 — 이 사람이 **채택됐다**. 그 뒤 칸은 제안 사다리(0093)가 잇는다
    EXISTS (SELECT 1 FROM app.proposals p
             WHERE p.buyer_id = b.id AND p.picked_at IS NOT NULL)               AS b4_match,
    EXISTS (SELECT 1 FROM app.proposals p
             WHERE p.buyer_id = b.id AND p.status NOT IN ('철회', '계약파기'))   AS b4_open
  FROM app.buyers b
  WHERE b.deleted_at IS NULL
)
SELECT id, team_id, b1_buyer, b4_match, b4_open,
       CASE WHEN NOT b1_buyer THEN 'buyer'
            WHEN NOT b4_match THEN 'match'
            ELSE 'done' END                                     AS stage,
       (b1_buyer::int + b4_match::int)                          AS passed
  FROM base;

COMMENT ON VIEW app.v_buyer_stage IS
  '매수자 사다리 — 매수자 → 매칭(채택). 그 뒤는 제안 사다리(0093).';

INSERT INTO app.schema_migrations(version) VALUES ('0114_match_needs_pick.sql')
ON CONFLICT DO NOTHING;
COMMIT;
