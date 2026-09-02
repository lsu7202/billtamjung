-- 0050 · 매수자 성별 — 프로필 요약 문장의 재료(0049 나이대와 같은 목적)

BEGIN;

ALTER TABLE app.buyers ADD COLUMN IF NOT EXISTS gender text;   -- 남/여

INSERT INTO ref.enum_groups(enum_key, label) VALUES ('buyer_gender', '매수자 성별')
ON CONFLICT (enum_key) DO NOTHING;
INSERT INTO ref.enums(enum_key, code, label, sort_order, active) VALUES
  ('buyer_gender', '미지정', '미지정', 0, true),
  ('buyer_gender', '남', '남성', 1, true),
  ('buyer_gender', '여', '여성', 2, true)
ON CONFLICT (enum_key, code) DO NOTHING;

COMMIT;
