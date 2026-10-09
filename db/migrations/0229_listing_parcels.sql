-- 0229 · 매물이 지번을 가리킨다(2026-10-06 대표 · specs/04-data/매물-중심.md §2-2b)
--
-- 매물 1 : 지번 N. 보통 하나 · 합필 안 된 통매와 두 지번에 걸친 건물은 여럿. 지번의 건물은 master.buildings.pnu 로 따라온다.
-- 한 사무소 · 한 지번에 매물은 하나(team_id + pnu 유일).
-- 옮기는 동안(§6): listings.building_pk 는 아직 남는다. 매물이 생기면 트리거가 그 건물의 지번을 대표 지번으로 채운다.
BEGIN;

CREATE TABLE app.listing_parcels (
  listing_id bigint  NOT NULL REFERENCES app.listings(id) ON DELETE CASCADE,
  pnu        text    NOT NULL,
  team_id    bigint  NOT NULL,                 -- 주인. 매물에서 트리거가 채운다
  main       boolean NOT NULL DEFAULT false,   -- 대표 지번(주소 · 지도 핀 자리). 매물마다 하나
  PRIMARY KEY (listing_id, pnu));
CREATE UNIQUE INDEX listing_parcels_team_pnu ON app.listing_parcels(team_id, pnu);
CREATE UNIQUE INDEX listing_parcels_one_main ON app.listing_parcels(listing_id) WHERE main;
CREATE INDEX listing_parcels_pnu ON app.listing_parcels(pnu);

CREATE FUNCTION app.listing_parcel_team() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT l.team_id INTO NEW.team_id FROM app.listings l WHERE l.id = NEW.listing_id;
  RETURN NEW;
END $$;
CREATE TRIGGER t_team BEFORE INSERT OR UPDATE OF listing_id ON app.listing_parcels
  FOR EACH ROW EXECUTE FUNCTION app.listing_parcel_team();

-- 수집 매물은 지번마다 하나(§2-4 · 그날 가장 싼 광고). 같은 지번에 둘이면 싼 것(같으면 먼저 생긴 것)만 남긴다
DELETE FROM app.listings x USING (
  SELECT l.id, row_number() OVER (PARTITION BY l.team_id, b.pnu ORDER BY l.price NULLS LAST, l.id) rn
    FROM app.listings l JOIN app.teams t ON t.id = l.team_id AND t.system
    JOIN master.buildings b ON b.building_pk = l.building_pk) d
 WHERE x.id = d.id AND d.rn > 1;
-- 건물이 대장에서 빠져 지번을 모르는 수집 매물(다음 수집 때 다시 붙는다)
DELETE FROM app.listings l USING app.teams t
 WHERE t.id = l.team_id AND t.system
   AND NOT EXISTS (SELECT 1 FROM master.buildings b WHERE b.building_pk = l.building_pk);

INSERT INTO app.listing_parcels(listing_id, pnu, team_id, main)
SELECT l.id, b.pnu, l.team_id, true
  FROM app.listings l JOIN master.buildings b ON b.building_pk = l.building_pk
 WHERE b.pnu IS NOT NULL;

-- 옮기는 동안: 건물로 만든 매물에 대표 지번을 채운다
CREATE FUNCTION app.listing_parcel_from_building() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.building_pk IS NOT NULL AND NOT EXISTS (SELECT 1 FROM app.listing_parcels p WHERE p.listing_id = NEW.id) THEN
    INSERT INTO app.listing_parcels(listing_id, pnu, team_id, main)
    SELECT NEW.id, b.pnu, NEW.team_id, true FROM master.buildings b
     WHERE b.building_pk = NEW.building_pk AND b.pnu IS NOT NULL;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER t_parcel AFTER INSERT ON app.listings
  FOR EACH ROW EXECUTE FUNCTION app.listing_parcel_from_building();

COMMIT;
