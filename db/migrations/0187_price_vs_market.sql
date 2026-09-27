-- 시세대비(2026-09-27 대표) — 중개사가 보는 이 매물 가격의 시세 대비. 저렴 · 적정 · 비쌈 하나. null=미지정.
-- 사람이 매기는 값이다. 적정가(추정)와 매매가를 나눠 자동으로 채우지 않는다.

BEGIN;

ALTER TABLE app.listings ADD COLUMN IF NOT EXISTS price_vs_market text;

INSERT INTO ref.enum_groups(enum_key, label) VALUES ('price_vs_market', '시세대비') ON CONFLICT DO NOTHING;
INSERT INTO ref.enums(enum_key, code, label, sort_order) VALUES
  ('price_vs_market', '저렴', '저렴', 10), ('price_vs_market', '적정', '적정', 20), ('price_vs_market', '비쌈', '비쌈', 30)
ON CONFLICT DO NOTHING;

COMMIT;
