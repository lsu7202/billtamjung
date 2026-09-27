-- 공실면적 = 적힌 공실 호실의 합(2026-09-27 대표)
--
-- 0185 는 「대장 층마다 호실 줄이 있어야 셈」으로 건물 전체가 다 확인됐는지를 시스템이 판단했다.
-- 1층에 호실이 둘 적혀 있어도 그게 전부인지는 알 수 없다. 시스템이 「이 층은 만실」이라 단정할
-- 근거가 없다(대표). 완결성 판단을 뺀다:
--
--   공실면적 = 중개사가 적은 공실 호실(app.unit_occupied 거짓) 면적의 합
--              적힌 공실 호실이 없으면 NULL — 0(만실)이라 말하지 않는다
--              면적을 모르는 공실 호실이 있으면 NULL — 숫자를 지어내지 않는다
--   만실 월임대 = 지금 월임대 + 적힌 공실 × 그 층 평당가. 「적힌 공실이 다 차면」이다.
--              공실면적이 NULL 이면 안 낸다. 이름은 「만실」 그대로(대표).

BEGIN;

CREATE OR REPLACE FUNCTION app.listing_vacancy(p_pk text, p_team bigint) RETURNS numeric LANGUAGE sql STABLE AS $$
  WITH v AS (
    SELECT contract_area FROM app.floor_rents
     WHERE building_pk = p_pk AND team_id = p_team AND deleted_at IS NULL
       AND NOT app.unit_occupied(tenant_name, place_ref, rent)
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v) THEN NULL
              WHEN EXISTS (SELECT 1 FROM v WHERE contract_area IS NULL) THEN NULL
              ELSE (SELECT sum(contract_area) FROM v) END
$$;

COMMIT;
