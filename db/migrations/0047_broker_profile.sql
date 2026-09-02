-- 0047 · 중개인 개인화 프로필 (F-23 1단계 — 명시 프로필)
--
-- 「오늘 · 시작해볼 곳」의 조준을 "팀이 가장 많이 다루는 구"(대리값)에서
-- **중개인 본인이 말한 방식**으로 바꾼다: 주 활동 지역 · 일하는 방식(급매↔관계) · 주력 매물.
-- 사람마다 다르므로 계정 단위다(팀 아님). 행동 학습(2단계)은 베타 데이터 쌓인 뒤 —
-- 그때도 이 테이블이 cold start 값으로 남는다.

BEGIN;

CREATE TABLE IF NOT EXISTS app.broker_profile (
  account_id  bigint PRIMARY KEY,
  team_id     bigint NOT NULL,
  regions     text[],        -- 주 활동 구(시군구코드 5자리, 복수)
  style       int,           -- 일하는 방식: 1=급매·회전 / 3=중간 / 5=관계·장기
  price_min   bigint,        -- 주력 가격대(원) — 비우면 제한 없음
  price_max   bigint,
  use_types   text[],        -- 주력 유형: 수익형/신축용/리모델링용
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMIT;
