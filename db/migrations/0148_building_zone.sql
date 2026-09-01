-- 건물별 지역·지구·구역 표 신설(2026-09-01).
--
-- 건축물대장이 건물마다 붙여 주는 용도지역·용도지구·용도구역. 원본은 한 건물이
-- 여러 줄(지역 1 + 지구 n + 구역 n)로 오고, 건물 1행으로 접었다 — 735,594행 → 386,057동.
--
-- **왜 따로 두나.** 지금 이 정보를 토지이용계획(LURIS)에서도 받는다. 그건 **필지** 기준이고
-- 이건 **건물** 기준이다. 둘이 어긋날 때 어느 쪽이 맞는지 보려면 양쪽을 다 갖고 있어야 한다.
-- 대장이 자기 건물에 대해 뭐라 적어 뒀는지는 대장에게 물어야 한다.
--
-- **대표값과 전체 목록을 함께 둔다.** 대표만 남기면 「자연경관지구이면서 최고고도지구」인
-- 건물의 절반이 사라진다. 실측: 지역이 둘 이상인 건물 82,643동 · 지구 34,999 · 구역 8,737.
--
-- 자리: data/tools/build_zone.py · pipeline/export_zone.py

BEGIN;

CREATE TABLE IF NOT EXISTS master.building_zone_v1 (
  building_pk   text PRIMARY KEY,      -- 표제부 관리PK
  pnu           text,
  addr          text,
  road_addr     text,
  sgg_code      text,
  bjd_code      text,
  use_zone      text,                  -- 대표 용도지역 — 99.7% 에 있다
  use_district  text,                  -- 대표 용도지구 — 39.8%
  use_area      text,                  -- 대표 용도구역 — 12.9%
  zones         text[],                -- 용도지역 전체. 둘 이상인 건물 82,643동
  districts     text[],                -- 용도지구 전체
  areas         text[],                -- 용도구역 전체
  created_ymd   date,
  updated       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS building_zone_pnu_idx   ON master.building_zone_v1 (pnu);
-- 「제2종일반주거지역 건물만」 같은 조회
CREATE INDEX IF NOT EXISTS building_zone_zone_idx  ON master.building_zone_v1 (use_zone);
-- 배열 안을 뒤지는 조회(지구·구역은 대표만으로 부족하다)
CREATE INDEX IF NOT EXISTS building_zone_dist_gin  ON master.building_zone_v1 USING gin (districts);

CREATE OR REPLACE VIEW master.building_zone AS SELECT * FROM master.building_zone_v1;

COMMENT ON VIEW master.building_zone IS
  '건축물대장 지역지구구역(건물 기준). 토지이용계획(필지 기준)과 다른 출처다 — 섞지 않는다.';
COMMENT ON COLUMN master.building_zone_v1.zones IS
  '용도지역 전체. 대표(use_zone)만 보면 경계에 걸친 건물의 나머지가 사라진다.';

COMMIT;
