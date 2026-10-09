-- 0211 옛 시장 호가 지우기 (2026-10-04 대표)
-- crawl_listing(0191) 은 7월 임대 크롤 6.7만 건을 한 번 실은 표였다 — 날짜 · 출처 번호 · 매매가 없다.
-- 매매시세 · 임대시세(0210 market_sale · market_rent)가 자리를 넘겨받았다. 읽는 코드 없음 · 걸린 표 없음.
-- master._crawl_clean 은 남긴다 — 임대 추정 백테스트의 잣대다(rent-crawl-bench).
BEGIN;
DROP TABLE master.crawl_listing;
COMMIT;
