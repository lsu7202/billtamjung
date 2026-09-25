-- 만실 월임대·만실 수익률(2026-09-25 대표).
--
-- 0180 에서 공실 줄을 없애자 「수익률」은 곧 지금 들어오는 돈 기준이 됐다. 사라진 건 반대쪽,
-- **공실이 다 찼을 때**다. 예전엔 공실 줄에 호가를 적으면 그게 총월임대에 들어가 만실 가정이 됐다.
-- 이제 층 공실면적이 있으니 거기에 평당 월임대를 곱해 되살린다:
--
--   만실 월임대 = 지금 월임대 + Σ(층 공실면적 × 그 층 평당 월임대)
--
-- 평당가 순서 — **같은 층 실측** → 없으면 **층별 추정**(master.floor_rent_est).
-- 건물 평균은 안 쓴다. 층마다 임대료가 달라 1층 값으로 5층 공실을 채우면 조용히 부풀려진다.
-- 추정이 한 층이라도 섞이면 full_est=true — 화면·모델은 이름에 「추정」을 붙인다.
--
-- 모르면 안 낸다(NULL):
--   · 공실면적을 한 층도 안 적었다          → 만실인지 아닌지 모른다
--   · 지금 월임대를 모른다                   → total_rent NULL, 또는 임대료 0 인 업체 줄이 있다
--     (화면은 새 줄을 0 으로 만든다. 0 은 대개 「안 적음」이라 더하면 만실이 모자라게 나온다)
--   · 공실 층의 평당가를 실측·추정 어디서도 못 얻었다
--
-- 산식은 **이 함수 하나**다. mirror.listing_values_fold 가 쓸 때마다 부르고, 아래 채우기도 이걸 부른다.

BEGIN;

-- 층 이름 → 서명층수. core/floor_label.signed 와 같은 규칙(지하 음수 · 옥탑 1000+).
-- 저장된 층 이름은 이미 정규화돼 있어(「3층」·「지하1층」·「옥탑1층」) 이 정도로 충분하다.
CREATE OR REPLACE FUNCTION app.floor_signed(t text) RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN t ~* '^\s*(옥탑|옥상)'
                THEN 1000 + COALESCE(NULLIF(regexp_replace(t, '\D', '', 'g'), '')::int, 1)
              WHEN t ~* '^\s*(지하|지|B)'
                THEN -COALESCE(NULLIF(regexp_replace(t, '\D', '', 'g'), '')::int, 1)
              ELSE NULLIF(regexp_replace(t, '\D', '', 'g'), '')::int END
$$;

ALTER TABLE app.listings ADD COLUMN IF NOT EXISTS rent_full bigint;     -- 만실 월임대(원)
ALTER TABLE app.listings ADD COLUMN IF NOT EXISTS roi_full  numeric;    -- 만실 수익률(%) = 만실 월임대 × 12 ÷ 팀 매매가
ALTER TABLE app.listings ADD COLUMN IF NOT EXISTS full_est  boolean;    -- 공실 평당가에 추정이 섞였나

CREATE OR REPLACE FUNCTION app.listing_full_fold(p_pk text, p_team bigint) RETURNS void LANGUAGE sql AS $$
  WITH vac AS (
    SELECT floor_no, vacant_area FROM app.floor_vacancy WHERE building_pk = p_pk AND team_id = p_team
  ), rows AS (
    SELECT floor, rent, contract_area FROM app.floor_rents
     WHERE building_pk = p_pk AND team_id = p_team AND deleted_at IS NULL
  ), act AS (          -- 같은 층 실측 평당가(원/㎡) — 임대료·계약면적이 둘 다 있는 줄만
    SELECT app.floor_signed(floor) AS fno, sum(rent)::numeric / sum(contract_area) AS p
      FROM rows WHERE rent > 0 AND contract_area > 0 GROUP BY 1
  ), est AS (          -- 층별 추정 평당가(원/㎡) — 바닥면적 기준
    SELECT app.floor_signed(fo.floor) AS fno, sum(fre.rent_est)::numeric / NULLIF(sum(fo.floor_area), 0) AS p
      FROM master.floor_outline fo JOIN master.floor_rent_est fre USING (building_pk, seq)
     WHERE fo.building_pk = p_pk AND fre.rent_est > 0 GROUP BY 1
  ), per AS (
    SELECT v.vacant_area, COALESCE(a.p, e.p) AS p, (a.p IS NULL AND e.p IS NOT NULL) AS is_est
      FROM vac v LEFT JOIN act a ON a.fno = v.floor_no LEFT JOIN est e ON e.fno = v.floor_no
  ), g AS (
    SELECT (SELECT count(*) FROM vac) AS n,
           (SELECT count(*) FROM rows WHERE COALESCE(rent, 0) = 0) AS unknown_rent,
           count(*) FILTER (WHERE vacant_area > 0 AND p IS NULL) AS miss,
           COALESCE(sum(vacant_area * p) FILTER (WHERE vacant_area > 0), 0) AS add,
           COALESCE(bool_or(is_est) FILTER (WHERE vacant_area > 0), false) AS est
      FROM per
  )
  UPDATE app.listings l
     SET rent_full = CASE WHEN k.ok AND l.total_rent IS NOT NULL THEN round(l.total_rent + k.add) END,
         full_est  = CASE WHEN k.ok AND l.total_rent IS NOT NULL THEN k.est END,
         roi_full  = CASE WHEN k.ok AND l.total_rent IS NOT NULL AND l.sale_price > 0
                          THEN round((l.total_rent + k.add) * 12.0 / l.sale_price * 100, 2) END
    FROM (SELECT n > 0 AND miss = 0 AND unknown_rent = 0 AS ok, add, est FROM g) k
   WHERE l.building_pk = p_pk AND l.team_id = p_team
$$;

-- 채우기 — 공실면적을 적은 매물만(그 밖은 어차피 NULL)
SELECT app.listing_full_fold(l.building_pk, l.team_id)
  FROM app.listings l
 WHERE EXISTS (SELECT 1 FROM app.floor_vacancy v WHERE v.building_pk = l.building_pk AND v.team_id = l.team_id);

COMMIT;
