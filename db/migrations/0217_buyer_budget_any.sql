-- 0217 희망매매가 「상관없음」(S09, 2026-10-04 대표) — 빈칸(모름)과 다른 값이다. 켜면 범위는 비운다
BEGIN;
ALTER TABLE app.buyers ADD COLUMN IF NOT EXISTS budget_any boolean;
COMMIT;
