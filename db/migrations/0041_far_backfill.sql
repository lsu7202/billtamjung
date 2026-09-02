-- 0041 · 용적률 결측 보완 (단독 필지 한정)
--
-- 왜: 용적률도 188,994동(33.8%) 비어 있다. 건폐율(0040)과 같은 이유 —
--     대장이 용적률 칸만 비워두고 용적률산정연면적·대지면적은 갖고 있다.
--
-- **다동 필지는 제외한다.** 이게 건폐율과 다른 점이다.
--   둘 다 값이 있는 건물로 대조하니 10.6%가 50%p 넘게 어긋났는데,
--   그 어긋난 건들의 **98.9%가 같은 PNU에 여러 동**이었다.
--   far_area는 그 동 것인데 land_area는 필지 전체라 나누면 과소평가된다
--   (어긋난 그룹 평균: 실제 227% vs 계산 63%).
--   단독 필지로 한정하면 중앙 오차 0.00%p · ±5%p 이내 99.4% · 50%p 초과 0.1%(표본 290,004동).
--
-- 그래서 여기 채우는 값은 추정이 아니라 계산이다. far_src에 근거를 남긴다.
-- 정본은 파이프라인이 아니라 **여기**다 — build_building_master는 표제부를 한 줄씩 읽어서
-- "이 PNU에 몇 동이 있는지"를 그 시점에 모른다. 필지 전수를 본 뒤에야 판정할 수 있다.
-- (건폐율은 동 단위 값만 쓰므로 파이프라인에서 채운다. 두 값의 자리가 다른 이유.)

BEGIN;

ALTER TABLE master.buildings_v2
  ADD COLUMN IF NOT EXISTS far_src text;   -- 대장 | 용적산정연면적

UPDATE master.buildings_v2 SET far_src = '대장'
 WHERE far IS NOT NULL AND far_src IS NULL;

WITH one AS (            -- 필지에 건물이 하나뿐인 것만
  SELECT pnu FROM master.buildings_v2 WHERE pnu IS NOT NULL GROUP BY 1 HAVING count(*) = 1)
UPDATE master.buildings_v2 b
   SET far = round(b.far_area / b.land_area * 100, 2), far_src = '용적산정연면적'
  FROM one
 WHERE one.pnu = b.pnu
   AND b.far IS NULL AND b.far_area > 0 AND b.land_area > 0
   AND b.far_area / b.land_area * 100 <= 2000;   -- 2000% 초과는 원본 오류(파이프라인과 같은 선)

COMMIT;
