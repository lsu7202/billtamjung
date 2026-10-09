-- 0209 · 광고 값은 매물에 한 번만(10-02 대표) — 광고 폼과 실제 광고(사이드바)가 서로 다른 칸을 보던 것.
-- 매물 유형(ads.use_type ↔ listings.building_major) · 중개(ads.brokerage ↔ listings.exclusive)
-- · 보증금 · 월세(ads 복사본 ↔ 임대내역 합계) · 융자금 · 입주가능일(광고에만 있던 것)을 매물 줄이 정본으로 갖는다.
-- 광고는 읽기만. ads 의 옛 칸은 남겨 두되 더 읽지 않는다(지우기는 따로).
ALTER TABLE app.listings
  ADD COLUMN IF NOT EXISTS loan       bigint,
  ADD COLUMN IF NOT EXISTS loan_open  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS move_in    text CHECK (move_in IN ('즉시입주', '협의', '날짜')),
  ADD COLUMN IF NOT EXISTS move_in_on date;

-- 옮기기 — 매물마다 가장 최근 광고(삭제 뺌)의 값. 매물 쪽이 비어 있을 때만 채운다(매물 값이 이긴다)
WITH a AS (
  SELECT DISTINCT ON (listing_id) listing_id, use_type, brokerage, loan, loan_open, move_in, move_in_on
    FROM app.ads WHERE state <> '삭제' AND listing_id IS NOT NULL
   ORDER BY listing_id, (state IN ('노출','비노출')) DESC, id DESC)
UPDATE app.listings l
   SET building_major = COALESCE(l.building_major, a.use_type),
       exclusive      = COALESCE(l.exclusive, a.brokerage = '전속'),
       loan           = COALESCE(l.loan, a.loan),
       loan_open      = COALESCE(a.loan_open, l.loan_open),
       move_in        = COALESCE(l.move_in, a.move_in),
       move_in_on     = COALESCE(l.move_in_on, a.move_in_on)
  FROM a WHERE a.listing_id = l.id;
