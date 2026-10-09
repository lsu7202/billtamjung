-- 숨기기 · 구해요를 지번 열쇠로 (2026-10-08 · 스펙 12 §3-3)
-- 지도에서 고르는 것은 필지다. 숨기기는 계정 × 지번, 구해요는 땅을 두고 남기는 것(나대지 포함).
-- 구해요 제안은 매물(listing_id)을 가리킨다 — 건물 번호(listing_pk)를 쓰던 칸을 바꾼다.
-- 세 표 모두 0줄이라 옮길 값이 없다(10-08 확인).

BEGIN;

DROP TABLE IF EXISTS app.hidden_buildings;
CREATE TABLE IF NOT EXISTS app.hidden_parcels (
  account_id bigint NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  pnu        text   NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, pnu));
COMMENT ON TABLE app.hidden_parcels IS '계정마다 안 보는 지번(0197 → 10-08 지번 열쇠). 「다시 보기」로만 되돌린다';

ALTER TABLE app.seeks RENAME COLUMN building_pk TO pnu;
ALTER INDEX app.seeks_building RENAME TO seeks_pnu;
COMMENT ON COLUMN app.seeks.pnu IS '구해요를 남긴 지번(나대지 포함)';

ALTER TABLE app.seek_proposals DROP COLUMN IF EXISTS listing_pk;
ALTER TABLE app.seek_proposals ADD COLUMN IF NOT EXISTS listing_id bigint REFERENCES app.listings(id) ON DELETE SET NULL;
COMMENT ON COLUMN app.seek_proposals.listing_id IS '제안한 매물';

COMMIT;
