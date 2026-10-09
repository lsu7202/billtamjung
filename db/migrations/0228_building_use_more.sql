-- 0228 · 소분류(building_use)에 리모델링용 · 사옥용을 더한다(10-06 대표 · 종로구 매물 엑셀 가져오기)
-- 엑셀 「건물용도」에 신축용 · 리모델링용 · 사옥용이 섞여 있었다. 소분류는 여럿 고를 수 있다(배열).
BEGIN;
INSERT INTO ref.enums(enum_key, code, label, sort_order, active) VALUES
  ('building_use', '리모델링용', '리모델링용', 50, true),
  ('building_use', '사옥용',     '사옥용',     60, true)
ON CONFLICT DO NOTHING;
COMMIT;
