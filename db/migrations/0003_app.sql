-- 0003_app.sql — app 스키마(계정·팀·크레딧·매물·오버레이·커뮤니티·산출물)
-- 근거: specs/04-data/schema-ddl.md §2~7, schema-app.md
BEGIN;

-- ── ENUM 타입 ────────────────────────────────────────
DO $$ BEGIN CREATE TYPE app.team_role      AS ENUM ('owner','member'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE app.credit_type    AS ENUM ('grant','spend','earn','expire','adjust'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE app.credit_bucket  AS ENUM ('monthly','earned','purchased'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE app.invite_channel AS ENUM ('phone','email'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE app.invite_status  AS ENUM ('pending','accepted','cancelled','expired'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE app.overlay_target AS ENUM ('building','parcel'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE app.report_kind    AS ENUM ('briefing','analysis'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE app.report_status  AS ENUM ('pending','generating','done','failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE app.memo_kind      AS ENUM ('team','secret'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 계정 · 팀 ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.accounts (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email             text UNIQUE NOT NULL,
  password_hash     text,
  name              text NOT NULL,
  office_name       text,
  phone             text,
  phone_verified_at timestamptz,
  is_admin          boolean NOT NULL DEFAULT false,
  tier              text NOT NULL DEFAULT 'trial',
  trial_started_at  timestamptz, trial_ends_at timestamptz,
  terms_agreed_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

CREATE TABLE IF NOT EXISTS app.teams (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name             text NOT NULL,
  owner_account_id bigint NOT NULL REFERENCES app.accounts(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.team_members (
  team_id    bigint NOT NULL REFERENCES app.teams(id),
  account_id bigint NOT NULL REFERENCES app.accounts(id),
  role       app.team_role NOT NULL,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  left_at    timestamptz,
  PRIMARY KEY (team_id, account_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS team_one_owner ON app.team_members(team_id)
  WHERE role='owner' AND left_at IS NULL;

CREATE TABLE IF NOT EXISTS app.team_invites (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id    bigint NOT NULL REFERENCES app.teams(id),
  invited_by bigint NOT NULL REFERENCES app.accounts(id),
  channel    app.invite_channel NOT NULL,
  target     text NOT NULL,
  token      text UNIQUE NOT NULL,
  status     app.invite_status NOT NULL DEFAULT 'pending',
  expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);

-- ── 크레딧 ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.credit_entries (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id  bigint NOT NULL REFERENCES app.accounts(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  type        app.credit_type   NOT NULL,
  bucket      app.credit_bucket NOT NULL,
  amount      int NOT NULL,
  reason      text,
  ref_type    text, ref_id bigint,
  expires_at  timestamptz
);
CREATE INDEX IF NOT EXISTS credit_entries_acct ON app.credit_entries(account_id, occurred_at);

CREATE TABLE IF NOT EXISTS app.credit_balances (
  account_id bigint NOT NULL REFERENCES app.accounts(id),
  bucket     app.credit_bucket NOT NULL,
  amount     int NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, bucket)
);

-- ── 매물 등록(선점) · 오버레이 ───────────────────────
CREATE TABLE IF NOT EXISTS app.listings (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  building_pk         text NOT NULL,
  team_id             bigint NOT NULL REFERENCES app.teams(id),
  assignee_account_id bigint REFERENCES app.accounts(id),
  status text, urgency text, grade text, ipji text,
  owner_type text, owner_name text,
  relation text, cooperation text, kindness text, intent text,
  owner_phone text, listing_no text, received_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (building_pk, team_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS listings_claim ON app.listings(building_pk, team_id)
  WHERE assignee_account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS app.overlays (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id     bigint NOT NULL REFERENCES app.teams(id),
  target_type app.overlay_target NOT NULL,
  target_id   text NOT NULL,
  field       text NOT NULL REFERENCES ref.fields(field_key),
  value       text,
  updated_by  bigint REFERENCES app.accounts(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, target_type, target_id, field)
);

-- ── 층별임대 · 커뮤니티 · 광고가 ─────────────────────
CREATE TABLE IF NOT EXISTS app.floor_rents (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  building_pk text NOT NULL, team_id bigint NOT NULL REFERENCES app.teams(id),
  floor text, unit_no text, use text,
  exclusive_area numeric, contract_area numeric,
  deposit bigint, rent bigint, maintenance bigint,
  is_vacant boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  UNIQUE (building_pk, team_id, floor, unit_no)
);
CREATE INDEX IF NOT EXISTS floor_rents_bldg ON app.floor_rents(building_pk) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS app.wiki_posts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  building_pk text NOT NULL,
  author_account_id bigint REFERENCES app.accounts(id),
  category text, body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE TABLE IF NOT EXISTS app.wiki_votes (
  post_id bigint NOT NULL REFERENCES app.wiki_posts(id),
  account_id bigint NOT NULL REFERENCES app.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, account_id)
);
CREATE TABLE IF NOT EXISTS app.wiki_reports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id bigint NOT NULL REFERENCES app.wiki_posts(id),
  reporter_account_id bigint REFERENCES app.accounts(id),
  reason text, status text NOT NULL DEFAULT 'pending',
  handled_by bigint REFERENCES app.accounts(id), handled_at timestamptz
);

CREATE TABLE IF NOT EXISTS app.ad_prices (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  building_pk text NOT NULL, observed_on date NOT NULL,
  price bigint,
  is_mine boolean NOT NULL DEFAULT false,
  reporter_account_id bigint REFERENCES app.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS ad_prices_bldg ON app.ad_prices(building_pk, observed_on) WHERE deleted_at IS NULL;

-- ── 산출물 · 개인 데이터 ─────────────────────────────
CREATE TABLE IF NOT EXISTS app.reports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES app.accounts(id),
  building_pk text NOT NULL,
  kind   app.report_kind   NOT NULL,
  status app.report_status NOT NULL DEFAULT 'pending',
  parent_id bigint REFERENCES app.reports(id),
  credits_spent int, file_path text, options_json jsonb,
  source_watermark timestamptz,
  master_version int,
  formula_set_version int REFERENCES ref.formula_sets(set_version),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz, failed_reason text
);
CREATE INDEX IF NOT EXISTS reports_acct ON app.reports(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app.favorites (
  account_id bigint NOT NULL REFERENCES app.accounts(id),
  building_pk text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, building_pk)
);
CREATE TABLE IF NOT EXISTS app.saved_searches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES app.accounts(id),
  name text NOT NULL, conditions_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS app.memos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  building_pk text NOT NULL, team_id bigint NOT NULL REFERENCES app.teams(id),
  kind app.memo_kind NOT NULL,
  body text, author_account_id bigint REFERENCES app.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);

COMMIT;
