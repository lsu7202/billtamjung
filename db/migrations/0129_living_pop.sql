-- 서울 생활인구(250m 격자) — 유동인구를 진짜 값으로(2026-08-26).
--
-- 지금 float_pop 은 (도로접면 점수 + 역거리 점수) ÷ 2 를 5등급으로 자른 값이다
-- (value_score.float_pop_score, route B). 이름만 유동인구고 실제는 접근성이다.
-- NICE 전건물 확보가 안 돼서 대신 쓰던 것인데, 서울시가 KT 통신데이터로 만든
-- 생활인구를 250m 격자로 매일 공개한다 — 공공누리 1유형(출처표시·상업이용·변경 가능).
--
-- 원본: [내국인] 서울 생활인구(250m) · OA-22784 · 서울특별시
--   일자 · 시간(00~23) · 행정동코드 · 250M격자 · 생활인구합계 · 성연령 30칸
--   격자 ID = 국가지점번호. 서울 전역이 「다사」 하나이고, 뒤 8자리가 그 100km 구역 안
--   좌표(10m 단위)다. 원점은 EPSG:5179 의 (900000, 1900000) — 서울 건물 범위로 역산해
--   격자 다사52255325 → 종로구 무악동으로 검증했다.
--
-- 하루 25만 행이라 원본을 그대로 쌓지 않는다. **최근 한 주를 시간대별로 평균**해
-- 격자당 한 줄로 접는다(8,558줄). 요일 편차가 있어 최소 7일은 봐야 한다.

CREATE TABLE IF NOT EXISTS master.living_pop (
  grid        text PRIMARY KEY,          -- 국가지점번호 250m 격자(예: 다사52255325)
  geom        geometry(Point, 4326),     -- 격자 중심
  dong_code   text,                      -- 행정동코드(법정동과 다르다)
  -- 시간대별 평균 24칸. 대부분은 아래 파생값만 쓰지만, 원본을 접을 때 버리지 않는다
  hourly      numeric[],
  day_avg     numeric,                   -- 11~21시 평균 — 상업 유동에 가장 가깝다
  night_avg   numeric,                   -- 22~06시 평균 — 주거 성격을 가른다
  peak        numeric,                   -- 24시간 중 최대
  peak_hour   smallint,
  days        smallint,                  -- 평균에 쓴 날 수
  from_date   date,
  to_date     date
);
CREATE INDEX IF NOT EXISTS living_pop_geom_gix ON master.living_pop USING GIST (geom);
CREATE INDEX IF NOT EXISTS living_pop_dong_ix ON master.living_pop (dong_code);

COMMENT ON TABLE master.living_pop IS
  '서울 생활인구 250m 격자(서울특별시, 공공누리 1유형). day_avg=11~21시 평균 — 상업 유동 대용';

INSERT INTO app.schema_migrations(version) VALUES ('0129_living_pop.sql')
ON CONFLICT DO NOTHING;
