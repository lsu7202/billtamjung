-- 0015_null_synonyms.sql — 결측 동의어 리터럴 → NULL 정규화
-- 배경: 토지특성 명 컬럼이 미지정 필지에 "지정되지않음"을 넣어 저장됨(shape·slope·road_frontage 15만여 건).
--       use_zone엔 "미지정" 리터럴 440건. 이 값들은 enum 목록에 없어 드롭다운이 깨지고, 결측인데 값처럼 보임.
-- 정정: data-overview.md "null=미지정 통일" 원칙 → 리터럴을 NULL로. (맹지·평지 등 진짜 값은 건드리지 않음)
-- ⚠️ 근본 수정은 로더(build_land_master 등)에서 명 컬럼 정규화. 이건 현재 적재분 일괄 클린징.
--
-- master.* 는 마이그레이션이 만드는 표가 아니라 **파이프라인이 적재하는** 표다. 빈 DB로 처음
-- 켜면(docker compose up) 아직 없어서 initdb 가 통째로 죽고 API 도 못 뜬다. 표가 있을 때만 돈다.
BEGIN;

DO $$
BEGIN
  -- parcels_v2 (토지정보 표시 원천)
  IF to_regclass('master.parcels_v2') IS NOT NULL THEN
    UPDATE master.parcels_v2 SET shape         = NULL WHERE shape = '지정되지않음';
    UPDATE master.parcels_v2 SET slope         = NULL WHERE slope = '지정되지않음';
    UPDATE master.parcels_v2 SET road_frontage = NULL WHERE road_frontage = '지정되지않음';
    UPDATE master.parcels_v2 SET use_zone      = NULL WHERE use_zone IN ('미지정','');
    UPDATE master.parcels_v2 SET land_use      = NULL WHERE land_use IN ('미지정','지정되지않음','');
    UPDATE master.parcels_v2 SET jimok         = NULL WHERE jimok IN ('미지정','지정되지않음','');
  END IF;

  -- buildings_v2 (검색·필터용 비정규화 사본)
  IF to_regclass('master.buildings_v2') IS NOT NULL THEN
    UPDATE master.buildings_v2 SET shape         = NULL WHERE shape = '지정되지않음';
    UPDATE master.buildings_v2 SET slope         = NULL WHERE slope = '지정되지않음';
    UPDATE master.buildings_v2 SET road_frontage = NULL WHERE road_frontage = '지정되지않음';
    UPDATE master.buildings_v2 SET use_zone      = NULL WHERE use_zone IN ('미지정','');
    UPDATE master.buildings_v2 SET land_use      = NULL WHERE land_use IN ('미지정','지정되지않음','');
    UPDATE master.buildings_v2 SET jimok         = NULL WHERE jimok IN ('미지정','지정되지않음','');
    UPDATE master.buildings_v2 SET etc_use       = NULL WHERE etc_use = '';
    UPDATE master.buildings_v2 SET structure     = NULL WHERE structure = '';
  END IF;
END $$;

COMMIT;
