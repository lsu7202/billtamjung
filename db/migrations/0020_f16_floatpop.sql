-- F-16 유동인구 재편입(route B). 9항목 복원.
-- 유동인구는 NICE 전건물 미확보 → 도로접면·역거리 proxy로 마스터값 초기화(value_score.float_pop_score).
--   comp도 전 건물 값이 존재 → F-17 유사도 가중이 '데이터 유무 격차'로 무력화되던 문제 해소.
-- 가중치: 기존 8항목(합100)을 ×0.85로 축소 + 유동인구 15 → 합 100(상대순위 보존, formulas.md).
-- F-16이 아직 산출된 보고서가 없어(재현성 영향 없음) v1 in-place.
BEGIN;
UPDATE ref.formula_params SET value_num = value_num * 0.85
 WHERE set_version = 1 AND formula_id = 'F-16' AND param_key LIKE 'weight.%';
INSERT INTO ref.formula_params (set_version, formula_id, param_key, value_num)
VALUES (1, 'F-16', 'weight.float_pop', 15)
ON CONFLICT (set_version, formula_id, param_key) DO UPDATE SET value_num = EXCLUDED.value_num;
COMMIT;
