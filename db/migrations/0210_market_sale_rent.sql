-- 0210 매매시세 · 임대시세 (2026-10-03)
--
-- 「시장 호가」를 둘로 가른다. 시세는 우리 광고가 아니라 시장에 나와 있는 사실이다 — 지도에서 실거래처럼 켜고 끈다.
-- 사실만 담는다: 가격 · 면적 · 층 · 날짜 · 올린 사무소. 제목 · 설명 · 사진 · 원문 링크는 두지 않는다(0191 결정).
-- 같은 광고는 한 줄 — (source, source_id) 가 같으면 다시 봐도 last_seen 만 갱신한다.
-- 사라지면 지우지 않고 gone_on 을 찍는다. 「끝까지 다 돈 수집」에서만 찍는다(중간에 멈춘 수집은 없어짐 판정 안 함).
-- 옛 crawl_listing(날짜 · 출처 번호 없음)은 새 수집이 차면 지운다 — 이 마이그레이션에선 그대로 둔다.
BEGIN;

-- 수집 회차 — 무엇을 언제 어디까지 받았나. ok = 끝까지 다 돌았다
CREATE TABLE master.market_run (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('매매','임대')),
  source      text NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ok          boolean NOT NULL DEFAULT false,
  n_seen      int);

-- 매매시세 — 건물 통매매 호가
CREATE TABLE master.market_sale (
  id            bigserial PRIMARY KEY,
  source        text NOT NULL,                 -- 수집한 곳(화면에 안 낸다)
  source_id     text NOT NULL,                 -- 그곳의 광고 번호 — 같은 광고 묶기 열쇠
  building_pk   text,                          -- 주소로 붙인 건물. 못 붙이면 null
  pnu           text,
  lng           double precision,
  lat           double precision,
  addr          text,                          -- 붙일 때 쓴 지번 주소
  use_type      text,                          -- 광고의 매물 종류(건물 · 상가주택 …) 원문 그대로
  price         bigint,                        -- 매매 호가(원)
  land_area     numeric,                       -- 광고에 적힌 대지 · 연면적(㎡). 대장과 다를 수 있어 따로 둔다
  total_area    numeric,
  floors_note   text,                          -- 광고에 적힌 층 규모 원문(「B1/5」)
  office_name   text,                          -- 올린 중개사무소
  agent_name    text,
  reg_no        text,                          -- 중개사무소 등록번호 — 가입 중개사의 「다른 곳에 올린 매물」 찾기
  phone         text,
  confirmed_on  date,                          -- 그곳의 확인일자(올린 날)
  first_seen    date NOT NULL,
  last_seen     date NOT NULL,
  gone_on       date,                          -- 끝까지 다 돈 수집에서 안 보인 첫날
  UNIQUE (source, source_id));
CREATE INDEX market_sale_bpk ON master.market_sale(building_pk);
CREATE INDEX market_sale_live ON master.market_sale(lng, lat) WHERE gone_on IS NULL;

-- 임대시세 — 층 · 호실 단위 임대 호가
CREATE TABLE master.market_rent (
  id            bigserial PRIMARY KEY,
  source        text NOT NULL,
  source_id     text NOT NULL,
  building_pk   text,
  pnu           text,
  lng           double precision,
  lat           double precision,
  addr          text,
  use_type      text,                          -- 상가 · 사무실 … 원문 그대로
  floor         text,                          -- 우리 층 이름(「3층」 · 「지하1층」). 못 읽으면 null
  floor_note    text,                          -- 원문(「3/15」 · 「B1/5」 · 「저/7」)
  contract_area numeric,                       -- 계약면적(㎡) — 평당가의 분모
  excl_area     numeric,                       -- 전용면적(㎡)
  deposit       bigint,                        -- 보증금(원)
  rent          bigint,                        -- 월세(원)
  mgmt          bigint,                        -- 관리비(원). 모르면 null
  office_name   text,
  agent_name    text,
  reg_no        text,
  phone         text,
  confirmed_on  date,
  first_seen    date NOT NULL,
  last_seen     date NOT NULL,
  gone_on       date,
  UNIQUE (source, source_id));
CREATE INDEX market_rent_bpk ON master.market_rent(building_pk);
CREATE INDEX market_rent_live ON master.market_rent(lng, lat) WHERE gone_on IS NULL;

COMMIT;
