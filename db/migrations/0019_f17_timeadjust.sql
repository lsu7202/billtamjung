-- F-17 시점보정표를 명세(formulas.md) 정본으로 정정.
-- 기존 seed(0005) 값은 플레이스홀더였음. 현재=2026 앵커(0%).
-- 2021=0 · 2022=+3 · 2023=+9 · 2024=+6 · 2025=+3 · 2026=0 (%)
-- F-17이 아직 산출된 보고서가 없어(재현성 영향 없음) v1 in-place 정정.
BEGIN;
UPDATE ref.formula_params
   SET value_json = '{"2021":0.00,"2022":0.03,"2023":0.09,"2024":0.06,"2025":0.03,"2026":0.00}'
 WHERE set_version = 1 AND formula_id = 'F-17' AND param_key = 'time_adjust';
COMMIT;
