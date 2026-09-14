-- 0068 · 매물번호·접수일은 DB가 정한다 — 등록(담당자 첫 지정) 순간 자동 발급
--
-- 원래 의도가 이것이었는데 구현이 없었다: 0003이 컬럼만 만들고 채우는 곳이 없어
-- 지금까지 손으로 쳐 왔다(프로덕션 BT-1047도 수기). 서류 번호를 사람이 지으면
-- 형식이 갈리고 겹친다 — 신원은 시스템이 발급해야 한다.
--
--   매물번호  BT-(1000+id) — 행마다 유일, 짧고, 순번이 노출돼도 해가 없다
--   접수일    담당자가 처음 지정된 날 = 매물을 접수한 날
--
-- 발급 시점 = 등록. 행 생성 시점이 아니다 — listings 행은 조사 데이터 저장·거울 커밋으로도
-- 생기는데, 그건 아직 「접수」가 아니다. 이미 값이 있으면 덮지 않는다(과거 수기값 보존).

BEGIN;

CREATE OR REPLACE FUNCTION app.listing_register_defaults() RETURNS trigger AS $$
BEGIN
  IF NEW.assignee_account_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.assignee_account_id IS DISTINCT FROM NEW.assignee_account_id) THEN
    NEW.listing_no  := COALESCE(NEW.listing_no,  'BT-' || (1000 + NEW.id));
    NEW.received_on := COALESCE(NEW.received_on, current_date);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS t_listing_register ON app.listings;
CREATE TRIGGER t_listing_register
  BEFORE INSERT OR UPDATE OF assignee_account_id ON app.listings
  FOR EACH ROW EXECUTE FUNCTION app.listing_register_defaults();

-- 이미 등록돼 있는데 번호가 없는 행 백필
UPDATE app.listings SET
  listing_no  = COALESCE(listing_no,  'BT-' || (1000 + id)),
  received_on = COALESCE(received_on, created_at::date)
WHERE assignee_account_id IS NOT NULL;

COMMIT;
