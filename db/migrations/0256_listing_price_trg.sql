-- 매매가로 나눈 셋 트리거 고침 (2026-10-08 · 0255 뒤)
-- 0255 의 app.listing_price_trg 는 CASE 한 식에서 NEW.id(listings) · NEW.listing_id(listing_parcels) 를 같이 썼다.
-- plpgsql 은 그 식을 표마다 한 번에 준비해서, listings 에선 listing_id 가 없다며 터졌다. 갈래를 IF 로 나눈다.
BEGIN;
CREATE OR REPLACE FUNCTION app.listing_price_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'listings' THEN
    PERFORM app.listing_price_refresh(NEW.id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM app.listing_price_refresh(OLD.listing_id);
  ELSE
    PERFORM app.listing_price_refresh(NEW.listing_id);
  END IF;
  RETURN NULL;
END $$;
COMMIT;
