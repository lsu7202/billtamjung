-- 0141 제안 상태와 커밋 장부를 없앤다 — 남는 상태는 nego_rank 하나 (2026-08-29)
--
-- 「제안」은 폐기하기로 한 지 오래인데 코드에 잔재로 남아 있었다. 그 잔재가 실제로 사고를 냈다:
-- 브리핑 뒤 매수희망가를 조절하며 흥정하는 중에도 status 가 '제안' 에 멈춰 있어
-- 「제안 10일째 답 없음」이 매일 떴다. 화면은 「합의중」인데 카드는 거짓말을 했다.
--
-- 커밋 장부(proposal_events)도 같이 간다. 커밋이라는 개념은 이미 없앴고
-- 화면이 쓰는 것은 메모(app.contacts · kind='메모') 하나다. 두 장부를 두면
-- 「어느 쪽이 사실인가」가 다시 생긴다.
--
-- **상태는 nego_rank 하나로 판다**(0138):
--   0 철회·계약파기 · 1 합의 전 · 2 합의중 · 3 계약예정 · 4 계약완료 · 5 중도금 · 6 거래종료
-- 0 을 만들던 status 값 둘은 dropped_at 한 칸으로 바꾼다 — 「죽었다」는 사실 하나면 되고,
-- 왜 죽었는지는 메모에 적힌다.
--
-- **재촉은 이제 매수희망가가 판다.** 희망가가 있다는 것은 「이 값이면 사겠다」를 들었다는 뜻이다.
-- 브리핑했는데 희망가가 없으면 「살 건지 물어보기」, 브리핑 자체가 없으면 「브리핑하기」.
-- 거절은 보류로 적는다(0140 이 proposal 보류를 열어 뒀다).

BEGIN;

-- ── 1. 죽은 제안 자리 ──────────────────────────────────────────
ALTER TABLE app.proposals ADD COLUMN IF NOT EXISTS dropped_at timestamptz;
COMMENT ON COLUMN app.proposals.dropped_at IS
  '이 짝은 죽었다(옛 status 철회·계약파기). 사유는 메모에 적는다.';
UPDATE app.proposals SET dropped_at = updated_at
 WHERE status IN ('철회','계약파기') AND dropped_at IS NULL;

-- ── 2. 상태를 보는 뷰·함수를 dropped_at 으로 갈아끼운다 ────────
CREATE OR REPLACE FUNCTION app.nego_rank(p app.proposals)
 RETURNS integer LANGUAGE sql STABLE
AS $function$
  SELECT CASE
    WHEN p.dropped_at IS NOT NULL                               THEN 0
    WHEN EXISTS (SELECT 1 FROM app.schedules s
                  WHERE s.proposal_id = p.id AND s.category='잔금' AND s.state='완료')
         AND p.picked_at IS NOT NULL                            THEN 6   -- 거래종료
    WHEN EXISTS (SELECT 1 FROM app.schedules s
                  WHERE s.proposal_id = p.id AND s.category='중도금' AND s.state='완료')
         AND p.picked_at IS NOT NULL                            THEN 5   -- 중도금
    WHEN EXISTS (SELECT 1 FROM app.schedules s
                  WHERE s.proposal_id = p.id AND s.category='계약' AND s.state='완료')
         AND p.picked_at IS NOT NULL                            THEN 4   -- 계약완료
    WHEN p.picked_at IS NOT NULL                                THEN 3   -- 계약예정
    WHEN p.hope_price IS NOT NULL
         OR COALESCE(array_length(p.brief_how, 1), 0) > 0       THEN 2   -- 합의중
    ELSE 1                                                               -- 합의 전
  END;
$function$;

-- 짝의 진행 — d4_nego 는 이제 **매수희망가 하나**로 판다.
-- 예전엔 거절값(reject_price)과 매도 쪽 커밋도 봤는데 둘 다 없어졌다.
-- d6_sign 도 status='계약' 대신 nego_rank 와 같은 사실(계약 일정 완료 + 상대 확정)을 본다.
CREATE OR REPLACE VIEW app.v_proposal_stage AS
WITH base AS (
  SELECT p.id, p.team_id,
         COALESCE(array_length(p.brief_how, 1), 0) > 0            AS d2_brief,
         p.visited_on IS NOT NULL                                 AS d3_visit,
         p.hope_price IS NOT NULL                                 AS d4_nego,
         p.pre_contract_on IS NOT NULL
           OR p.pre_contract_amount IS NOT NULL                   AS d5_pre,
         EXISTS (SELECT 1 FROM app.schedules s
                  WHERE s.proposal_id = p.id AND s.category='계약' AND s.state='완료')
           AND p.picked_at IS NOT NULL                            AS d6_sign,
         EXISTS (SELECT 1 FROM app.schedules s
                  WHERE s.proposal_id = p.id AND s.category='잔금' AND s.state='완료') AS d7_pay,
         EXISTS (SELECT 1 FROM app.schedules s
                  WHERE s.proposal_id = p.id AND s.category='잔금' AND s.state='예정') AS d7_due,
         p.report_filed_on IS NOT NULL
           OR EXISTS (SELECT 1 FROM app.deal_docs d
                       WHERE d.proposal_id = p.id AND d.code='r_file')  AS d8_file,
         p.dropped_at
    FROM app.proposals p)
SELECT id, team_id, d2_brief, d3_visit, d4_nego, d5_pre, d6_sign, d7_pay, d7_due, d8_file,
       jsonb_build_object(
         'pay',  CASE WHEN d7_pay THEN 'done' WHEN d7_due THEN 'busy' ELSE 'none' END,
         'file', CASE WHEN d8_file THEN 'done' ELSE 'none' END) AS cells,
       -- 가계약(d5_pre)은 사다리 칸이 아니다. 있는 거래도 없는 거래도 있는데 칸으로 세워 두니,
       -- 잔금까지 끝난 짝이 「가계약」에 걸려 있었다(0141 검증에서 잡힘). 값은 남고 칸만 뺀다.
       CASE WHEN dropped_at IS NOT NULL THEN 'out'
            WHEN NOT d2_brief THEN 'brief'
            WHEN NOT d4_nego  THEN 'nego'
            WHEN NOT d6_sign  THEN 'sign'
            WHEN NOT d7_pay   THEN 'pay'
            WHEN NOT d8_file  THEN 'file'
            ELSE 'done' END AS stage
  FROM base;

CREATE OR REPLACE VIEW app.v_buyer_stage AS
WITH base AS (
  SELECT b.id, b.team_id,
         b.phone IS NOT NULL AND b.phone <> ''                    AS b1_try,
         b.phone IS NOT NULL AND b.phone <> ''
           AND (EXISTS (SELECT 1 FROM app.buyer_conditions c WHERE c.buyer_id = b.id)
             OR EXISTS (SELECT 1 FROM app.proposals p
                         WHERE p.buyer_id = b.id AND p.dropped_at IS NULL)) AS b1_buyer,
         EXISTS (SELECT 1 FROM app.proposals p
                   JOIN app.schedules sc ON sc.proposal_id = p.id
                                        AND sc.category='계약' AND sc.state='완료'
                  WHERE p.buyer_id = b.id AND p.picked_at IS NOT NULL)      AS b4_match,
         EXISTS (SELECT 1 FROM app.proposals p
                  WHERE p.buyer_id = b.id AND p.picked_at IS NOT NULL
                    AND p.dropped_at IS NULL)                               AS b4_open,
         EXISTS (SELECT 1 FROM app.proposals p
                  WHERE p.buyer_id = b.id AND p.dropped_at IS NULL)         AS b4_try
    FROM app.buyers b WHERE b.deleted_at IS NULL),
st AS (SELECT s.target_id::bigint AS buyer_id, s.team_id, s.stage
         FROM app.stops s
        WHERE s.target_type='buyer' AND s.resolved_at IS NULL)
SELECT b.id, b.team_id, b.b1_buyer, b.b4_match, b.b4_open,
       jsonb_build_object(
         'buyer', CASE WHEN st.stage IS NOT NULL THEN 'stop'
                       WHEN b.b1_buyer THEN 'done'
                       WHEN b.b1_try   THEN 'open' ELSE 'none' END,
         'match', CASE WHEN b.b4_match THEN 'done'
                       WHEN b.b4_open  THEN 'busy'
                       WHEN b.b4_try   THEN 'open' ELSE 'none' END) AS cells,
       CASE WHEN NOT b.b1_buyer THEN 'buyer'
            WHEN NOT b.b4_match THEN 'match' ELSE 'done' END AS stage,
       b.b1_buyer::int + b.b4_match::int AS passed
  FROM base b LEFT JOIN st ON st.buyer_id = b.id AND st.team_id = b.team_id;

CREATE OR REPLACE VIEW app.v_listing_stage AS
WITH base AS (
  SELECT l.building_pk, l.team_id,
         l.owner_id IS NOT NULL AND o.phone IS NOT NULL AND o.phone <> '' AS s1_owner,
         l.owner_id IS NOT NULL                                           AS s1_try,
         COALESCE(l.call_result,'') = '통화됨'
           OR (l.intent  IS NOT NULL AND l.intent  <> '미지정')
           OR (l.urgency IS NOT NULL AND l.urgency <> '미지정')
           OR COALESCE(l.meongdo,'미지정')    <> '미지정'
           OR COALESCE(l.use_change,'미지정') <> '미지정'
           OR COALESCE(l.myeolsil,'미지정')   <> '미지정'                 AS s2_talked,
         COALESCE(l.call_result,'') <> ''                                 AS s2_try,
         l.intent = '원함'                                                AS s2_touch,
         l.intent = '원함'                                                AS s3_intent,
         COALESCE(l.meongdo,'미지정')    <> ALL (ARRAY['미지정','확인중'])
           AND COALESCE(l.use_change,'미지정') <> ALL (ARRAY['미지정','확인중'])
           AND COALESCE(l.myeolsil,'미지정')   <> ALL (ARRAY['미지정','확인중'])  AS s4_info,
         l.meongdo='확인중' OR l.use_change='확인중' OR l.myeolsil='확인중' AS s4_busy,
         COALESCE(l.meongdo,'미지정')    <> '미지정'
           OR COALESCE(l.use_change,'미지정') <> '미지정'
           OR COALESCE(l.myeolsil,'미지정')   <> '미지정'                 AS s4_try,
         EXISTS (SELECT 1 FROM app.photos p
                  WHERE p.building_pk = l.building_pk AND p.team_id = l.team_id
                    AND p.deleted_at IS NULL)
           AND EXISTS (SELECT 1 FROM app.reports r
                         JOIN app.team_members tm ON tm.account_id = r.account_id
                        WHERE r.building_pk = l.building_pk AND tm.team_id = l.team_id
                          AND r.status = 'done'::app.report_status)        AS s5_asset,
         EXISTS (SELECT 1 FROM app.proposals pr
                   JOIN app.schedules sc ON sc.proposal_id = pr.id
                                        AND sc.category='계약' AND sc.state='완료'
                  WHERE pr.team_id = l.team_id AND pr.building_pk = l.building_pk
                    AND pr.picked_at IS NOT NULL)                          AS s6_match,
         EXISTS (SELECT 1 FROM app.proposals pr
                  WHERE pr.team_id = l.team_id AND pr.building_pk = l.building_pk
                    AND pr.picked_at IS NOT NULL AND pr.dropped_at IS NULL) AS s6_open,
         EXISTS (SELECT 1 FROM app.proposals pr
                  WHERE pr.team_id = l.team_id AND pr.building_pk = l.building_pk
                    AND pr.dropped_at IS NULL)                             AS s6_try,
         (CASE WHEN COALESCE(l.meongdo,'미지정')    <> ALL (ARRAY['미지정','확인중']) THEN 1 ELSE 0 END)
       + (CASE WHEN COALESCE(l.use_change,'미지정') <> ALL (ARRAY['미지정','확인중']) THEN 1 ELSE 0 END)
       + (CASE WHEN COALESCE(l.myeolsil,'미지정')   <> ALL (ARRAY['미지정','확인중']) THEN 1 ELSE 0 END)
           AS info_filled
    FROM app.listings l
    LEFT JOIN app.owners o ON o.id = l.owner_id AND o.deleted_at IS NULL),
st AS (SELECT s.target_id AS building_pk, s.team_id,
              CASE WHEN s.stage='intent' THEN 'touch' ELSE s.stage END AS stage
         FROM app.stops s
        WHERE s.target_type='listing' AND s.resolved_at IS NULL AND s.stage <> 'info')
SELECT b.building_pk, b.team_id, b.s1_owner, b.s2_touch, b.s3_intent, b.s4_info,
       b.s5_asset, b.s6_match, b.s6_open, b.info_filled,
       jsonb_build_object(
         'owner', CASE WHEN st.stage='owner' THEN 'stop'
                       WHEN b.s1_owner THEN 'done'
                       WHEN b.s1_try   THEN 'open' ELSE 'none' END,
         'touch', CASE WHEN st.stage='touch' THEN 'stop'
                       WHEN b.s2_touch  THEN 'done'
                       WHEN b.s2_talked THEN 'busy'
                       WHEN b.s2_try    THEN 'open' ELSE 'none' END,
         'info',  CASE WHEN b.s4_info THEN 'done'
                       WHEN b.s4_busy THEN 'busy'
                       WHEN b.s4_try  THEN 'open' ELSE 'none' END,
         'match', CASE WHEN st.stage='match' THEN 'stop'
                       WHEN b.s6_match THEN 'done'
                       WHEN b.s6_open  THEN 'busy'
                       WHEN b.s6_try   THEN 'open' ELSE 'none' END) AS cells,
       CASE WHEN NOT b.s1_owner THEN 'owner'
            WHEN NOT b.s2_touch THEN 'touch'
            WHEN NOT b.s4_info  THEN 'info'
            WHEN NOT b.s6_match THEN 'match' ELSE 'done' END AS stage,
       b.s1_owner::int + b.s2_touch::int + b.s4_info::int + b.s6_match::int AS passed
  FROM base b LEFT JOIN st ON st.building_pk = b.building_pk AND st.team_id = b.team_id;

-- ── 3. 제안 칸들을 뗀다 ────────────────────────────────────────
ALTER TABLE app.proposals
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS channel,             -- 제안 수단. 값이 들어간 행이 한 번도 없었다
  DROP COLUMN IF EXISTS proposed_on,
  DROP COLUMN IF EXISTS propose_count,
  DROP COLUMN IF EXISTS reject_reason,       -- 거절은 이제 보류(app.stops · target_type='proposal')
  DROP COLUMN IF EXISTS reject_reason_sub,
  DROP COLUMN IF EXISTS reject_price;

-- ── 4. 커밋 장부 ───────────────────────────────────────────────
-- 지우지 않고 옮겨 둔다. 코드는 이 표를 **한 곳에서도 안 본다** — 이름의 밑줄이 그 표시다.
-- 프로덕션에는 사람이 적은 줄이 들어 있을 수 있어, 되찾을 길만 남기고 길에서 치운다.
ALTER TABLE app.schedules
  DROP COLUMN IF EXISTS event_id,
  DROP COLUMN IF EXISTS promoted_by_event_id;   -- 「이 커밋이 완료시켰다」의 짝 쪽 링크
ALTER TABLE app.contacts DROP COLUMN IF EXISTS src_event_id;

-- 장부가 하나가 되면서 잃을 뻔한 것 하나: 짝 창에서 적은 메모가 **어느 매물 얘기였나**.
-- 줄은 그 사람(buyer)의 장부에 서지만, 매물 합본 타임라인도 같은 줄을 봐야 한다.
ALTER TABLE app.contacts ADD COLUMN IF NOT EXISTS proposal_id bigint REFERENCES app.proposals(id) ON DELETE SET NULL;
COMMENT ON COLUMN app.contacts.proposal_id IS
  '이 줄이 어느 짝 얘기인가(선택). 줄의 자리는 target_type/target_id 가 정한다.';
CREATE INDEX IF NOT EXISTS contacts_proposal_idx ON app.contacts (proposal_id) WHERE proposal_id IS NOT NULL;
DROP VIEW IF EXISTS app.v_proposal_events;
ALTER TABLE IF EXISTS app.proposal_events RENAME TO _proposal_events_bak_0141;
COMMENT ON TABLE app._proposal_events_bak_0141 IS
  '옛 커밋 장부(2026-08-29 폐기). 코드는 안 본다. 메모의 정본은 app.contacts · kind=메모.';

-- ── 5. 짝 보류의 사유 목록 ─────────────────────────────────────
-- 거절이 보류로 옮겨 오면서 사유도 같이 온다. 지금 stop_reason_deal 은 「때가 아님」류
-- 셋뿐인데, 그건 「지금은 못 간다」의 사유고 「이 매물은 아니다」의 사유가 아니다.
-- 옛 거절 사유(집계의 재료였다 — 「왜 안 나갔나」)를 그대로 옮겨 온다.
-- buyer_side(매수자 사정)를 따로 두는 이유는 그때와 같다: 매물 탓과 섞이면 집계가 거짓이 된다.
INSERT INTO ref.enums(enum_key, code, label, sort_order, active) VALUES
  ('stop_reason_deal', '가격',     '가격이 안 맞음',      1, true),
  ('stop_reason_deal', '수익률',   '수익률이 안 나옴',    2, true),
  ('stop_reason_deal', '위치',     '위치가 아님',         3, true),
  ('stop_reason_deal', '건물상태', '건물 상태',           4, true),
  ('stop_reason_deal', '규모',     '규모가 안 맞음',      5, true),
  ('stop_reason_deal', '명도',     '명도가 어려움',       6, true),
  ('stop_reason_deal', '임차인',   '임차인 구성',         7, true),
  ('stop_reason_deal', '용도',     '용도가 안 맞음',      8, true),
  ('stop_reason_deal', '상대사정', '매수자 사정',         9, true),
  ('stop_reason_deal', '시점',     '때가 아님',          10, true),
  ('stop_reason_deal', '선행조건', '먼저 끝날 일이 있음', 11, true)
ON CONFLICT (enum_key, code) DO UPDATE
  SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order, active = true;

COMMIT;
