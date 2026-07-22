-- 0012_land_enums.sql — 토지 계열 편집 enum 등록 + 미지정 (enums.md §D 정정)
-- 배경: 지형형상·도로접면·지세·지목은 공공코드라 "표시 전용"으로 취급돼 ref.enums/ref.fields에
--       미등록 → 오버레이 정책(좌표·pnu 외 전부 편집 가능)상 편집 드롭다운이 없어 수정 불가.
-- 정정: enum 그룹 등록 + 초기값 "미지정"(값 없음 = 미지정으로 통일). §D "미지정 옵션 안 둠" 뒤집음.
BEGIN;

-- 0) enum 그룹 등록(FK 선행)
INSERT INTO ref.enum_groups (enum_key, label) VALUES
  ('shape','지형형상'), ('road_frontage','도로접면'), ('slope','지세'), ('jimok','지목')
ON CONFLICT (enum_key) DO NOTHING;

-- 1) enum 값 등록 (미지정=맨 앞, sort 5·10·20…)
INSERT INTO ref.enums (enum_key, code, label, sort_order, active)
SELECT g.k, v.code, v.code, (v.ord - 1) * 10 + 5, true
FROM (VALUES
  ('shape',         ARRAY['미지정','정방형','가로장방','세로장방','사다리형','부정형','자루형']),
  ('road_frontage', ARRAY['미지정','광대로한면','광대소각','광대세각','중로한면','중로각지','소로한면','소로각지','세로한면(가)','세로각지(가)','세로한면(불)','세로각지(불)','맹지']),
  ('slope',         ARRAY['미지정','저지','평지','완경사','급경사','고지']),
  ('jimok',         ARRAY['미지정','전','답','과수원','목장용지','임야','광천지','염전','대','공장용지','학교용지','주차장','주유소용지','창고용지','도로','철도용지','제방','하천','구거','유지','양어장','수도용지','공원','체육용지','유원지','종교용지','사적지','묘지','잡종지'])
) g(k, arr)
CROSS JOIN LATERAL unnest(g.arr) WITH ORDINALITY AS v(code, ord)
ON CONFLICT (enum_key, code) DO NOTHING;

-- 2) ref.fields 편집 enum으로 등록(검증·드롭다운 연결)
INSERT INTO ref.fields (field_key, label, data_type, layer, source_ref, enum_key, editable, display_group, active)
VALUES
  ('shape',         '지형형상', 'enum', 'public', 'buildings_v1.shape',         'shape',         true, '토지', true),
  ('road_frontage', '도로접면', 'enum', 'public', 'buildings_v1.road_frontage', 'road_frontage', true, '토지', true),
  ('slope',         '지세',     'enum', 'public', 'buildings_v1.slope',         'slope',         true, '토지', true),
  ('jimok',         '지목',     'enum', 'public', 'buildings_v1.jimok',         'jimok',         true, '토지', true)
ON CONFLICT (field_key) DO UPDATE
  SET data_type = 'enum', enum_key = EXCLUDED.enum_key, editable = true, active = true;

COMMIT;
