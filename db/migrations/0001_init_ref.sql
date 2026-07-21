-- 0001_init_ref.sql — 확장·스키마·메타데이터 레지스트리(ref)
-- 근거: specs/04-data/schema-ref.md
BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS master;
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS ref;

-- ── 타입 ─────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE ref.data_type   AS ENUM ('num','text','enum','date','series','bool');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE ref.field_layer AS ENUM ('public','private','derived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE ref.target_kind AS ENUM ('building','parcel');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── enum 레지스트리 ──────────────────────────────────
CREATE TABLE IF NOT EXISTS ref.enum_groups (
  enum_key  text PRIMARY KEY,
  label     text NOT NULL,
  two_tier  boolean NOT NULL DEFAULT false,
  note      text
);

CREATE TABLE IF NOT EXISTS ref.enums (
  enum_key    text NOT NULL REFERENCES ref.enum_groups(enum_key) ON DELETE CASCADE,
  code        text NOT NULL,
  label       text NOT NULL,
  sort_order  int  NOT NULL DEFAULT 0,
  tier        text CHECK (tier IN ('primary','secondary')),
  parent_code text,
  active      boolean NOT NULL DEFAULT true,
  meta        jsonb  NOT NULL DEFAULT '{}',
  PRIMARY KEY (enum_key, code)
);
CREATE INDEX IF NOT EXISTS enums_group_idx ON ref.enums (enum_key, sort_order) WHERE active;

-- ── 필드 레지스트리 ──────────────────────────────────
CREATE TABLE IF NOT EXISTS ref.fields (
  field_key     text PRIMARY KEY,
  label         text NOT NULL,
  unit          text,
  data_type     ref.data_type   NOT NULL,
  layer         ref.field_layer NOT NULL,
  target        ref.target_kind NOT NULL DEFAULT 'building',
  source_ref    text,
  enum_key      text REFERENCES ref.enum_groups(enum_key),
  formula_id    text,
  editable      boolean NOT NULL DEFAULT false,
  masked        boolean NOT NULL DEFAULT false,
  searchable    boolean NOT NULL DEFAULT false,
  in_report     boolean NOT NULL DEFAULT false,
  display_group text,
  display_order int NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  description   text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fields_enum_ck    CHECK (data_type <> 'enum'   OR enum_key   IS NOT NULL),
  CONSTRAINT fields_derived_ck CHECK (layer     <> 'derived' OR formula_id IS NOT NULL),
  CONSTRAINT fields_public_ck  CHECK (layer     <> 'public'  OR source_ref IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS fields_group_idx  ON ref.fields (display_group, display_order) WHERE active;
CREATE INDEX IF NOT EXISTS fields_search_idx ON ref.fields (searchable) WHERE active AND searchable;

-- ── 산식 파라미터(버전) ──────────────────────────────
CREATE TABLE IF NOT EXISTS ref.formula_sets (
  set_version    int PRIMARY KEY,
  effective_from date NOT NULL,
  active         boolean NOT NULL DEFAULT false,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS formula_active_one ON ref.formula_sets(active) WHERE active;

CREATE TABLE IF NOT EXISTS ref.formula_params (
  set_version int  NOT NULL REFERENCES ref.formula_sets(set_version) ON DELETE CASCADE,
  formula_id  text NOT NULL,
  param_key   text NOT NULL,
  value_num   numeric,
  value_json  jsonb,
  PRIMARY KEY (set_version, formula_id, param_key),
  CHECK (value_num IS NOT NULL OR value_json IS NOT NULL)
);

COMMIT;
