-- 활용유형 · 매도가능성 · 분석보고서 기록 삭제 (2026-10-07 대표)
--
-- master.building_score — 활용유형(use_type · use_scores) · 매도가능성(sell_score · sell_axes · util_ratio).
--   배치가 58만 동을 계속 채웠지만 읽는 곳이 없었다. 건물 상세 API 와 매물 보드가 SELECT 한 뒤 바로 버렸다.
--   매력도(F-16)는 0161 에서, 활용유형 화면은 09-26 에 이미 걷었다.
-- app.reports — 분석보고서 · 브리핑 산출물. 생성 코드는 0239 때 지웠다(태그 「추정임대-마지막」).
--   proposals.report_id 가 외래키로 물고 있어 그 칸부터 지운다.

BEGIN;

ALTER TABLE app.proposals DROP COLUMN IF EXISTS report_id;
DROP TABLE IF EXISTS app.reports;
DROP TABLE IF EXISTS master.building_score;

COMMIT;
