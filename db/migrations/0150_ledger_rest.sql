-- 대장 나머지 세 마트 — 기본개요·오수정화·공동주택가격(2026-09-01).
--
-- 받아만 두고 안 쓰던 마트를 표로 만든다. 원본을 우리 판단으로 버리지 않는다는 원칙에 따라
-- 대장이 준 55장을 전부 실을 때까지 간다.

BEGIN;

-- ── 기본개요 : 대장 세 층을 잇는 뼈대 ─────────────────────────
-- 총괄표제부·표제부·전유부가 각각 한 줄씩 있고 parent_pk 로 위층을 가리킨다.
-- 지금은 세 층을 PNU 로 어림잡아 잇는데, 한 필지에 단지가 여럿이면 못 가른다.
-- 실측: 4,387,953행 중 상위PK 가 88.2% 에 있다.
CREATE TABLE IF NOT EXISTS master.ledger_basic_v1 (
  building_pk   text PRIMARY KEY,
  parent_pk     text,                  -- 관리상위건축물대장PK — 세 층을 잇는 열쇠
  pnu           text,
  ledger_kind   text,                  -- 일반 | 집합
  ledger_type   text,                  -- 일반건축물 | 총괄표제부 | 표제부 | 전유부
  addr          text,
  road_addr     text,
  bldg_name     text,
  sgg_code      text,
  bjd_code      text,
  extra_parcels int,
  zone_code     text,  zone_name     text,
  district_code text,  district_name text,
  area_code     text,  area_name     text,
  created_ymd   date,
  updated       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_basic_parent_idx ON master.ledger_basic_v1 (parent_pk);
CREATE INDEX IF NOT EXISTS ledger_basic_pnu_idx    ON master.ledger_basic_v1 (pnu);
CREATE INDEX IF NOT EXISTS ledger_basic_type_idx   ON master.ledger_basic_v1 (ledger_type);
CREATE OR REPLACE VIEW master.ledger_basic AS SELECT * FROM master.ledger_basic_v1;
COMMENT ON COLUMN master.ledger_basic_v1.parent_pk IS
  '위층 대장 PK. 전유부→표제부→총괄표제부 로 올라간다. 88.2% 에 있다.';

-- ── 오수정화 : 용도변경 가능 규모를 가른다 ────────────────────
-- 근생을 음식점으로 바꾸려면 오수 발생량이 늘어 정화조 증설이 필요할 수 있다.
-- 용량이 두 단위(인용·루베)로 오는데 **합치지 않는다** — 환산하려면 용도별 오수
-- 원단위를 알아야 하고, 그건 우리가 지어낼 값이 아니다.
CREATE TABLE IF NOT EXISTS master.building_septic_v1 (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  building_pk   text NOT NULL,         -- 한 건물에 두 줄 이상 있을 수 있다(실측 5,373건)
  pnu           text,
  addr          text,
  road_addr     text,
  bldg_name     text,
  sgg_code      text,
  bjd_code      text,
  form_code     text,
  form          text,                  -- 부패탱크방법 · 접촉폭기방법 …
  form_name     text,
  unit_kind     text,                  -- 인용 | 루베
  cap_person    numeric,               -- 용량(인용) — 사람 수 기준
  cap_m3        numeric,               -- 용량(루베) — 부피 기준
  created_ymd   date,
  updated       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS building_septic_pk_idx  ON master.building_septic_v1 (building_pk);
CREATE INDEX IF NOT EXISTS building_septic_pnu_idx ON master.building_septic_v1 (pnu);
CREATE OR REPLACE VIEW master.building_septic AS SELECT * FROM master.building_septic_v1;
COMMENT ON COLUMN master.building_septic_v1.cap_person IS
  '용량(인용). cap_m3 와 합치지 말 것 — 환산에는 용도별 오수 원단위가 필요하다.';

-- ── 공동주택가격 : 호실·연도별 공시가격 2008~2026 ─────────────
-- 2,971만 행. 주소·건물명은 master.building_unit 에 이미 있으므로 여기엔 싣지 않는다 —
-- 같은 값을 두 번 저장하면 6GB 가 12GB 가 된다.
CREATE TABLE IF NOT EXISTS master.apt_price_v1 (
  unit_pk       text NOT NULL,         -- 전유부 PK. master.building_unit 과 같은 계열
  year          smallint NOT NULL,
  price         bigint,                -- 원. 0 은 '고시 안 됨'이지 결측이 아니다
  PRIMARY KEY (unit_pk, year)
);
CREATE INDEX IF NOT EXISTS apt_price_year_idx ON master.apt_price_v1 (year);
CREATE OR REPLACE VIEW master.apt_price AS SELECT * FROM master.apt_price_v1;
COMMENT ON VIEW master.apt_price IS
  '공동주택 공시가격 2008~2026. unit_pk 로 master.building_unit 과 잇는다.';

COMMIT;
