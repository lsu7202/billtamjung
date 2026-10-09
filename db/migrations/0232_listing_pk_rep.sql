-- 0232 · 매물의 건물번호를 지번의 대표 건물로 맞춘다(2026-10-06 · 매물-중심.md §6)
--
-- 보는 단위는 지번이고 검색 줄은 대표 건물(0230)로 선다. 매물에 적힌 건물번호도 대표 건물로 맞추면
-- 화면이 넘기는 번호와 매물의 번호가 같아져, 「이 건물의 매물」을 찾는 조회들이 그대로 맞는다.
-- listings.building_pk 는 §6-7 에서 지운다. 그때까지 **대표 건물 번호**다(새 매물도 트리거가 대표로 맞춘다).
-- 매물에 딸린 건물번호도 같이 옮긴다: 사진 · 짝 · 문의 · 메모와 값 이력(target_type='listing').
-- 임대내역 · 층 숨김의 building_pk 는 「매물 안 어느 동」이라 그대로 둔다.
BEGIN;

CREATE TEMP TABLE mv ON COMMIT DROP AS
SELECT l.id, l.team_id, l.building_pk AS old_pk, r.rep_pk AS new_pk
  FROM app.listings l JOIN app.listing_parcels lp ON lp.listing_id = l.id AND lp.main
  JOIN master.parcel_rep r ON r.pnu = lp.pnu
 WHERE l.building_pk <> r.rep_pk;

UPDATE app.photos x SET building_pk = mv.new_pk FROM mv WHERE x.listing_id = mv.id;
UPDATE app.proposals x SET building_pk = mv.new_pk FROM mv WHERE x.listing_id = mv.id;
UPDATE app.inquiries x SET building_pk = mv.new_pk FROM mv WHERE x.listing_id = mv.id;
UPDATE app.contacts x SET target_id = mv.new_pk FROM mv
 WHERE x.target_type = 'listing' AND x.team_id = mv.team_id AND x.target_id = mv.old_pk;
UPDATE app.field_events x SET target_id = mv.new_pk FROM mv
 WHERE x.target_type = 'listing' AND x.team_id = mv.team_id AND x.target_id = mv.old_pk;
UPDATE app.listings x SET building_pk = mv.new_pk FROM mv WHERE x.id = mv.id;

-- 새 매물: 들어온 건물번호를 대표 건물로 맞춘다(BEFORE) · 지번은 0229 트리거가 붙인다(AFTER)
CREATE FUNCTION app.listing_pk_to_rep() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.building_pk := COALESCE(app.rep_of(NEW.building_pk), NEW.building_pk);
  RETURN NEW;
END $$;
CREATE TRIGGER t_rep BEFORE INSERT ON app.listings
  FOR EACH ROW EXECUTE FUNCTION app.listing_pk_to_rep();

COMMIT;
