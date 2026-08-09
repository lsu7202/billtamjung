-- 0035 · 층별 면적에서 '전용면적' 개념을 없앤다.
--
-- 왜: 대장 층별개요가 주는 면적은 전용면적이 아니라 그 층의 바닥면적이다(2026-08-09 실측).
--     판별법 — 바닥면적이면 층별 합 = 연면적, 전용면적이면 공용을 뺀 값이라 항상 연면적보다 작다.
--     서울 55.9만동: 옥탑 행 제외 시 95.2%가 소수점까지 일치하고, 연면적보다 작은 건 1.8%뿐.
--     ('큼' 쪽은 옥탑 — 연면적 제외 대상인데 층별개요에는 들어 있다.)
--     그 값을 exclusive_area(전용) 칸에 넣고 화면에 「전용」이라 적어 왔으니 라벨이 사실과 달랐다.
--
-- 무엇을: 면적은 계약면적 하나로 합친다. 실측 전용면적은 우리 데이터에 아예 없으므로
--        빈 칸을 남겨두지 않고 개념째 뺀다 — 못 채우는 칸은 오해만 만든다.

BEGIN;

-- 1) 팀 입력 — 전용에만 값이 있으면 계약으로 옮긴다.
--    둘 다 있으면 계약을 남긴다(사용자가 계약면적으로 적은 값이 더 정확한 의도).
UPDATE app.floor_rents
   SET contract_area = exclusive_area
 WHERE contract_area IS NULL AND exclusive_area IS NOT NULL;

ALTER TABLE app.floor_rents DROP COLUMN exclusive_area;

-- 2) 대장 층별개요 — 이름을 사실에 맞춘다. 값은 그대로다.
--    MV(floor_est_by_floor·floor_est_total)는 파싱된 참조를 들고 있어 rename을 따라온다.
ALTER TABLE master.floor_outline RENAME COLUMN exclusive_area TO floor_area;

COMMIT;
