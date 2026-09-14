-- 0049 · 매수자 프로필 확장 — 나이대 · 협조도 · 친절도 · 전속계약
--
-- 프로필 앞면이 "어떤 사람인지"를 문장으로 요약하려면 재료가 더 필요하다(2026-08-10).
-- 협조도·친절도는 매도자(업무탭)와 **같은 enum**을 쓴다 — 사람을 평가하는 말이 화면마다 다르면 안 된다.

BEGIN;

ALTER TABLE app.buyers
  ADD COLUMN IF NOT EXISTS age_band    text,   -- 2030 / 4050 / 6070 / 70이상
  ADD COLUMN IF NOT EXISTS cooperation text,   -- 협조도(기존 enum 재사용)
  ADD COLUMN IF NOT EXISTS kindness    text,   -- 친절도(기존 enum 재사용)
  ADD COLUMN IF NOT EXISTS exclusive   text;   -- 전속계약서: 체결/미체결

INSERT INTO ref.enum_groups(enum_key, label) VALUES ('buyer_age', '매수자 나이대')
ON CONFLICT (enum_key) DO NOTHING;
INSERT INTO ref.enums(enum_key, code, label, sort_order, active) VALUES
  ('buyer_age', '미지정', '미지정', 0, true),
  ('buyer_age', '2030', '20·30대', 1, true),
  ('buyer_age', '4050', '40·50대', 2, true),
  ('buyer_age', '6070', '60·70대', 3, true),
  ('buyer_age', '70이상', '70대 이상', 4, true)
ON CONFLICT (enum_key, code) DO NOTHING;

INSERT INTO ref.enum_groups(enum_key, label) VALUES ('buyer_exclusive', '전속계약서')
ON CONFLICT (enum_key) DO NOTHING;
INSERT INTO ref.enums(enum_key, code, label, sort_order, active) VALUES
  ('buyer_exclusive', '미지정', '미지정', 0, true),
  ('buyer_exclusive', '체결', '체결', 1, true),
  ('buyer_exclusive', '미체결', '미체결', 2, true)
ON CONFLICT (enum_key, code) DO NOTHING;

COMMIT;
