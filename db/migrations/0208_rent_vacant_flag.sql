-- 0208 · 임대내역 공실 체크(10-02 대표) — 시트 맨 끝 열.
-- 세 상태: 체크됨 = 공실 / 업체 있음 = 임대중 / 둘 다 아님 = 모름.
-- 예전(0186)엔 「업체도 임대료도 없으면 공실」로 셌는데, 층만 미리 채운 줄까지 공실로 잡혀
-- 확인하지 않은 공실이 합계에 섞였다. 이제 공실은 사람이 체크한 줄만이다.
ALTER TABLE app.floor_rents ADD COLUMN IF NOT EXISTS vacant boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION app.listing_vacancy(p_pk text, p_team bigint) RETURNS numeric
LANGUAGE sql STABLE AS $$
  WITH v AS (
    SELECT contract_area FROM app.floor_rents
     WHERE building_pk = p_pk AND team_id = p_team AND deleted_at IS NULL AND vacant
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v) THEN NULL
              WHEN EXISTS (SELECT 1 FROM v WHERE contract_area IS NULL) THEN NULL
              ELSE (SELECT sum(contract_area) FROM v) END
$$;
