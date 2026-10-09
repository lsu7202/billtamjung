-- 0233 · 나대지 매물도 지번에 붙는다(2026-10-06 · 매물-중심.md §2-2b)
-- 나대지는 건물번호 자리에 'P' + 지번번호를 쓴다(옛 규칙 그대로). 거기서 지번을 꺼낸다.
BEGIN;
CREATE FUNCTION app.pnu_of(p_pk text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_pk LIKE 'P%' THEN substr(p_pk, 2)
              ELSE (SELECT b.pnu FROM master.buildings b WHERE b.building_pk = p_pk) END
$$;

CREATE OR REPLACE FUNCTION app.listing_parcel_from_building() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_pnu text := app.pnu_of(NEW.building_pk);
BEGIN
  IF v_pnu IS NOT NULL AND NOT EXISTS (SELECT 1 FROM app.listing_parcels p WHERE p.listing_id = NEW.id) THEN
    INSERT INTO app.listing_parcels(listing_id, pnu, team_id, main) VALUES (NEW.id, v_pnu, NEW.team_id, true);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION app.office_row_from_listing() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.listing_id IS NULL THEN
    SELECT l.id INTO NEW.listing_id
      FROM app.listings l JOIN app.listing_office o ON o.listing_id = l.id
      JOIN app.listing_parcels lp ON lp.listing_id = l.id
     WHERE l.team_id = NEW.team_id AND lp.pnu = app.pnu_of(NEW.building_pk);
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
