# 실행 DDL — master · app (PostgreSQL 14+ / PostGIS)

> [[schema-app]](설계·표) · [[schema-ref]](레지스트리 DDL) · [[schema]](master 건물 물리)를 **실행 가능한 CREATE TABLE**로 확정.
> 관통원칙 P1(team_id NOT NULL)·P2(잔액 CHECK 없음)·P3(soft delete)·P4(작성자 nullable)·P5(_at UTC·금액 원 정수 BIGINT). 작성 2026-07-21.

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE SCHEMA IF NOT EXISTS master;
CREATE SCHEMA IF NOT EXISTS app;
-- ref 스키마 = schema-ref.md
```

---

## 1. master 스키마 (읽기전용 · 버전 물리테이블 + 뷰)

master 컬럼 정의는 [[schema]]·[[data-overview]]. 여기서는 **버전·스왑·공간·적재감사** 골격만.

```sql
-- 적재 버전(스케쥴러가 갱신 — 01-상세설계 §2.8)
CREATE TABLE master.master_version (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),   -- 단일 행
  version     int NOT NULL,
  loaded_at   timestamptz NOT NULL,
  source      text
);

-- 적재 감사 로그(01-상세설계 §2.4)
CREATE TABLE master.master_loads (
  run_id       uuid PRIMARY KEY,
  source       text NOT NULL,
  started_at   timestamptz NOT NULL,
  finished_at  timestamptz,
  status       text NOT NULL CHECK (status IN ('running','success','failed')),
  rows_in      bigint, rows_out bigint,
  validation   jsonb DEFAULT '{}',
  from_version int, to_version int,
  error        text
);

-- 버전 물리테이블(예: 건물) — 스왑은 뷰 재지정(§2.6). 컬럼 전량은 schema.md
CREATE TABLE master.buildings_v1 (
  building_pk  text PRIMARY KEY,           -- 대표지번 단위
  addr         text NOT NULL,              -- 지번주소(자동완성·검색)
  geom         geometry(Point,4326) NOT NULL, -- 대표 좌표(centroid)
  -- … 대장·면적·층수·건폐/용적 등(schema.md)
  jibun_norm   text                        -- 접두검색용 정규화 주소
);
-- 서비스가 바라보는 뷰(스왑 대상)
CREATE VIEW master.buildings AS SELECT * FROM master.buildings_v1;

-- 필지(공간) · 공시지가 시계열도 동일 패턴
CREATE TABLE master.parcels_v1 (
  pnu text PRIMARY KEY, building_pk text, geom geometry(MultiPolygon,4326) NOT NULL,
  uqa text, area numeric /* … */ );
CREATE VIEW master.parcels AS SELECT * FROM master.parcels_v1;

-- 공간·검색 인덱스
CREATE INDEX buildings_geom_gix ON master.buildings_v1 USING gist (geom);
CREATE INDEX parcels_geom_gix   ON master.parcels_v1   USING gist (geom);
CREATE INDEX buildings_addr_prefix ON master.buildings_v1 (jibun_norm text_pattern_ops); -- 자동완성 접두
CREATE INDEX buildings_addr_trgm   ON master.buildings_v1 USING gin (addr gin_trgm_ops);  -- 유사도
```

---

## 2. app 스키마 — ENUM 타입

```sql
CREATE TYPE app.team_role      AS ENUM ('owner','member');
CREATE TYPE app.credit_type    AS ENUM ('grant','spend','earn','expire','adjust');   -- 지급/소비/적립/소멸/조정
CREATE TYPE app.credit_bucket  AS ENUM ('monthly','earned','purchased');
CREATE TYPE app.invite_channel AS ENUM ('phone','email');
CREATE TYPE app.invite_status  AS ENUM ('pending','accepted','cancelled','expired');
CREATE TYPE app.overlay_target AS ENUM ('building','parcel');
CREATE TYPE app.report_kind    AS ENUM ('briefing','analysis');   -- 크레딧 10/30
CREATE TYPE app.report_status  AS ENUM ('pending','generating','done','failed');
CREATE TYPE app.memo_kind      AS ENUM ('team','secret');
```

---

## 3. 계정 · 팀

```sql
CREATE TABLE app.accounts (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email             text UNIQUE NOT NULL,
  password_hash     text,
  name              text NOT NULL,
  office_name       text,
  phone             text,                    -- [정식] 인증 시. 암호화 저장
  phone_verified_at timestamptz,             -- [정식]
  is_admin          boolean NOT NULL DEFAULT false,
  tier              text NOT NULL DEFAULT 'trial',  -- trial|starter|pro
  trial_started_at  timestamptz, trial_ends_at timestamptz,
  terms_agreed_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz              -- soft delete(P3)
);

CREATE TABLE app.teams (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name             text NOT NULL,            -- office_name or '{name} 팀'
  owner_account_id bigint NOT NULL REFERENCES app.accounts(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.team_members (
  team_id    bigint NOT NULL REFERENCES app.teams(id),
  account_id bigint NOT NULL REFERENCES app.accounts(id),
  role       app.team_role NOT NULL,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  left_at    timestamptz,                    -- 제외·탈퇴
  PRIMARY KEY (team_id, account_id)
);
-- 대표는 팀당 1명(부분 유니크)
CREATE UNIQUE INDEX team_one_owner ON app.team_members(team_id) WHERE role='owner' AND left_at IS NULL;

CREATE TABLE app.team_invites (          -- [정식]
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id    bigint NOT NULL REFERENCES app.teams(id),
  invited_by bigint NOT NULL REFERENCES app.accounts(id),
  channel    app.invite_channel NOT NULL,
  target     text NOT NULL,                  -- 전화/이메일(정규화)
  token      text UNIQUE NOT NULL,
  status     app.invite_status NOT NULL DEFAULT 'pending',
  expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
```

---

## 4. 크레딧 (원장 append-only + 잔액 캐시)

```sql
CREATE TABLE app.credit_entries (            -- append-only(수정·삭제 금지)
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id  bigint NOT NULL REFERENCES app.accounts(id),  -- 개인 귀속
  occurred_at timestamptz NOT NULL DEFAULT now(),
  type        app.credit_type   NOT NULL,
  bucket      app.credit_bucket NOT NULL,
  amount      int NOT NULL,                  -- 지급·적립 +, 소비·소멸 −
  reason      text,
  ref_type    text, ref_id bigint,           -- 산출물·위키 연결
  expires_at  timestamptz                    -- monthly만(말일)
);
CREATE INDEX credit_entries_acct ON app.credit_entries(account_id, occurred_at);

-- 잔액 캐시(트리거 동기화). P2: CHECK(>=0) 없음
CREATE TABLE app.credit_balances (
  account_id bigint NOT NULL REFERENCES app.accounts(id),
  bucket     app.credit_bucket NOT NULL,
  amount     int NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, bucket)
);
```

---

## 5. 매물 등록(선점) · 오버레이

```sql
CREATE TABLE app.listings (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  building_pk         text NOT NULL,                 -- 대표지번
  team_id             bigint NOT NULL REFERENCES app.teams(id),
  assignee_account_id bigint REFERENCES app.accounts(id),  -- NULL=선점 해제
  -- 업무 필드(사적·팀 공유). enum류는 ref.enums 코드 저장
  status       text, urgency text, grade text, ipji text,
  owner_type   text, owner_name text, owner_note text,
  relation     text, cooperation text, kindness text, intent text,
  owner_phone  text,                          -- 담당자·대표만 조회(마스킹)
  listing_no   text, received_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (building_pk, team_id)               -- 팀당 건물 1행
);
-- ★ 팀 내 배타적 선점(담당자 있을 때만)
CREATE UNIQUE INDEX listings_claim ON app.listings(building_pk, team_id)
  WHERE assignee_account_id IS NOT NULL;

CREATE TABLE app.overlays (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id     bigint NOT NULL REFERENCES app.teams(id),
  target_type app.overlay_target NOT NULL,
  target_id   text NOT NULL,                  -- building_pk 또는 PNU
  field       text NOT NULL REFERENCES ref.fields(field_key),  -- editable만(트리거 검증)
  value       text,
  updated_by  bigint REFERENCES app.accounts(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, target_type, target_id, field)
);
-- 검증 트리거 = schema-ref.md §4 (app.validate_overlay)
```

---

## 6. 층별임대 · 커뮤니티 · 광고가

```sql
CREATE TABLE app.floor_rents (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  building_pk text NOT NULL, team_id bigint NOT NULL REFERENCES app.teams(id),
  floor text, unit_no text, use text,
  exclusive_area numeric, contract_area numeric,
  deposit bigint, rent bigint, maintenance bigint,   -- 원 정수, 공실=0
  is_vacant boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  UNIQUE (building_pk, team_id, floor, unit_no)       -- 프리필↔수기 매칭키
);
CREATE INDEX floor_rents_bldg ON app.floor_rents(building_pk) WHERE deleted_at IS NULL;

CREATE TABLE app.wiki_posts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  building_pk text NOT NULL,
  author_account_id bigint REFERENCES app.accounts(id),  -- nullable(P4·탈퇴 익명화)
  category text, body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE TABLE app.wiki_votes (      -- 1인 1회, 취소=hard delete(P3 예외)
  post_id bigint NOT NULL REFERENCES app.wiki_posts(id),
  account_id bigint NOT NULL REFERENCES app.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, account_id)
);
CREATE TABLE app.wiki_reports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id bigint NOT NULL REFERENCES app.wiki_posts(id),
  reporter_account_id bigint REFERENCES app.accounts(id),
  reason text, status text NOT NULL DEFAULT 'pending',   -- 대기/처리/기각
  handled_by bigint REFERENCES app.accounts(id), handled_at timestamptz
);

CREATE TABLE app.ad_prices (       -- 광고가 시계열
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  building_pk text NOT NULL, observed_on date NOT NULL,
  price bigint,                    -- NULL='광고없음' 관측
  is_mine boolean NOT NULL DEFAULT false,
  reporter_account_id bigint REFERENCES app.accounts(id),  -- nullable
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX ad_prices_bldg ON app.ad_prices(building_pk, observed_on) WHERE deleted_at IS NULL;
```

---

## 7. 산출물 · 개인 데이터

```sql
CREATE TABLE app.reports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES app.accounts(id),  -- 개인 귀속
  building_pk text NOT NULL,
  kind   app.report_kind   NOT NULL,
  status app.report_status NOT NULL DEFAULT 'pending',     -- 비동기 잡 상태
  parent_id bigint REFERENCES app.reports(id),             -- 재생성 원본
  credits_spent int, file_path text, options_json jsonb,
  source_watermark timestamptz,                            -- 생성 시점 입력 max(updated_at)
  master_version   int,                                    -- 생성 시점 공공 버전
  formula_set_version int REFERENCES ref.formula_sets(set_version), -- 산식 재현성
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz, failed_reason text
);
CREATE INDEX reports_acct ON app.reports(account_id, created_at DESC);

CREATE TABLE app.favorites (          -- 개인 전용
  account_id bigint NOT NULL REFERENCES app.accounts(id),
  building_pk text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, building_pk)
);
CREATE TABLE app.saved_searches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES app.accounts(id),
  name text NOT NULL, conditions_json jsonb NOT NULL,      -- 폴리곤(GeoJSON) 포함
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.memos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  building_pk text NOT NULL, team_id bigint NOT NULL REFERENCES app.teams(id),
  kind app.memo_kind NOT NULL,          -- team | secret(담당자·대표만)
  body text, author_account_id bigint REFERENCES app.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
```

---

## 8. 트리거 · 함수

```sql
-- (1) updated_at 자동(신선도 원천) — 편집 테이블 전부에 부착
CREATE OR REPLACE FUNCTION app.set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$ LANGUAGE plpgsql;
CREATE TRIGGER t_upd BEFORE UPDATE ON app.listings FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER t_upd BEFORE UPDATE ON app.overlays FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
-- (floor_rents·ad_prices·memos 등 동일)

-- (2) 크레딧 원장 → 잔액 캐시(AFTER INSERT)
CREATE OR REPLACE FUNCTION app.apply_credit_entry() RETURNS trigger AS $$
BEGIN
  INSERT INTO app.credit_balances(account_id, bucket, amount)
  VALUES (NEW.account_id, NEW.bucket, NEW.amount)
  ON CONFLICT (account_id, bucket)
  DO UPDATE SET amount = app.credit_balances.amount + NEW.amount;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER t_credit AFTER INSERT ON app.credit_entries
  FOR EACH ROW EXECUTE FUNCTION app.apply_credit_entry();

-- (3) 크레딧 차감(트랜잭션 내): 소멸 임박 버킷부터(monthly→earned→purchased)
CREATE OR REPLACE FUNCTION app.deduct_credit(p_acct bigint, p_amount int, p_ref bigint) RETURNS void AS $$
DECLARE remain int := p_amount; b app.credit_bucket; avail int;
BEGIN
  FOREACH b IN ARRAY ARRAY['monthly','earned','purchased']::app.credit_bucket[] LOOP
    EXIT WHEN remain <= 0;
    SELECT amount INTO avail FROM app.credit_balances WHERE account_id=p_acct AND bucket=b;
    IF COALESCE(avail,0) > 0 THEN
      DECLARE take int := LEAST(avail, remain);
      BEGIN
        INSERT INTO app.credit_entries(account_id,type,bucket,amount,reason,ref_type,ref_id)
        VALUES (p_acct,'spend',b,-take,'report',NULL,p_ref);
        remain := remain - take;
      END;
    END IF;
  END LOOP;
  -- 베타(P2): remain>0이어도 예외 안 냄 → 마지막 버킷 음수 기록(그림자 계량)
  IF remain > 0 THEN
    INSERT INTO app.credit_entries(account_id,type,bucket,amount,reason,ref_type,ref_id)
    VALUES (p_acct,'spend','monthly',-remain,'report(overdraft)',NULL,p_ref);
  END IF;
END $$ LANGUAGE plpgsql;

-- (4) 화면값 병합: master + 팀 오버레이 COALESCE (개념 골격)
CREATE OR REPLACE FUNCTION app.building_view(p_pk text, p_team bigint) RETURNS jsonb AS $$
  SELECT to_jsonb(b) || COALESCE(
    (SELECT jsonb_object_agg(o.field, o.value) FROM app.overlays o
      WHERE o.team_id=p_team AND o.target_type='building' AND o.target_id=p_pk), '{}')
  FROM master.buildings b WHERE b.building_pk = p_pk;
$$ LANGUAGE sql STABLE;

-- (5) 영역(폴리곤) 검색 · 주변 comps (PostGIS)
CREATE OR REPLACE FUNCTION app.search_polygon(p_geojson jsonb) RETURNS SETOF master.buildings AS $$
  SELECT b.* FROM master.buildings b
  WHERE ST_Within(b.geom, ST_MakeValid(ST_GeomFromGeoJSON(p_geojson::text)));
$$ LANGUAGE sql STABLE;

-- (6) 신선도 판정: 워터마크·버전 비교(인덱스 조회 1회)
CREATE OR REPLACE FUNCTION app.report_is_stale(p_report bigint) RETURNS boolean AS $$
  SELECT r.master_version <> (SELECT version FROM master.master_version)
      OR r.source_watermark < app.building_watermark(r.building_pk, r.account_id)
  FROM app.reports r WHERE r.id = p_report;
$$ LANGUAGE sql STABLE;
-- app.building_watermark = max(updated_at) of 그 건물 팀 오버레이·층별임대·listings·curation
```

---

## 9. 인덱스 요약
| 목적 | 인덱스 |
|---|---|
| 공간(영역·반경) | `gist(geom)` master.buildings·parcels |
| 자동완성 | `text_pattern_ops`(접두) + `gin_trgm`(유사도) on addr |
| 선점 배타 | `unique(building_pk,team_id) where assignee is not null` |
| 오버레이 | `unique(team_id,target_type,target_id,field)` |
| 사적 조회 | `(building_pk)` on floor_rents·ad_prices, `(account_id,created_at)` reports·credit |
| 대표 유일 | `unique(team_id) where role='owner' and left_at is null` |

---

## 10. 열린 항목 (schema-app §8 + 추가)
- 업무 필드 enum류(`status·grade·ipji…`)를 `ref.enums` 코드로 강제할지(현재 text) — 레지스트리 확장.
- `app.building_watermark` 실제 구현(오버레이·층별임대·listings·curation의 max(updated_at) 조인).
- 오버레이 `value` 타입 검증 위치 = 트리거(schema-ref §4)로 일원화 확정.
- master 뷰 스왑 시 뷰 의존(함수 STABLE) 재컴파일 영향 점검.
