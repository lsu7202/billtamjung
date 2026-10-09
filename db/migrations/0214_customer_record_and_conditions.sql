-- 0214 고객 = 성격 + 조건 (S09, 2026-10-04 대표)
--
-- 고객관리는 고객(중개사가 쓰는 고객 기록) + 문의. 고객 칸은 중개사가 쓰던 고객 엑셀 열 그대로다.
-- 조건은 「저장한 조건에 고객을 붙이는」 방식 — 옛 매수자 조건 표(buyer_conditions)를 저장한 조건으로 합친다.
-- 고객 프로필(고객 쪽)과 고객 기록의 칸 이름을 맞춘다 — 문의에서 「고객으로 등록」할 때 그대로 옮겨진다.
BEGIN;

-- ── 고객 성격(app.buyers) ──
ALTER TABLE app.buyers
  ADD COLUMN IF NOT EXISTS goal text[],                                   -- 시세차익 · 수익률 · 실사용(여럿)
  ADD COLUMN IF NOT EXISTS build_intent text CHECK (build_intent IN ('있음','없음','모름')),
  ADD COLUMN IF NOT EXISTS timing text CHECK (timing IN ('3개월 안','6개월 안','1년 안','미정')),
  ADD COLUMN IF NOT EXISTS literacy text CHECK (literacy IN ('처음','관심','공부해봄')),
  ADD COLUMN IF NOT EXISTS prefer_ad boolean,                             -- 광고 매물 선호(엑셀 「특징: 광고매물」)
  ADD COLUMN IF NOT EXISTS account_id bigint REFERENCES app.accounts(id); -- 빌탐정 고객 계정과 잇기
-- 같은 계정은 한 팀에 고객 하나 — 여러 번 문의해도 한 고객에 붙는다
CREATE UNIQUE INDEX IF NOT EXISTS buyers_team_account ON app.buyers(team_id, account_id)
  WHERE account_id IS NOT NULL AND deleted_at IS NULL;

-- ── 고객 프로필(고객 쪽) — 칸 이름을 고객 성격과 맞춘다. purposes(실사용 · 투자용 · 신축용) → goal + build_intent ──
ALTER TABLE app.customer_profile
  ADD COLUMN IF NOT EXISTS goal text[],
  ADD COLUMN IF NOT EXISTS build_intent text CHECK (build_intent IN ('있음','없음','모름')),
  ADD COLUMN IF NOT EXISTS literacy text CHECK (literacy IN ('처음','관심','공부해봄'));
UPDATE app.customer_profile SET
  goal = NULLIF(array_remove(ARRAY[CASE WHEN '실사용' = ANY(purposes) THEN '실사용' END,
                                   CASE WHEN '투자용' = ANY(purposes) THEN '수익률' END], NULL), '{}'),
  build_intent = CASE WHEN '신축용' = ANY(purposes) THEN '있음' END
 WHERE purposes IS NOT NULL;
ALTER TABLE app.customer_profile DROP COLUMN IF EXISTS purposes;

-- ── 조건 — 저장한 조건에 고객을 붙인다. 붙으면 팀 전체가 본다 ──
ALTER TABLE app.saved_searches
  ADD COLUMN IF NOT EXISTS team_id bigint REFERENCES app.teams(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS buyer_id bigint REFERENCES app.buyers(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS saved_searches_buyer ON app.saved_searches(buyer_id) WHERE buyer_id IS NOT NULL;
-- 옛 매수자 조건 옮기기(만든 사람 = 그 고객 담당, 없으면 팀 대표)
INSERT INTO app.saved_searches(account_id, name, conditions_json, team_id, buyer_id, created_at)
SELECT COALESCE(b.assignee_account_id, (SELECT t.owner_account_id FROM app.teams t WHERE t.id = c.team_id)),
       c.name, c.conditions_json, c.team_id, c.buyer_id, c.created_at
  FROM app.buyer_conditions c JOIN app.buyers b ON b.id = c.buyer_id;
DROP TABLE app.buyer_conditions;
-- 매칭 · 추천 쿼리(buyers.py)는 옛 이름으로 읽는다 — 같은 모양의 읽기 전용 뷰로 받는다
CREATE VIEW app.buyer_conditions AS
  SELECT id, team_id, buyer_id, name, conditions_json, created_at, created_at AS updated_at
    FROM app.saved_searches WHERE buyer_id IS NOT NULL AND closed_at IS NULL;

-- ── 문의 — 문의 순간 고객 조건 사본(고객이 프로필에 저장한 조건) ──
ALTER TABLE app.inquiries ADD COLUMN IF NOT EXISTS wants_snap jsonb;
-- 고객 프로필 사본 안의 옛 칸 이름도 맞춘다
UPDATE app.inquiries SET profile_snap = (profile_snap - 'purposes')
  || jsonb_strip_nulls(jsonb_build_object(
       'goal', (SELECT jsonb_agg(g) FROM (SELECT CASE p WHEN '실사용' THEN '실사용' WHEN '투자용' THEN '수익률' END g
                                            FROM jsonb_array_elements_text(profile_snap->'purposes') p) x WHERE g IS NOT NULL),
       'build_intent', CASE WHEN profile_snap->'purposes' ? '신축용' THEN '있음' END))
 WHERE profile_snap ? 'purposes';

-- ── 칩 사전 ──
INSERT INTO ref.enum_groups(enum_key, label) VALUES
  ('customer_goal', '목표'), ('build_intent', '건축의사'), ('customer_literacy', '이해도')
ON CONFLICT DO NOTHING;
INSERT INTO ref.enums(enum_key, code, label, sort_order) VALUES
  ('customer_goal', '시세차익', '시세차익', 10), ('customer_goal', '수익률', '수익률', 20), ('customer_goal', '실사용', '실사용', 30),
  ('build_intent', '있음', '있음', 10), ('build_intent', '없음', '없음', 20), ('build_intent', '모름', '모름', 30),
  ('customer_literacy', '처음', '처음', 10), ('customer_literacy', '관심', '관심', 20), ('customer_literacy', '공부해봄', '공부해봄', 30)
ON CONFLICT DO NOTHING;

COMMIT;
