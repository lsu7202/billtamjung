-- 0021: 보고서 synthesis 스냅샷 — 생성 시점 산출값(F-16/17/18) 고정 보관.
-- 웹 보고서(/reports/:id)가 이 스냅샷으로 렌더 → 매물 데이터가 바뀌어도 그 시점 값 유지.
-- 산식 재계산은 comps/preview(라이브)와 별개. specs R-보고서 §6a.
ALTER TABLE app.reports ADD COLUMN IF NOT EXISTS result_json jsonb;
