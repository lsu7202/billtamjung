-- 0016_series_points.sql — 시세 시계열 팀 오버레이(공시지가·실거래·광고)
-- 배경: 광고=커뮤니티(집단지성)였으나 "다른 값처럼 마스터 위 팀 전용 오버레이"로 통일.
--       실거래·공시지가도 팀이 시점 추가·수정 가능해야 함. 마스터 점은 불변, 팀 오버레이가 override/추가.
-- 값(y)=원 단위(카드 표시단위). x=시점 문자열(YYYY | YYYY/MM | YYYY-MM-DD). kind별.
BEGIN;

CREATE TABLE IF NOT EXISTS app.series_points (
  id          bigserial PRIMARY KEY,
  team_id     bigint NOT NULL,
  building_pk text   NOT NULL,
  kind        text   NOT NULL CHECK (kind IN ('gongsi','real','ad')),
  x           text   NOT NULL,               -- 시점
  y           bigint NOT NULL,               -- 값(원)
  updated_by  bigint,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, building_pk, kind, x)
);
CREATE INDEX IF NOT EXISTS series_points_lookup ON app.series_points (team_id, building_pk, kind);

COMMIT;
