-- 매수자 칸의 완료 기준을 넓힌다(2026-08-19) — **담아 둔 매물도 증거다**.
--   기준이 「전화 + 조건」이라, 조건을 안 적고 바로 매물을 담는 흔한 흐름에서 첫 칸이
--   영영 회색이었다. 칸이 묻는 것은 「이 사람이 누구고 무엇을 원하는지 아는가」인데,
--   담아 둔 매물은 그 답을 이미 보여 준다(무엇을 보여줄지 정했다는 뜻이라서).
--     none  전화도 없다
--     open  전화는 있는데 원하는 것을 모른다
--     done  전화 + (조건 또는 담은 매물)
BEGIN;

DROP VIEW IF EXISTS app.v_buyer_stage;
CREATE VIEW app.v_buyer_stage AS
WITH base AS (
  SELECT b.id, b.team_id,
    (b.phone IS NOT NULL AND b.phone <> '')                                      AS b1_try,
    ((b.phone IS NOT NULL AND b.phone <> '')
     AND (EXISTS (SELECT 1 FROM app.buyer_conditions c WHERE c.buyer_id = b.id)
          OR EXISTS (SELECT 1 FROM app.proposals p
                      WHERE p.buyer_id = b.id
                        AND p.status NOT IN ('철회', '계약파기'))))               AS b1_buyer,
    EXISTS (SELECT 1 FROM app.proposals p
             JOIN app.schedules sc ON sc.proposal_id = p.id
                                  AND sc.category = '계약' AND sc.state = '완료'
             WHERE p.buyer_id = b.id AND p.picked_at IS NOT NULL)                AS b4_match,
    EXISTS (SELECT 1 FROM app.proposals p
             WHERE p.buyer_id = b.id AND p.picked_at IS NOT NULL
               AND p.status NOT IN ('철회', '계약파기'))                          AS b4_open,
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
            WHEN NOT b.b4_match THEN 'match'
            ELSE 'done' END                                     AS stage,
       (b.b1_buyer::int + b.b4_match::int)                      AS passed
  FROM base b
  LEFT JOIN st ON st.buyer_id = b.id AND st.team_id = b.team_id;

INSERT INTO app.schema_migrations(version) VALUES ('0122_buyer_cell_by_pick.sql')
ON CONFLICT DO NOTHING;
COMMIT;
