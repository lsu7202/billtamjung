-- 공실을 **층의 면적**으로 바꾼다(2026-09-25 대표).
--
-- 지금까지 공실은 층별 줄마다 찍는 칩(`floor_rents.is_vacant`)이었고, 매물 줄엔 그 수
-- (`listings.vacant_cnt`)를 접었다. 수가 뜻이 없다: 30평이 비어 있으면 건물주가 한 칸으로
-- 내놓든 셋으로 쪼개든 마음이다. 변하지 않는 건 **비어 있는 넓이** 하나다.
--
-- 그래서 공실 줄을 없애고, 층마다 공실면적 한 칸을 둔다. 세 값이 저절로 나온다:
--   줄 없음   모른다
--   0         팀이 확인했고 비어 있지 않다
--   99.2      99.2㎡ 가 비어 있다
-- is_vacant 3값·미지정 걸러내기·COALESCE 사고(0179)가 전부 필요 없어진다.
--
-- 공실 줄이 없으면 층별 줄은 실제로 들어온 업체뿐이라 **총월임대가 곧 들어오는 돈**이다.
-- 공실뺀월임대(total_rent_exvac)·공실뺀수익률(roi_exvac)은 총월임대·수익률과 같아져 뺀다.
--
-- apply.sh 는 안 들어간 것만 돌리지만, 손으로 다시 돌려도 안전하게 쓴다.

BEGIN;

CREATE TABLE IF NOT EXISTS app.floor_vacancy (
  team_id      int     NOT NULL REFERENCES app.teams(id),
  building_pk  text    NOT NULL,
  -- 같은 층인지 가르는 값(core/floor_label.signed): 지하는 음수, 옥탑은 1000+. 층 이름은
  -- 「1」·「1층」·「B1」·「지1」로 제각각 적히므로 이름이 아니라 이 값으로 잇는다.
  floor_no     int     NOT NULL,
  floor        text    NOT NULL,          -- 적을 때 화면이 보인 층 이름(보기용)
  vacant_area  numeric NOT NULL CHECK (vacant_area >= 0),   -- ㎡. 계약면적 눈금으로 적는다
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   int,
  PRIMARY KEY (team_id, building_pk, floor_no)
);
COMMENT ON TABLE app.floor_vacancy IS
  '층마다 공실면적(㎡). 줄이 없으면 모름 · 0 이면 팀이 확인한 만실. 공실은 외부 원천이 없어 팀 값뿐이다.';

-- 옮기기 — 공실로 찍힌 줄의 계약면적을 층마다 더한다. 면적 없는 공실 줄은 옮길 값이 없다.
-- 2026-09-25 기준 살아 있는 공실 줄은 1개(team 24 더미, 130㎡)뿐이다.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='app' AND table_name='floor_rents' AND column_name='is_vacant') THEN
    INSERT INTO app.floor_vacancy(team_id, building_pk, floor_no, floor, vacant_area)
    SELECT team_id, building_pk, fno, min(floor), sum(contract_area)
      FROM (SELECT team_id, building_pk, floor, contract_area,
                   CASE WHEN floor ~* '^\s*(옥탑|옥상)'
                          THEN 1000 + COALESCE(NULLIF(regexp_replace(floor, '\D', '', 'g'), '')::int, 1)
                        WHEN floor ~* '^\s*(지하|지|B)'
                          THEN -COALESCE(NULLIF(regexp_replace(floor, '\D', '', 'g'), '')::int, 1)
                        ELSE NULLIF(regexp_replace(floor, '\D', '', 'g'), '')::int END AS fno
              FROM app.floor_rents
             WHERE deleted_at IS NULL AND is_vacant AND contract_area IS NOT NULL) s
     WHERE fno IS NOT NULL
     GROUP BY team_id, building_pk, fno
    ON CONFLICT DO NOTHING;

    -- 공실 줄은 업체가 아니다. 지운다(소프트 — 이력은 남는다)
    UPDATE app.floor_rents SET deleted_at = now() WHERE deleted_at IS NULL AND is_vacant;
    ALTER TABLE app.floor_rents DROP COLUMN is_vacant;
  END IF;
END $$;

-- 매물 줄 — 공실수 대신 공실면적. 층 값의 합이고, 한 층도 안 적었으면 NULL(모름)
ALTER TABLE app.listings ADD COLUMN IF NOT EXISTS vacant_area numeric;
UPDATE app.listings l SET vacant_area = v.a
  FROM (SELECT team_id, building_pk, sum(vacant_area) AS a FROM app.floor_vacancy GROUP BY 1, 2) v
 WHERE v.team_id = l.team_id AND v.building_pk = l.building_pk;

ALTER TABLE app.listings DROP COLUMN IF EXISTS vacant_cnt;
ALTER TABLE app.listings DROP COLUMN IF EXISTS total_rent_exvac;
ALTER TABLE app.listings DROP COLUMN IF EXISTS roi_exvac;

COMMIT;
