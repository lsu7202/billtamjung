-- 0213 고객관리 = 문의 관리 (S09, 2026-10-04 대표)
--
-- 고객관리는 들어온 문의를 관리하는 페이지다. 매물과 잇지 않는다 — 고객등록(문의 → 매수자 · 매물)을 없앤다.
-- 중개사가 「이 고객이 어떤 건물을 원하나」를 판단하도록, 문의 순간 고객이 적어 둔 배경을 사본으로 남긴다
-- (고객이 나중에 프로필을 고쳐도 받은 문의는 그대로).
BEGIN;

-- 고객 배경 — 시기 · 자기자본 더함, 이해도 → 매입 경험, 스스로 매기는 의사는 뺌(확실 · 보통 · 관망은 중개사가 판단할 값)
ALTER TABLE app.customer_profile
  ADD COLUMN IF NOT EXISTS timing text CHECK (timing IN ('3개월 안','6개월 안','1년 안','미정')),
  ADD COLUMN IF NOT EXISTS equity_won bigint,                       -- 자기자본(원) — 매수자 투자 가정과 같은 이름
  ADD COLUMN IF NOT EXISTS experience text CHECK (experience IN ('처음','보유 경험'));
ALTER TABLE app.customer_profile DROP COLUMN IF EXISTS intent, DROP COLUMN IF EXISTS literacy;

-- 문의 — 문의 순간의 배경 사본 · 문의한 건물(광고가 내려가도 남게)
ALTER TABLE app.inquiries
  ADD COLUMN IF NOT EXISTS profile_snap jsonb,
  ADD COLUMN IF NOT EXISTS building_pk text;
UPDATE app.inquiries i SET building_pk = COALESCE(a.building_pk, s.building_pk)
  FROM app.inquiries x LEFT JOIN app.ads a ON a.id = x.ad_id LEFT JOIN app.seeks s ON s.id = x.seek_id
 WHERE x.id = i.id AND i.building_pk IS NULL;

-- 상태 셋 — 고객등록을 뺀다. 이미 고객등록된 문의는 상담중으로
UPDATE app.inquiries SET status = '상담중' WHERE status = '고객등록';
ALTER TABLE app.inquiries DROP CONSTRAINT inquiries_status_check;
ALTER TABLE app.inquiries ADD CONSTRAINT inquiries_status_check CHECK (status IN ('미확인','상담중','종료'));

-- 상담 메모 — 문의마다 한 줄씩 쌓는다
CREATE TABLE app.inquiry_notes (
  id          bigserial PRIMARY KEY,
  inquiry_id  bigint NOT NULL REFERENCES app.inquiries(id) ON DELETE CASCADE,
  account_id  bigint REFERENCES app.accounts(id),
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now());
CREATE INDEX inquiry_notes_iq ON app.inquiry_notes(inquiry_id, created_at);

-- 칩 사전
DELETE FROM ref.enums WHERE enum_key = 'inquiry_status' AND code = '고객등록';
DELETE FROM ref.enums WHERE enum_key = 'customer_literacy';
DELETE FROM ref.enum_groups WHERE enum_key = 'customer_literacy';
INSERT INTO ref.enum_groups(enum_key, label) VALUES ('customer_timing', '시기'), ('customer_experience', '매입 경험')
ON CONFLICT DO NOTHING;
INSERT INTO ref.enums(enum_key, code, label, sort_order) VALUES
  ('customer_timing', '3개월 안', '3개월 안', 10), ('customer_timing', '6개월 안', '6개월 안', 20),
  ('customer_timing', '1년 안', '1년 안', 30), ('customer_timing', '미정', '미정', 40),
  ('customer_experience', '처음', '처음', 10), ('customer_experience', '보유 경험', '보유 경험', 20)
ON CONFLICT DO NOTHING;

COMMIT;
