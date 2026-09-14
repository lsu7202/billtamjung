-- 0033 도로폭 마스터 — 도로명주소 도로구간(ROAD_BT 폭원)
--
-- 원천: V-World 「도로명주소 도로구간」 https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=MK&dsId=30055
-- 대장의 road_frontage는 '광대로한면·소로각지' 같은 분류 코드라 실제 폭(m)이 없다.
-- 연속지적도의 도로 필지로 계산해봤으나 도로가 잘게 쪼개져 있어 대로변에서 크게 빗나갔다
-- (노량진동 54-8: 실제 25m → 추정 9.3m). 도로명주소 도로구간에는 실측 폭원이 들어 있다.
CREATE TABLE IF NOT EXISTS master.road_segment (
  id      bigserial PRIMARY KEY,
  rn_cd   text,                       -- 도로명코드
  rn      text,                       -- 도로명
  road_bt numeric,                    -- 폭원(m)  ← 이 값을 쓴다
  road_lt numeric,                    -- 연장(m)
  cls     text,                       -- 도로구분(고속도로·일반국도·시군도…)
  sig_cd  text,                       -- 시군구
  geom    geometry(LineString, 4326)
);
CREATE INDEX IF NOT EXISTS road_segment_gix ON master.road_segment USING GIST (geom);
CREATE INDEX IF NOT EXISTS road_segment_geog_gix ON master.road_segment USING GIST ((geom::geography));

-- 건물별 접도 폭 — 전면/측면/후면.
-- 전면은 추측하지 않는다: road_addr의 도로명과 일치하는 구간이 곧 전면 도로다.
-- (노량진동 54-8 검증: road_addr '장승배기로 170' → 장승배기로 25m = 원본의 전면 25m와 일치)
CREATE TABLE IF NOT EXISTS master.building_road (
  building_pk text PRIMARY KEY,
  front_m  numeric,   -- 전면(도로명주소 도로)
  side_m   numeric,   -- 나머지 접도 중 넓은 것
  rear_m   numeric,   -- 그 다음
  front_rn text,      -- 전면 도로명
  n_roads  int        -- 접한 도로 수
);
