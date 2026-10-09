-- 0216 고객 희망매매가(S09, 2026-10-04 대표) — 엑셀 「희망매매가」 열. 사람의 형편이라 고객 칸에 둔다.
-- 조건(저장한 조건)의 매매가는 그 검색의 범위라 따로 남는다. 고객 프로필의 예산 칸과 같은 이름 — 고객으로 등록할 때 그대로 옮긴다
BEGIN;
ALTER TABLE app.buyers ADD COLUMN IF NOT EXISTS budget_min bigint, ADD COLUMN IF NOT EXISTS budget_max bigint;
COMMIT;
