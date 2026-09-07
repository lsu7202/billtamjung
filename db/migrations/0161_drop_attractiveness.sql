-- 매력도(F-16) 기능 삭제 — 2026-09-06 대표 결정 「아예 없애」.
-- 점수·등급·8축 항목을 표에서 지운다. 활용유형·매도가능성은 남는다.
ALTER TABLE master.building_score
  DROP COLUMN IF EXISTS score,
  DROP COLUMN IF EXISTS grade,
  DROP COLUMN IF EXISTS items;
DROP INDEX IF EXISTS master.building_score_grade_idx;
