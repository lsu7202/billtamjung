-- 정보 칸엔 **정지가 없다**(2026-08-20).
--   정지는 「상대 때문에 못 간다」는 말이다 — 연락두절 · 매도의사 없음.
--   정보(명도·용도변경·멸실)는 내가 캐면 되는 일이라 못 갈 이유가 없다. 안 채운 것뿐이다.
--   빈칸이 곧 할 일인데 거기에 빨강까지 두면 「내 탓」과 「남의 탓」이 한 색이 된다.
--
-- 같이: 접촉 정지 사유에 **매도의사 없음**을 넣는다. 접촉과 의사를 한 칸으로 합쳤으니(0125)
--   사유도 한 목록이어야 한다 — 안 그러면 「말은 됐는데 안 판단다」를 적을 자리가 없다.
BEGIN;

-- ── 사유: 의사 목록을 접촉으로 흡수 ──────────────────────────────
INSERT INTO ref.enums(enum_key, code, label, sort_order, active) VALUES
  ('stop_reason_touch', '매도의사없음', '매도의사 없음',   3, true),
  ('stop_reason_touch', '나중에',       '나중에 팔 생각',  4, true)
ON CONFLICT (enum_key, code) DO UPDATE
  SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order, active = true;

-- 의사 칸이 없어졌으니 그 목록도 화면에서 내린다(과거 기록의 라벨 조회용으로 행은 남긴다)
UPDATE ref.enums SET active = false WHERE enum_key = 'stop_reason_intent';

-- 예전 「안 판다고 함」을 골라 둔 정지가 있으면 새 낱말로 옮긴다
UPDATE app.stops SET reason = '매도의사없음'
 WHERE reason = '안판다';

-- ── 정보 칸의 정지 판정 제거 ────────────────────────────────────
UPDATE app.stops SET resolved_at = now()
 WHERE stage = 'info' AND resolved_at IS NULL;

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
     OR COALESCE(l.myeolsil,   '미지정') <> '미지정')                          AS s2_talked,
    (COALESCE(l.call_result, '') <> '')                                        AS s2_try,
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
     AND s.stage <> 'info'                       -- 정보 칸엔 정지가 없다(0126)
)
SELECT b.building_pk, b.team_id,
       b.s1_owner, b.s2_touch, b.s3_intent, b.s4_info, b.s5_asset, b.s6_match, b.s6_open,
       b.info_filled,
       jsonb_build_object(
         'owner',  CASE WHEN st.stage='owner'  THEN 'stop' WHEN b.s1_owner  THEN 'done'
                        WHEN b.s1_try THEN 'open' ELSE 'none' END,
         'touch',  CASE WHEN st.stage='touch'  THEN 'stop' WHEN b.s2_touch  THEN 'done'
                        WHEN b.s2_talked THEN 'busy' WHEN b.s2_try THEN 'open' ELSE 'none' END,
         'info',   CASE WHEN b.s4_info   THEN 'done'
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
  '매물 사다리 — 소유자·접촉(의사 포함)·정보·계약 네 칸. 정지는 상대 때문인 칸에만(0126).';

INSERT INTO app.schema_migrations(version) VALUES ('0126_info_has_no_stop.sql')
ON CONFLICT DO NOTHING;
COMMIT;
