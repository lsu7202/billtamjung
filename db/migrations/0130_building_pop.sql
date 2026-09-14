-- 건물 → 생활인구 격자 매칭(2026-08-26). 0129 living_pop 의 짝.
--
-- 실험할 때 손으로 CREATE TABLE 을 쳐서 표가 마이그레이션 밖에 있었다. apply.sh 로
-- 재현이 안 되고 PK 도 없어서, 다른 사람이 이 데이터를 다시 만들 수 없었다.
--
-- 매칭은 공간 조인이 아니라 **나눗셈**이다. 격자가 EPSG:5179 위의 250m 정사각이라
-- 건물 좌표를 250 으로 나누면 어느 칸인지 바로 나온다. 56만 동에 ST_Contains 를 돌리면
-- 몇 분이지만 나눗셈은 한 번 훑기면 끝난다(scripts/seoul_open/match_building_pop.py).
--
-- 값은 living_pop 을 그대로 베낀 것이다. 조회 때마다 조인하지 않는 이유는 건물 상세가
-- 이미 열 몇 번을 조회하고 있어서 — 격자를 거쳐 가는 조인을 하나 더 얹지 않는다.

CREATE TABLE IF NOT EXISTS master.building_pop (
  building_pk text PRIMARY KEY,
  grid        text NOT NULL,          -- master.living_pop(grid)
  day_avg     numeric,                -- 11~21시 평균
  night_avg   numeric,                -- 22~06시 평균
  peak        numeric,
  peak_hour   smallint
);
CREATE INDEX IF NOT EXISTS building_pop_grid_ix ON master.building_pop (grid);

COMMENT ON TABLE master.building_pop IS
  '건물별 생활인구(master.living_pop 격자값 복사). 좌표 나눗셈으로 매칭 — 2026-08-26';

INSERT INTO app.schema_migrations(version) VALUES ('0130_building_pop.sql')
ON CONFLICT DO NOTHING;
