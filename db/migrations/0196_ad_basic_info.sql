-- 0196 광고 기본정보(디스코식 사이드바, 대표 09-28)
--
-- 대장에 없는, 광고한 중개사만 아는 값. 전부 비워 둘 수 있다(모르면 null, 사이드바에 줄이 안 선다).
-- · 현 보증금 · 현 월세 — 폼을 열 때 매물의 총보증금 · 총월세(listings.total_deposit · total_rent)로 미리 채운다
-- · 융자금 — loan_open=false 면 「표시 안 함」(디스코 「표시안함」)
-- · 입주가능일 — 즉시입주 · 협의 · 날짜(move_in_on) 중 하나
-- 방향 · 방/욕실 수는 주거용 칸이라 안 둔다(상업용만 다룬다).
BEGIN;
ALTER TABLE app.ads
  ADD COLUMN IF NOT EXISTS deposit bigint,
  ADD COLUMN IF NOT EXISTS monthly_rent bigint,
  ADD COLUMN IF NOT EXISTS loan bigint,
  ADD COLUMN IF NOT EXISTS loan_open boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS move_in text CHECK (move_in IN ('즉시입주','협의','날짜')),
  ADD COLUMN IF NOT EXISTS move_in_on date;
COMMIT;
