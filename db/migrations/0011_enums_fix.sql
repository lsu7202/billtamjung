-- 0011_enums_fix.sql — enum 정본 정합(enums.md 기준) + 누락 마스터 컬럼 + F-17 시드 정정
-- 근거: enums.md §A·§B·§E · formulas.md:202 · 정합감사 2026-07-22 P1/P2
-- 결정: enum 저장값 = 한글 라벨(마스터가 한글로 저장 → 코드↔라벨 이중화 제거, 일관).
BEGIN;

-- ── 1) 상세정보·업무·상태 enum 재정의(값=라벨) ────────────────────
-- 기존 표본 값 제거 후 정본 재적재
DELETE FROM ref.enums WHERE enum_key IN
 ('grade','ipji','meongdo','nohudo','use_change','myeolsil','owner_type','jindo',
  'urgency','relation','cooperation','kindness','intent','vacancy','float_pop','building_use');

INSERT INTO ref.enum_groups(enum_key,label,two_tier) VALUES
 ('urgency','긴급도',false),('relation','관계',false),('cooperation','협조도',false),
 ('kindness','친절도',false),('intent','매수의향서',false),('vacancy','공실상태',false),
 ('float_pop','유동인구',false),('building_use','건물용도',false),('nohudo','노후도',false)
ON CONFLICT (enum_key) DO NOTHING;

-- 값=코드=라벨 일괄 삽입 헬퍼(문자열 배열)
DO $$
DECLARE g text; vals text[]; v text; i int;
DECLARE spec jsonb := '{
  "meongdo":     ["미지정","완료","가능","불가","일부","조건부"],
  "ipji":        ["미지정","매우좋음","좋음","나쁨","매우나쁨"],
  "grade":       ["미지정","매우좋음","좋음","나쁨","매우나쁨"],
  "building_use":["미지정","수익률","신축용","사옥용","리모델링용"],
  "use_change":  ["미지정","나대지(주차장)","근생","상가주택","다가구주택","다세대주택","가능","불가","협의가능","조건부"],
  "myeolsil":    ["미지정","불가","협조가능","잔금전멸실","나대지(주차장)","협의가능","조건부"],
  "nohudo":      ["미지정","양호","보통","노후"],
  "jindo":       ["미지정","준비중","진행중","철회","가격제시","매각"],
  "urgency":     ["미지정","매우급함","급함","보통","여유","안팔아도됨"],
  "owner_type":  ["미지정","개인","법인"],
  "relation":    ["미지정","건물주/법인대표","관리자","친인척","부동산","기타"],
  "cooperation": ["미지정","협조적","보통","비협조적"],
  "kindness":    ["미지정","친절","보통","불친절"],
  "intent":      ["미지정","원함","원치않음"],
  "vacancy":     ["공실","임대중","미지정"],
  "float_pop":   ["미지정","매우높음","높음","보통","낮음","매우낮음"]
}'::jsonb;
BEGIN
  FOR g IN SELECT jsonb_object_keys(spec) LOOP
    vals := ARRAY(SELECT jsonb_array_elements_text(spec->g));
    i := 0;
    FOREACH v IN ARRAY vals LOOP
      i := i + 10;
      INSERT INTO ref.enums(enum_key,code,label,sort_order) VALUES (g, v, v, i)
      ON CONFLICT (enum_key,code) DO UPDATE SET label=EXCLUDED.label, sort_order=EXCLUDED.sort_order;
    END LOOP;
  END LOOP;
END $$;

-- ── 2) ref.fields 정정 ────────────────────────────────────────────
-- float_pop = enum(6값), 상세정보 enum 필드 enum_key 갱신, use_zone 등 공공 land = text(걸침 병기 허용)
UPDATE ref.fields SET data_type='enum', enum_key='float_pop' WHERE field_key='float_pop';
UPDATE ref.fields SET enum_key='nohudo' WHERE field_key='nohudo';
INSERT INTO ref.fields(field_key,label,data_type,layer,target,enum_key,editable,searchable,display_group,display_order) VALUES
 ('building_use','건물용도','enum','private','building','building_use',true,true,'detail',70)
ON CONFLICT (field_key) DO NOTHING;
-- 공공 토지 필드는 걸침 병기(예 "일반상업 60%+제3종주거 40%") 가능 → enum 검증 안 함(text)
UPDATE ref.fields SET data_type='text', enum_key=NULL WHERE field_key IN ('use_zone');

-- 옛 코드로 저장된 상세정보 오버레이 제거(값=라벨로 재입력 유도)
DELETE FROM app.overlays WHERE field IN ('grade','ipji','meongdo','nohudo','use_change','myeolsil');

-- ── 3) F-16 입력용 누락 마스터 컬럼(엘리베이터·주차·건축면적·용적산정연면적) ──
ALTER TABLE master.buildings_v1
  ADD COLUMN IF NOT EXISTS elevator     int,     -- 승용승강기(대)
  ADD COLUMN IF NOT EXISTS parking      int,     -- 주차(대)
  ADD COLUMN IF NOT EXISTS build_area   numeric, -- 건축면적(㎡)
  ADD COLUMN IF NOT EXISTS far_area     numeric; -- 용적률산정연면적(㎡)
CREATE OR REPLACE VIEW master.buildings AS SELECT * FROM master.buildings_v1;

-- ── 4) F-17 시점보정표 시드 정정(formulas.md:202 = 연도별 %) ──────
UPDATE ref.formula_params
  SET value_json = '{"2021":0.0,"2022":0.03,"2023":0.09,"2024":0.06,"2025":0.03,"2026":0.0}'
  WHERE formula_id='F-17' AND param_key='time_adjust';

COMMIT;
