-- 0231 · 임대내역 · 층 숨김 · 사진이 매물을 지번으로 찾는다(2026-10-06 · 매물-중심.md §2-6)
-- 0227 은 (건물, 사무소)로 찾았다. 매물이 지번에 붙은 뒤(0229)엔 같은 지번의 둘째 동에서 적으면 못 찾아 거절했다.
-- building_pk 는 「매물 안 어느 동」으로 남는다 — listing_id 를 주면 건물을 덮지 않는다(동은 쓰는 쪽이 정한다).
BEGIN;
CREATE OR REPLACE FUNCTION app.office_row_from_listing() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.listing_id IS NULL THEN
    SELECT l.id INTO NEW.listing_id
      FROM app.listings l JOIN app.listing_office o ON o.listing_id = l.id
      JOIN app.listing_parcels lp ON lp.listing_id = l.id
     WHERE l.team_id = NEW.team_id
       AND lp.pnu = (SELECT b.pnu FROM master.buildings b WHERE b.building_pk = NEW.building_pk);
    IF NEW.listing_id IS NULL THEN
      RAISE EXCEPTION '매물로 등록한 건물이 아닙니다 (%)', NEW.building_pk USING ERRCODE = 'foreign_key_violation';
    END IF;
  ELSE
    SELECT l.team_id INTO NEW.team_id FROM app.listings l WHERE l.id = NEW.listing_id;
    IF NEW.building_pk IS NULL THEN
      SELECT l.building_pk INTO NEW.building_pk FROM app.listings l WHERE l.id = NEW.listing_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
COMMIT;
