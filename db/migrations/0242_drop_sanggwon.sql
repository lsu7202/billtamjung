-- 상권 세 갈래 삭제 (2026-10-07 대표)
--
-- 부동산원 상권  master.sanggwon(72칸) · sanggwon_rent_series(임대동향 분기 임대료) · building_sanggwon(0239)
--               읽는 곳이 모델 묶음 「임대추이」 하나였다(화면 안 씀 · 추정가 안 씀). 그 묶음을 뺐다.
-- 서울시 상권    master.trade_area(1,650칸) — 지운 추정임대가 쓰던 것. 읽는 곳 없음.
-- 상권 구성(업체 7갈래)은 표가 없다 — core/market.py 질의와 /pop 의 cat · mix 를 코드에서 뺐다.
-- 0167(ai 역할)·0169(표 설명)이 이름을 적어 두었지만 그 마이그레이션은 이미 돌았다 — 표가 없으면 다시 돌 일이 없다.

BEGIN;
DROP TABLE IF EXISTS master.building_sanggwon;
DROP TABLE IF EXISTS master.sanggwon_rent_series;
DROP TABLE IF EXISTS master.sanggwon;
DROP TABLE IF EXISTS master.trade_area;
COMMIT;
