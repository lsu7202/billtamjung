-- 0194 매도 문의의 「팔려는 건물 주소」(대표 09-28 가안) — 광고를 보던 사람이 자기 건물을 팔아 달라고 할 때.
-- 비워도 된다. 고객등록을 누르면 이 주소로 매물 담기 창이 열린다.
ALTER TABLE app.inquiries ADD COLUMN IF NOT EXISTS sell_addr text;
