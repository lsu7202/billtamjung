-- 실거래 원천 표 · 지번 연결 표 (2026-10-08 · 스펙 12 §1)
--
-- 국토부 실거래 여덟 갈래 전부를 원천 한 줄 = 거래 하나로 싣는다. 열쇠는 거래 ID.
-- 주소는 열쇠가 아니라 붙이기 위한 재료다. 못 붙인 거래도 버리지 않는다 — 법정동까지만 안다.
-- 지번에 확실히 붙은 거래만 trade_match 에 한 줄. 붙이는 규칙은 방식마다 다르고, 하나라도 안 맞으면 안 붙인다.
--
-- id 는 원천 값으로 만든다(같은 거래는 다시 받아도 같은 id). 원천에 거래 번호가 없어서다.
-- 똑같은 줄이 두 번 나오면(같은 날 같은 값 두 건) 뒤에 #2 를 붙인다.
--
-- master.sales_history · sales_agg 는 읽는 곳을 옮긴 뒤 지운다(같은 단계, 다음 마이그레이션).

BEGIN;

CREATE TABLE IF NOT EXISTS master.trade (
  id            text PRIMARY KEY,
  kind          text NOT NULL,        -- 아파트 · 연립다세대 · 단독다가구 · 오피스텔 · 분양입주권 · 상업업무용 · 토지 · 공장창고
  bjd_code      text,                 -- 법정동코드 10자리(시군구 이름에서)
  dong_name     text NOT NULL,        -- 원천 시군구 칸 그대로 「서울특별시 종로구 명륜1가」
  jibun_raw     text,                 -- 번지 원문. 통매 · 토지는 가려짐(3**), 호실 단위는 그대로. 모델 뷰엔 안 연다
  road_name     text,
  complex_name  text,                 -- 단지명 · 건물명
  contract_ym   text NOT NULL,
  contract_day  smallint,
  price_won     bigint,
  total_area    numeric,              -- 연면적(통매 · 공장창고)
  excl_area     numeric,              -- 전용면적(호실 단위 · 집합)
  land_area     numeric,              -- 대지면적 · 대지권면적 · 계약면적(토지)
  floor         text,
  bldg_dong     text,                 -- 아파트 동
  build_year    smallint,
  house_type    text,                 -- 단독 · 다가구
  deal_kind     text,                 -- 집합 · 일반(상업업무용 · 공장창고)
  main_use      text,                 -- 건축물주용도
  use_zone      text,
  jimok         text,                 -- 토지
  road_cond     text,
  share         text,                 -- 지분구분
  right_kind    text,                 -- 분양권 · 입주권
  deal_type     text,                 -- 중개거래 · 직거래
  canceled_on   date,                 -- 해제사유발생일. 시세에서 뺀다 · 「매각 의사가 있었던 땅」 신호
  registered_on date,                 -- 등기일자
  buyer         text,
  seller        text,
  broker_area   text,
  src           text                  -- 원천 파일명:줄
);
CREATE INDEX IF NOT EXISTS trade_bjd ON master.trade (bjd_code, contract_ym);
CREATE INDEX IF NOT EXISTS trade_kind ON master.trade (kind, contract_ym);

CREATE TABLE IF NOT EXISTS master.trade_match (
  trade_id text PRIMARY KEY REFERENCES master.trade(id) ON DELETE CASCADE,
  pnu      text NOT NULL,
  method   text NOT NULL            -- 번지그대로(호실 단위 · 집합) · 전부일치(통매) · 토지
);
CREATE INDEX IF NOT EXISTS trade_match_pnu ON master.trade_match (pnu);

COMMENT ON TABLE master.trade IS '국토부 실거래 여덟 갈래 · 원천 한 줄 = 거래 하나 · 열쇠는 거래 id. 못 붙인 거래도 남는다';
COMMENT ON TABLE master.trade_match IS '실거래 → 지번. 방식별 규칙이 다 맞아 확실히 붙은 거래만 한 줄(스펙 12 §1)';

COMMIT;
