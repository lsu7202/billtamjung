-- 0043 · 다동 필지에 채운 건폐율 회수
--
-- 0040이 필지 구분 없이 건폐율을 채웠다. 그런데 다동 필지에서는 build_area가 그 동 것인데
-- land_area는 필지 전체라 계산이 과소평가된다 — 대장값이 있는 다동으로 대조하니
-- 중앙 오차 19.67%p · 48.2%가 20%p 초과(표본 47,026동). 단독 필지는 0.00%p · 99.3%가 ±2%p.
--
-- 필지 내 전 동 건축면적 합으로 맞추는 방법도 재봤다: 중앙 오차 0이지만 13.0%가 20%p 넘게
-- 어긋난다(부속건물 누락·경계 불일치). 확실하지 않은 값은 채우지 않는다 —
-- **오염이 있을 거면 비우는 게 낫고, 확실하면 채운다**(2026-08-10 규칙). 다동은 비운다.
--
-- 파이프라인(build_building_master)도 같은 게이트를 넣었으니 재적재돼도 다시 오염되지 않는다.

BEGIN;

WITH multi AS (
  SELECT pnu FROM master.buildings_v2 WHERE pnu IS NOT NULL GROUP BY 1 HAVING count(*) > 1)
UPDATE master.buildings_v2 b
   SET bcr = NULL, bcr_src = NULL
  FROM multi m
 WHERE m.pnu = b.pnu
   AND b.bcr_src IN ('건축면적', '층별개요추정');

COMMIT;
