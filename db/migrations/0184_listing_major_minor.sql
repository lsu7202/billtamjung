-- 대분류·소분류를 부기사와 같게(2026-09-26 대표)
--
--   대분류 building_major — 통사옥 · 상가주택 · 기타. 하나만 고른다. null=미지정
--   소분류 building_use   — 실사용 · 투자용 · 신축용. 여럿 고른다(0182 배열 그대로).
--     옛 값(수익률·신축용·사옥용·리모델링용)은 채운 매물이 0건이라 옮길 것이 없다.

BEGIN;

ALTER TABLE app.listings ADD COLUMN IF NOT EXISTS building_major text;

INSERT INTO ref.enum_groups(enum_key, label) VALUES ('building_major', '대분류') ON CONFLICT DO NOTHING;
UPDATE ref.enum_groups SET label = '소분류' WHERE enum_key = 'building_use';
INSERT INTO ref.enums(enum_key, code, label, sort_order) VALUES
  ('building_major', '통사옥', '통사옥', 10), ('building_major', '상가주택', '상가주택', 20),
  ('building_major', '기타', '기타', 30)
ON CONFLICT DO NOTHING;

UPDATE app.listings SET building_use = NULL
 WHERE building_use IS NOT NULL AND NOT building_use <@ ARRAY['실사용', '투자용', '신축용'];
DELETE FROM ref.enums WHERE enum_key = 'building_use' AND code <> '미지정';
INSERT INTO ref.enums(enum_key, code, label, sort_order) VALUES
  ('building_use', '실사용', '실사용', 20), ('building_use', '투자용', '투자용', 30),
  ('building_use', '신축용', '신축용', 40);

COMMIT;
