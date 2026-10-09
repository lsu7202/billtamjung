-- 0212 매매시세 · 임대시세를 「수집한 날 하나에 한 줄」로 (2026-10-04 대표)
--
-- 0210 은 광고 한 건이 한 줄이었다. 같은 건물 · 같은 공간을 여러 중개사가 올린 광고는 노이즈다 —
-- 그날 가장 싼 값 하나만 남긴다. 다시 수집하면 새 날짜 줄이 쌓여 시계열이 된다.
-- 광고 단위 칸(광고 번호 · 사무소 · 좌표)은 표에 두지 않는다 — 원문은 data/raw/_market/{날짜}/ 에 그대로 있다.
-- 사라진 날 칸도 없다: 그날 줄이 없으면 그날은 안 나와 있었다. 수집이 끝까지 돌았는지는 market_run 이 답한다.
-- 0210 표는 원문에서 다시 적재한다(scripts/market/load_market.py).
BEGIN;

DROP TABLE master.market_sale;
DROP TABLE master.market_rent;

-- 매매시세 — 건물 × 수집일. 통매매만(구분 매물 「2/6」 같은 층 지정은 적재에서 뺀다)
CREATE TABLE master.market_sale (
  building_pk  text NOT NULL,
  observed_on  date NOT NULL,                  -- 우리가 수집한 날 — 시계열의 키
  price        bigint NOT NULL,                -- 그날 그 건물 광고 중 가장 싼 매매가(원)
  posted_on    date,                           -- 그 광고의 확인일
  n_ads        int NOT NULL,                   -- 그날 같은 건물 광고 수
  land_area    numeric,                        -- 그 광고에 적힌 대지 · 연면적(㎡)
  total_area   numeric,
  use_type     text,                           -- 그 광고의 매물 종류(빌딩 · 상가주택 …)
  PRIMARY KEY (building_pk, observed_on));

-- 임대시세 — 건물 × 공간 × 수집일. 같은 층 · 같은 면적(㎡ 정수)이면 같은 공간
CREATE TABLE master.market_rent (
  id            bigserial PRIMARY KEY,
  building_pk   text NOT NULL,
  floor         text,                          -- 우리 층 이름(「3층」 · 「지하1층」). 모르면 null
  area_key      int NOT NULL,                  -- 계약면적 ㎡ 반올림 — 같은 공간 묶기 열쇠(129.9 와 129.93 은 같은 공간)
  observed_on   date NOT NULL,
  contract_area numeric NOT NULL,              -- 고른 광고의 계약면적(㎡)
  excl_area     numeric,
  deposit       bigint,                        -- 그 공간 광고 중 월세가 가장 싼 것의 보증금 · 월세(원)
  rent          bigint,                        -- 전세면 0
  posted_on     date,
  n_ads         int NOT NULL,
  use_type      text);                         -- 상가 · 사무실
CREATE UNIQUE INDEX market_rent_space_day ON master.market_rent(building_pk, COALESCE(floor, ''), area_key, observed_on);
CREATE INDEX market_rent_day ON master.market_rent(observed_on, building_pk);

COMMIT;
