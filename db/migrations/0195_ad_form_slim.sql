-- 0195 광고 폼 줄이기 · 임시저장(대표 09-28)
--
-- 스펙 칸(면적 · 층 · 용도지역 · 사용승인 · 위반건축물)을 뺀다 — 광고 카드 옆에 대장 값이 그대로 뜨고,
-- 한 벌 더 복사하면 두 곳이 어긋난다. 대장이 틀렸으면 대장 정정(오버레이)으로 고친다.
-- 위치 공개(지번까지 · 동까지만)도 뺀다 — 지도가 건물 단위라 「동까지만」이 동작할 자리가 없다.
-- 임시저장: 상태 「임시」. 고객에게 안 보이고, 필수 칸을 다 안 채워도 된다. 매물 하나에 하나.
BEGIN;
ALTER TABLE app.ads DROP COLUMN IF EXISTS land_area, DROP COLUMN IF EXISTS total_area,
  DROP COLUMN IF EXISTS floors_above, DROP COLUMN IF EXISTS floors_below, DROP COLUMN IF EXISTS zoning,
  DROP COLUMN IF EXISTS approved_on, DROP COLUMN IF EXISTS violation, DROP COLUMN IF EXISTS address_open;
ALTER TABLE app.ads DROP CONSTRAINT ads_state_check;
ALTER TABLE app.ads ADD CONSTRAINT ads_state_check CHECK (state IN ('임시','노출','비노출','거래완료','삭제'));
ALTER TABLE app.ads ALTER COLUMN title DROP NOT NULL, ALTER COLUMN body DROP NOT NULL,
  ALTER COLUMN use_type DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ads_one_draft ON app.ads(listing_id) WHERE state = '임시';
INSERT INTO ref.enums(enum_key, code, label, sort_order) VALUES ('ad_state', '임시', '임시', 5) ON CONFLICT DO NOTHING;
COMMIT;
