-- 0218 고객 기록 ↔ 고객 프로필 칸 맞춤(S09 §3-1, 2026-10-04 대표)
-- 이해도를 빼고 매입 경험을 남긴다(매입 경험이 더 직관적). 원하는 지역은 조건과 따로 고객 칸으로 둔다(서로 맞추지 않는다).
-- 두 표의 칸이 같아야 「고객으로 등록」할 때 그대로 옮겨진다.
BEGIN;
ALTER TABLE app.buyers
  ADD COLUMN IF NOT EXISTS experience text CHECK (experience IN ('처음','보유 경험')),
  ADD COLUMN IF NOT EXISTS regions text[];
ALTER TABLE app.buyers DROP COLUMN IF EXISTS literacy;

ALTER TABLE app.customer_profile
  ADD COLUMN IF NOT EXISTS is_corp boolean,
  ADD COLUMN IF NOT EXISTS budget_any boolean;
ALTER TABLE app.customer_profile DROP COLUMN IF EXISTS literacy;

UPDATE app.inquiries SET profile_snap = profile_snap - 'literacy' WHERE profile_snap ? 'literacy';

DELETE FROM ref.enums WHERE enum_key = 'customer_literacy';
DELETE FROM ref.enum_groups WHERE enum_key = 'customer_literacy';
COMMIT;
