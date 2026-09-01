-- 공동주택가격에 seq 추가 — 같은 (호실,연도)에 값이 둘 온다(2026-09-01).
--
-- 0150 은 (unit_pk, year) 를 PK 로 잡았는데 원본이 그 조합을 두 번 준다.
-- 실측(서울 2,971만 행): 값이 같은 중복 1,770,506 · **값이 다른 중복 693**.
--
-- 값이 같은 것은 원본 잡음이라 빌더가 하나만 남긴다.
-- **값이 다른 693건은 남긴다** — 어느 쪽이 맞는지 우리가 모르므로 고르면 지어내는 것이 된다.
-- seq 로 갈라 두고, 읽는 쪽이 seq=0 만 보면 하나만, 다 보면 둘 다 본다.

BEGIN;

DROP VIEW IF EXISTS master.apt_price;
DROP TABLE IF EXISTS master.apt_price_v1;
DROP TABLE IF EXISTS master.apt_price_v2;

CREATE TABLE master.apt_price_v1 (
  unit_pk   text NOT NULL,          -- 전유부 PK. master.building_unit 과 같은 계열
  year      smallint NOT NULL,
  seq       smallint NOT NULL DEFAULT 0,  -- 0=대표. 1 이상은 원본이 준 다른 값
  price     bigint,                 -- 원. 0 은 '고시 안 됨'이지 결측이 아니다
  PRIMARY KEY (unit_pk, year, seq)
);
CREATE INDEX apt_price_year_idx ON master.apt_price_v1 (year);

CREATE OR REPLACE VIEW master.apt_price AS SELECT * FROM master.apt_price_v1;
COMMENT ON VIEW master.apt_price IS
  '공동주택 공시가격 2008~2026. 보통은 seq=0 만 보면 된다 — 1 이상은 원본이 값을 둘 준 693건.';
COMMENT ON COLUMN master.apt_price_v1.seq IS
  '같은 (호실,연도)에 값이 다르게 두 번 올 때 가른다. 어느 쪽이 맞는지 몰라 둘 다 싣는다.';

COMMIT;
