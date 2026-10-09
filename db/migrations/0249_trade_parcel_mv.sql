-- trade_parcel 을 머티리얼라이즈드 뷰로 (2026-10-08 · 0246 뒤)
--
-- 보통 뷰(trade ⋈ trade_match)로 두니 검색 실거래 보기의 LATERAL 비용 추정이 1,800 으로 잡혀 플래너가 조인 순서를
-- 바꿨다 — 매물 CTE 를 건물마다 다시 훑어(2.2억 줄 버림) 강남 한 화면이 30초. 지번 · 계약월 색인을 단 MV 면
-- LATERAL 이 색인 한 번이다(같은 화면 1초 안). 적재(scripts/load_trades.py)가 실거래를 갈아 끼운 뒤 새로 고친다.

BEGIN;
DROP VIEW IF EXISTS master.trade_parcel;
CREATE MATERIALIZED VIEW master.trade_parcel AS
SELECT t.id AS trade_id, m.pnu, m.method, t.trade_type, COALESCE(t.main_use, t.trade_type) AS use_label,
       t.kind, t.deal_kind, t.contract_ym, t.contract_day, t.price_won AS price,
       t.total_area, t.excl_area, t.land_area, t.floor, t.build_year, t.share, t.complex_name
  FROM master.trade t
  JOIN master.trade_match m ON m.trade_id = t.id
 WHERE t.trade_type IS NOT NULL AND t.canceled_on IS NULL AND t.price_won > 0;
CREATE UNIQUE INDEX trade_parcel_id ON master.trade_parcel (trade_id);
CREATE INDEX trade_parcel_pnu_ym ON master.trade_parcel (pnu, contract_ym DESC, contract_day DESC NULLS LAST, trade_id DESC);
COMMENT ON MATERIALIZED VIEW master.trade_parcel IS
  '지번에 붙은 실거래 전부(통매 · 호실 · 토지). 해제 · 0원 · 아파트 · 분양입주권 제외. use_label = 원천 용도, 없으면 실거래 유형. load_trades.py 가 새로 고친다';
COMMIT;
