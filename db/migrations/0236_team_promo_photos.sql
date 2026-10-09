-- 0236 · 사무소 홍보 사진(2026-10-06 대표 「로고와 홍보 사진은 자리를 만들면 됨」)
-- 홍보물 템플릿의 부품 <bt-promo n="1"> 이 읽는다. 로고는 app.teams.logo_path 그대로.
BEGIN;
CREATE TABLE app.team_promo_photos (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id     bigint NOT NULL REFERENCES app.teams(id) ON DELETE CASCADE,
  path        text   NOT NULL,                 -- storage 열쇠
  sort_order  int    NOT NULL DEFAULT 0,
  uploaded_by bigint REFERENCES app.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now());
CREATE INDEX team_promo_photos_team ON app.team_promo_photos(team_id, sort_order, id);
COMMIT;
