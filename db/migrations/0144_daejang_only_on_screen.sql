-- 화면은 건축물대장 그대로 — 계산값은 전부 검색 전용 표로 내린다(2026-08-30).
--
-- 이 데이터는 화면에서 끝나지 않는다. 계약서·중개대상물 확인설명서·브리핑 자료로
-- 그대로 이어진다. 그 서류들이 건축물대장과 어긋나면 그건 우리 잘못이 된다.
-- 그래서 **대장이 비워둔 칸은 화면에서도 빈칸이어야 한다.** 계산해서 채울 수 있어도.
--
-- 지금까지 계산값이 대장값 행세를 하던 곳 다섯:
--   ① 뷰 master.buildings 의 역산 — 건폐율 2,397 · 용적률 191 · 건축면적 74 · 용적산정연면적 25,362 (0135)
--   ② 빌더 build_building_master.py — 건축면적÷대지면적 → 건폐율 79,223
--   ③ 빌더 build_integrated.py — 용적산정연면적÷대지면적 → 용적률 99,385
--   ④·⑤ 일회성 백필 0040·0041 — ②·③과 같은 산식을 이미 표에 박아둠
-- 합쳐서 건폐율 81,620동 · 용적률 99,576동이 대장에 없는 값을 대장값처럼 내보내고 있었다.
--
-- 이 마이그레이션이 하는 일
--   1. buildings_v2 에서 출처가 '대장'이 아닌 bcr·far 를 비운다(출처 표시도 같이)
--   2. 뷰 master.buildings 의 역산 COALESCE 넷을 걷는다 → 뷰는 표를 그대로 통과시킨다
--   3. master.building_calc 에 건축면적·용적산정연면적 칸을 더한다(검색이 이 둘도 거른다)
-- 빌더 ②·③은 코드에서 같이 걷었다. 재빌드해도 계산값이 다시 올라오지 않는다.
--
-- 값이 사라지는 게 아니다. scripts/build_building_calc.py 가 같은 값을 building_calc 로
-- 다시 채우고, search.py 의 필터가 COALESCE(대장, 계산) 으로 읽는다. 검색 결과는 그대로다.

BEGIN;

-- ── 1. 대장이 아닌 값을 표에서 비운다 ─────────────────────────────
UPDATE master.buildings_v2 SET bcr = NULL, bcr_src = NULL
 WHERE bcr_src IS DISTINCT FROM '대장' AND bcr IS NOT NULL;
UPDATE master.buildings_v2 SET far = NULL, far_src = NULL
 WHERE far_src IS DISTINCT FROM '대장' AND far IS NOT NULL;

-- ── 2. 뷰에서 역산을 걷는다 ───────────────────────────────────────
CREATE OR REPLACE VIEW master.buildings AS
 SELECT b.building_pk,
    b.addr,
    b.jibun_norm,
    b.geom,
    b.land_area,
    b.total_area,
    b.floors_above,
    b.floors_below,
    b.bcr,
    b.far,
    b.main_use,
    b.approval_ymd,
    b.road_addr,
    b.pnu,
    b.sgg_code,
    b.bjd_code,
    b.main_use_name,
    b.etc_use,
    b.structure,
    b.remodel_ymd,
    b.jimok,
    b.parcel_area,
    b.land_use,
    b.use_zone,
    b.use_zone_mix,
    b.slope,
    b.shape,
    b.road_frontage,
    b.station_dist,
    b.subway_json,
    b.bus_json,
    b.gongsi_latest,
    b.last_sale_ym,
    b.last_sale_price,
    b.elevator,
    b.parking,
    b.build_area,
    b.far_area,
    b.height,
    b.bcr_src,
    b.far_src
   FROM master.buildings_v2 b
;

-- ── 3. 검색 전용 표에 면적 두 칸 추가 ─────────────────────────────
ALTER TABLE master.building_calc
  ADD COLUMN IF NOT EXISTS build_area_calc numeric,
  ADD COLUMN IF NOT EXISTS far_area_calc   numeric;

COMMENT ON COLUMN master.building_calc.build_area_calc IS
  '대장이 비운 건축면적. 단독 필지에서 대지면적×건폐율. 검색 전용 — 화면·서류에 내지 않는다.';
COMMENT ON COLUMN master.building_calc.far_area_calc IS
  '대장이 비운 용적률산정용연면적. 단독 필지에서 대지면적×용적률. 검색 전용.';

COMMIT;
