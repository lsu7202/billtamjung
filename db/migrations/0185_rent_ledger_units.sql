-- 임대 내역 = 호실(업체 단위) 줄 하나로(2026-09-26 대표)
--
-- 층별 정보(건물 상세)와 임대 내역(내 매물)을 나눈다. 건물 상세는 대장·원장만 읽고,
-- 팀 값(호실·임대료·공실)은 매물의 임대 내역에만 있다. 모델도 같은 경계로 받는다.
--
--   호실  = floor_rents 한 줄. 중개사가 말하는 호실은 **업체 단위**다(대장 전유부 아님).
--   상태  = 저장하지 않는다. 상호가 있거나(원장에서 온 줄 포함) 임대료가 적혀 있으면 임대중,
--           아무것도 없으면 공실. 상호 없이 임대료만 적힌 옛 줄(팀 24의 세 줄)이 공실로
--           뒤집히지 않게 임대료도 「들어온 업체」의 증거로 친다.
--   층    = null 이면 층 미상. 원장에서 층을 모르는 업체가 여기 선다.
--   place_ref = 매물 등록 때 원장에서 복사한 업체의 열쇠(정규화 상호). 팀이 직접 만든 줄은 null.
--   공실면적 = 파생. 층마다 공실 호실 면적의 합. 공실 호실 중 면적을 모르는 게 있으면 그 층은 모름.
--             호실 줄이 하나도 없으면 모름(null) — 0(만실)이 아니다.
--
-- floor_vacancy(0180, 층마다 면적 하나)는 없앤다. 1줄(팀 24, 3층 130㎡)은 같은 층 공실 호실로 옮긴다.

BEGIN;

ALTER TABLE app.floor_rents ADD COLUMN IF NOT EXISTS place_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS floor_rents_place_uk
  ON app.floor_rents(team_id, building_pk, place_ref) WHERE place_ref IS NOT NULL;

-- 호실이 들어차 있나 — 판정은 이 함수 하나다(합계·만실·API 가 같이 부른다)
CREATE OR REPLACE FUNCTION app.unit_occupied(p_tenant text, p_place text, p_rent bigint)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(btrim(COALESCE(p_tenant, '')), '') IS NOT NULL OR p_place IS NOT NULL OR COALESCE(p_rent, 0) > 0
$$;

INSERT INTO app.floor_rents(building_pk, team_id, floor, unit_no, contract_area)
SELECT v.building_pk, v.team_id, v.floor, '', v.vacant_area
  FROM app.floor_vacancy v WHERE v.vacant_area > 0;

DROP TABLE IF EXISTS app.floor_vacancy;

-- 매물 공실면적 — 한 곳에서 판다. 모르면 null:
--   · 호실 줄이 하나도 없다
--   · 대장 층(층별개요) 중 호실 줄이 하나도 없는 층이 있다 — 그 층이 비었는지 찼는지 모른다.
--     원장에서 복사한 업체 몇 곳만으로 「만실(0)」이라 말하지 않기 위해서다
--   · 공실 호실 중 면적을 모르는 게 있다
CREATE OR REPLACE FUNCTION app.listing_vacancy(p_pk text, p_team bigint) RETURNS numeric LANGUAGE sql STABLE AS $$
  WITH rows AS (
    SELECT floor, contract_area, app.unit_occupied(tenant_name, place_ref, rent) AS occ
      FROM app.floor_rents WHERE building_pk = p_pk AND team_id = p_team AND deleted_at IS NULL
  ), gap AS (
    SELECT 1 FROM (SELECT DISTINCT app.floor_signed(floor) AS f FROM master.floor_outline
                    WHERE building_pk = p_pk AND floor IS NOT NULL) o
     WHERE o.f IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM rows r WHERE r.floor IS NOT NULL AND app.floor_signed(r.floor) = o.f)
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM rows) THEN NULL
              WHEN EXISTS (SELECT 1 FROM gap) THEN NULL
              WHEN EXISTS (SELECT 1 FROM rows WHERE NOT occ AND contract_area IS NULL) THEN NULL
              ELSE COALESCE((SELECT sum(contract_area) FROM rows WHERE NOT occ), 0) END
$$;

-- 만실(0181) — 공실면적을 호실 줄에서 판다
CREATE OR REPLACE FUNCTION app.listing_full_fold(p_pk text, p_team bigint) RETURNS void LANGUAGE sql AS $$
  WITH rows AS (
    SELECT floor, rent, contract_area, app.unit_occupied(tenant_name, place_ref, rent) AS occ
      FROM app.floor_rents
     WHERE building_pk = p_pk AND team_id = p_team AND deleted_at IS NULL
  ), vac AS (          -- 층마다 공실 호실 면적의 합. 면적 모르는 공실이 있으면 그 층은 모름(null)
    SELECT app.floor_signed(floor) AS floor_no,
           CASE WHEN bool_or(contract_area IS NULL) THEN NULL ELSE sum(contract_area) END AS vacant_area
      FROM rows WHERE NOT occ GROUP BY 1
  ), act AS (          -- 같은 층 실측 평당가(원/㎡)
    SELECT app.floor_signed(floor) AS fno, sum(rent)::numeric / sum(contract_area) AS p
      FROM rows WHERE occ AND rent > 0 AND contract_area > 0 GROUP BY 1
  ), est AS (          -- 층별 추정 평당가(원/㎡)
    SELECT app.floor_signed(fo.floor) AS fno, sum(fre.rent_est)::numeric / NULLIF(sum(fo.floor_area), 0) AS p
      FROM master.floor_outline fo JOIN master.floor_rent_est fre USING (building_pk, seq)
     WHERE fo.building_pk = p_pk AND fre.rent_est > 0 GROUP BY 1
  ), per AS (
    SELECT v.vacant_area, COALESCE(a.p, e.p) AS p, (a.p IS NULL AND e.p IS NOT NULL) AS is_est
      FROM vac v LEFT JOIN act a ON a.fno = v.floor_no LEFT JOIN est e ON e.fno = v.floor_no
  ), g AS (
    SELECT (SELECT count(*) FROM rows) AS n,
           (SELECT count(*) FROM rows WHERE occ AND COALESCE(rent, 0) = 0) AS unknown_rent,
           count(*) FILTER (WHERE vacant_area IS NULL OR (vacant_area > 0 AND p IS NULL)) AS miss,
           COALESCE(sum(vacant_area * p) FILTER (WHERE vacant_area > 0), 0) AS add,
           COALESCE(bool_or(is_est) FILTER (WHERE vacant_area > 0), false) AS est
      FROM per
  )
  UPDATE app.listings l
     SET rent_full = CASE WHEN k.ok AND l.total_rent IS NOT NULL THEN round(l.total_rent + k.add) END,
         full_est  = CASE WHEN k.ok AND l.total_rent IS NOT NULL THEN k.est END,
         roi_full  = CASE WHEN k.ok AND l.total_rent IS NOT NULL AND l.sale_price > 0
                          THEN round((l.total_rent + k.add) * 12.0 / l.sale_price * 100, 2) END
    FROM (SELECT n > 0 AND miss = 0 AND unknown_rent = 0
                 AND app.listing_vacancy(p_pk, p_team) IS NOT NULL AS ok, add, est FROM g) k
   WHERE l.building_pk = p_pk AND l.team_id = p_team
$$;

COMMIT;
