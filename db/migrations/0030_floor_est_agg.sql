-- 0030 층별 임대 추정 롤업 — 검색 수익률을 상세·리포트와 같은 하이브리드로 맞추기 위함
--
-- 상세/리포트는 "팀이 입력한 층은 실제값, 안 건드린 층은 대장 추정"(하이브리드)으로 임대료를 본다.
-- 그런데 검색은 `COALESCE(팀입력 합계 × 12, 건물단위 추정)`이라, 팀이 한 층만 입력해도
-- 그 층만으로 건물 전체 수익률을 계산했다(실측: 같은 건물이 상세 2.67% / 검색 0.42%).
--
-- 건물단위 추정(master.building_rent_est)과 층합계(floor_rent_est)는 산식이 달라
-- 20만 건 중 3.9만 건만 일치한다 → 검색도 층 기준으로 맞춘다.
-- 매 검색마다 56만 건물의 층을 집계할 수는 없으므로 미리 굴려둔다.

CREATE MATERIALIZED VIEW IF NOT EXISTS master.floor_est_by_floor AS
SELECT fo.building_pk,
       fo.floor,
       sum(fre.rent_est)::bigint                  AS rent_est,
       sum(COALESCE(fre.deposit_est, 0))::bigint  AS deposit_est
FROM master.floor_outline fo
JOIN master.floor_rent_est fre USING (building_pk, seq)
WHERE fre.rent_est > 0
GROUP BY 1, 2;

CREATE UNIQUE INDEX IF NOT EXISTS floor_est_by_floor_uix
  ON master.floor_est_by_floor (building_pk, floor);

CREATE MATERIALIZED VIEW IF NOT EXISTS master.floor_est_total AS
SELECT building_pk,
       sum(rent_est)::bigint    AS rent_est,
       sum(deposit_est)::bigint AS deposit_est
FROM master.floor_est_by_floor
GROUP BY 1;

CREATE UNIQUE INDEX IF NOT EXISTS floor_est_total_uix
  ON master.floor_est_total (building_pk);

-- 층 표기 정규화 — 팀이 '3F'로 치고 대장이 '3층'이면 같은 층인데 문자열이 달라
-- 추정이 안 빠지고 이중 계산된다. 상세(_signed_floor)와 같은 규칙을 SQL에도 둔다.
CREATE OR REPLACE FUNCTION app.signed_floor(fl text) RETURNS int
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT CASE WHEN fl IS NULL THEN NULL
           ELSE (CASE WHEN fl LIKE '지하%' OR fl ~* '^\s*B' THEN -1 ELSE 1 END)
                * COALESCE(NULLIF(regexp_replace(fl, '\D', '', 'g'), '')::int, 0) END $$;

CREATE INDEX IF NOT EXISTS floor_est_by_floor_sf_idx
  ON master.floor_est_by_floor (building_pk, app.signed_floor(floor));
