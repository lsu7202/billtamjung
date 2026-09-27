-- 매물번호 숫자만 · 매물 등급 A~E (2026-09-26 대표)
--
-- 매물번호: 「BT-」를 떼고 숫자만 발급한다(대표: 「아예 안 붙게」). 이미 발급된 것도 뗀다.
--   번호 자체(1000 + id)는 그대로라 전화로 부르던 번호는 안 바뀐다.
-- 등급: 매우좋음·좋음·나쁨·매우나쁨 → A·B·C·D·E. 채운 매물이 0건이라 옮길 값이 없다.
--   입지(ipji)는 그대로 둔다.

BEGIN;

CREATE OR REPLACE FUNCTION app.listing_register_defaults() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.assignee_account_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.assignee_account_id IS DISTINCT FROM NEW.assignee_account_id) THEN
    NEW.listing_no  := COALESCE(NEW.listing_no,  (1000 + NEW.id)::text);
    NEW.received_on := COALESCE(NEW.received_on, current_date);
  END IF;
  RETURN NEW;
END $$;

UPDATE app.listings SET listing_no = regexp_replace(listing_no, '^BT-', '') WHERE listing_no LIKE 'BT-%';

UPDATE app.listings SET grade = NULL WHERE grade IN ('매우좋음', '좋음', '나쁨', '매우나쁨');
DELETE FROM ref.enums WHERE enum_key = 'grade' AND code <> '미지정';
INSERT INTO ref.enums(enum_key, code, label, sort_order) VALUES
  ('grade', 'A', 'A', 20), ('grade', 'B', 'B', 30), ('grade', 'C', 'C', 40),
  ('grade', 'D', 'D', 50), ('grade', 'E', 'E', 60);

COMMIT;
