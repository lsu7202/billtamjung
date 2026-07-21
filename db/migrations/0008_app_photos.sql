-- 0008_app_photos.sql — 업로드 사진(사적·팀 공유, S02 §3.2)
BEGIN;
CREATE TABLE IF NOT EXISTS app.photos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  building_pk text NOT NULL,
  team_id bigint NOT NULL REFERENCES app.teams(id),
  file_path text NOT NULL,
  uploaded_by bigint REFERENCES app.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS photos_bldg ON app.photos(building_pk, team_id) WHERE deleted_at IS NULL;
COMMIT;
