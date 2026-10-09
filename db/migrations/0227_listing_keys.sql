-- 0227 사무소 쪽 표 · 짝이 매물을 가리키게 (2026-10-05 · specs/04-data/매물-중심.md §2-6)
--
-- 열쇠는 매물 번호(listing_id)다. 건물 · 사무소 칸(building_pk · team_id)은 **매물에서 채우는 따름 칸**으로 남긴다 —
-- 트리거가 매물에서 채우고, 사람이 따로 쓰지 않는다(읽는 쪽 수십 곳이 건물로 묶어 읽는다).
--   floor_rents · floor_hidden · photos   내 매물의 기록. listing_id 가 없으면 (건물, 사무소)로 그 사무소 매물을 찾고,
--                                           **매물이 없으면 거절한다**(매물은 등록으로만 생긴다, 10-05 대표)
--   proposals(짝)                         고객 × 매물. 대상은 모든 매물(내 매물 · 다른 사무소 · 수집). team_id 는 담은 사무소
-- 메모 · 값 이력(contacts · field_events)은 target_id = 건물로 둔다 — 한 사무소 · 한 건물에 매물은 하나라
-- (사무소, 건물)이 곧 그 매물이다. 바꾸는 것은 따로 정한다.
BEGIN;

-- ── 내 매물의 기록: 매물에서 건물 · 사무소를 채운다 ────────────────
CREATE FUNCTION app.office_row_from_listing() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.listing_id IS NULL THEN
    SELECT l.id INTO NEW.listing_id FROM app.listings l JOIN app.listing_office o ON o.listing_id = l.id
     WHERE l.building_pk = NEW.building_pk AND l.team_id = NEW.team_id;
    IF NEW.listing_id IS NULL THEN
      RAISE EXCEPTION '매물로 등록한 건물이 아닙니다 (%)', NEW.building_pk USING ERRCODE = 'foreign_key_violation';
    END IF;
  ELSE
    SELECT l.building_pk, l.team_id INTO NEW.building_pk, NEW.team_id FROM app.listings l WHERE l.id = NEW.listing_id;
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE app.floor_rents ADD COLUMN listing_id bigint REFERENCES app.listings(id) ON DELETE CASCADE;
UPDATE app.floor_rents f SET listing_id = l.id FROM app.listings l WHERE l.building_pk = f.building_pk AND l.team_id = f.team_id;
ALTER TABLE app.floor_rents ALTER COLUMN listing_id SET NOT NULL;
CREATE INDEX floor_rents_listing ON app.floor_rents(listing_id);
CREATE TRIGGER t_from_listing BEFORE INSERT OR UPDATE OF listing_id, building_pk, team_id ON app.floor_rents
  FOR EACH ROW EXECUTE FUNCTION app.office_row_from_listing();

ALTER TABLE app.floor_hidden ADD COLUMN listing_id bigint REFERENCES app.listings(id) ON DELETE CASCADE;
UPDATE app.floor_hidden f SET listing_id = l.id FROM app.listings l WHERE l.building_pk = f.building_pk AND l.team_id = f.team_id;
ALTER TABLE app.floor_hidden ALTER COLUMN listing_id SET NOT NULL;
CREATE TRIGGER t_from_listing BEFORE INSERT OR UPDATE OF listing_id, building_pk, team_id ON app.floor_hidden
  FOR EACH ROW EXECUTE FUNCTION app.office_row_from_listing();

ALTER TABLE app.photos ADD COLUMN listing_id bigint REFERENCES app.listings(id) ON DELETE CASCADE;
UPDATE app.photos f SET listing_id = l.id FROM app.listings l WHERE l.building_pk = f.building_pk AND l.team_id = f.team_id;
ALTER TABLE app.photos ALTER COLUMN listing_id SET NOT NULL;
CREATE INDEX photos_listing ON app.photos(listing_id);
CREATE TRIGGER t_from_listing BEFORE INSERT OR UPDATE OF listing_id, building_pk, team_id ON app.photos
  FOR EACH ROW EXECUTE FUNCTION app.office_row_from_listing();

-- ── 짝: 고객 × 매물 ───────────────────────────────────────────────
CREATE FUNCTION app.proposal_from_listing() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT l.building_pk INTO NEW.building_pk FROM app.listings l WHERE l.id = NEW.listing_id;   -- 건물은 매물에서
  RETURN NEW;
END $$;
ALTER TABLE app.proposals ADD COLUMN listing_id bigint REFERENCES app.listings(id) ON DELETE CASCADE;
-- 지금 짝은 담은 사무소의 그 건물 매물을 가리킨다(없으면 그 건물의 아무 매물 — 0226 전에는 담으면 매물이 생겼다)
UPDATE app.proposals p SET listing_id = COALESCE(
         (SELECT l.id FROM app.listings l WHERE l.building_pk = p.building_pk AND l.team_id = p.team_id),
         (SELECT l.id FROM app.listings l WHERE l.building_pk = p.building_pk ORDER BY l.id LIMIT 1));
DELETE FROM app.proposals WHERE listing_id IS NULL;
ALTER TABLE app.proposals ALTER COLUMN listing_id SET NOT NULL;
DROP INDEX app.proposals_uniq;
DROP INDEX app.proposals_one_pick_per_listing;
CREATE UNIQUE INDEX proposals_uniq ON app.proposals(team_id, buyer_id, listing_id);
CREATE UNIQUE INDEX proposals_one_pick_per_listing ON app.proposals(team_id, listing_id) WHERE picked_at IS NOT NULL;
CREATE TRIGGER t_from_listing BEFORE INSERT OR UPDATE OF listing_id, building_pk ON app.proposals
  FOR EACH ROW EXECUTE FUNCTION app.proposal_from_listing();

COMMIT;
