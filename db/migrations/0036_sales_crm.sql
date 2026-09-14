-- 0036 · 영업관리(S04) — 매수자 · 제안 · 접촉이력
--
-- 부동산 업무는 매도자 — 매물 — 매수자 3자 구조인데 우리는 왼쪽 절반만 있었다.
-- 현장 엑셀을 뜯어보니 그 표의 단위는 매수자도 매물도 아니라 **제안**이었다
-- (같은 매물이 매수자 205·206·211 밑에 반복해 나온다 = many-to-many).
-- 근거 = specs/03-features/S04-영업관리.md
--
-- 멱등하게 쓴다 — apply.sh는 적용 이력 없이 매번 전부 다시 돌린다.

BEGIN;

-- ── 매수자 ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.buyers (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id             bigint NOT NULL REFERENCES app.teams(id) ON DELETE CASCADE,
  assignee_account_id bigint REFERENCES app.accounts(id),
  name                text NOT NULL,
  phone               text,
  grade               text,        -- A / B / C (엑셀의 'C/A+')
  source              text,        -- 유입경로(광고·소개·직접문의…)
  is_corp             boolean,     -- 법인/개인
  status              text NOT NULL DEFAULT '활성',   -- 활성 / 보류 / 종료
  memo                text,        -- 필터로 안 잡히는 조건("식당 임차X" 등) — 매칭엔 안 건다
  -- 조건 = saved_searches.conditions_json 과 **같은 모양**.
  -- 조건 편집 = 상세검색 모달(S01b), 매칭 엔진 = 검색(S01). 규칙이 한 벌이라 결과가 어긋나지 않는다.
  conditions_json     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
CREATE INDEX IF NOT EXISTS buyers_team_idx ON app.buyers (team_id) WHERE deleted_at IS NULL;

-- ── 제안 (중심축) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.proposals (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id       bigint NOT NULL REFERENCES app.teams(id) ON DELETE CASCADE,
  buyer_id      bigint NOT NULL REFERENCES app.buyers(id) ON DELETE CASCADE,
  building_pk   text   NOT NULL,
  -- 후보 = 골라뒀지만 아직 안 보냄. 이게 있어야 "골라놓고 안 돌린 것"이 안 샌다.
  status        text   NOT NULL DEFAULT '후보',   -- 후보/제안/관심/거절/계약
  proposed_on   date,                              -- 최초 제안일(보낸 시점)
  propose_count int    NOT NULL DEFAULT 0,         -- 재제안 횟수
  channel       text,                              -- 브리핑/전화/문자/방문
  report_id     bigint REFERENCES app.reports(id) ON DELETE SET NULL,   -- 보낸 브리핑
  -- 거절 사유 — 주 사유 1개로 집계한다. buyer_side(매수자 사정)를 반드시 분리해야
  -- '매물 탓 거절'과 섞이지 않는다.
  reject_reason      text,        -- price/roi/location/condition/size/meongdo/tenant/use/buyer_side/etc
  reject_reason_sub  text[],      -- 부가 사유(다중)
  reject_price       bigint,      -- 가격 거절 시 매수자가 말한 상한(원)
  note          text,
  created_by    bigint REFERENCES app.accounts(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- 같은 매수자에게 같은 매물을 두 번 돌리는 실수를 구조로 막는다(엑셀은 색칠로 관리했다).
-- 재제안은 새 행이 아니라 proposed_on 갱신 + propose_count 증가.
CREATE UNIQUE INDEX IF NOT EXISTS proposals_uniq ON app.proposals (team_id, buyer_id, building_pk);
CREATE INDEX IF NOT EXISTS proposals_building_idx ON app.proposals (team_id, building_pk);
CREATE INDEX IF NOT EXISTS proposals_status_idx   ON app.proposals (team_id, status);

-- ── 접촉 이력 (매수자·매도자 공용) ──────────────────────
CREATE TABLE IF NOT EXISTS app.contacts (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id     bigint NOT NULL REFERENCES app.teams(id) ON DELETE CASCADE,
  target_type text   NOT NULL,     -- buyer | listing
  target_id   text   NOT NULL,     -- buyer.id(문자열) 또는 building_pk
  kind        text,                -- 전화/문자/방문/메일
  occurred_on date   NOT NULL DEFAULT current_date,
  note        text,
  created_by  bigint REFERENCES app.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contacts_target_idx ON app.contacts (team_id, target_type, target_id, occurred_on DESC);

-- updated_at 자동 갱신 — 0004의 공용 트리거 재사용
DROP TRIGGER IF EXISTS t_upd ON app.buyers;
CREATE TRIGGER t_upd BEFORE UPDATE ON app.buyers
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
DROP TRIGGER IF EXISTS t_upd ON app.proposals;
CREATE TRIGGER t_upd BEFORE UPDATE ON app.proposals
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

COMMIT;
