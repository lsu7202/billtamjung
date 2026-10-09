-- 실거래 유형 · 매물유형을 따로 (2026-10-08 · 스펙 12 §1-5)
--
-- 둘은 다른 것이다. 실거래 유형은 신고 서식이 정한 갈래, 매물유형은 매물을 올린 사람(팀 · 네이버 중개사)이 고른 갈래.
-- 같은 건물이라도 둘이 다르다(청담동 16: 네이버 「빌딩」 · 대장 단독주택 · 실거래 단독다가구). 칸도 사전도 따로 두고
-- 서로를 읽지 않는다. 대장으로 센 유형(building_derived.use_kind)은 어느 쪽에도 안 쓴다(0247 에서 지운다).
--
-- master.trade.trade_type   실거래 원천 칸(파일 갈래 · 유형 · 건축물주용도)만으로 정한다. 대장 안 봄.
--                           아파트 · 분양입주권은 비운다(거래 대상 아님). 원천 칸은 옆에 그대로 남는다.
-- master.trade_parcel       지번에 붙은 거래 전부(통매 · 호실 · 토지). 해제 · 0원 제외. 화면 · 상세가 읽는다.
--                           use_label = 원천 건축물주용도, 없으면(주택 · 오피스텔 · 토지) 실거래 유형.
--                           trade_whole(통매만)은 추정가 · 집계용으로 그대로 둔다.
-- ref.enums building_major  매물유형 아홉 칸. meta.naver = 이 칸으로 들어오는 네이버 유형 원문.
--                           팀이 안 고르면 비운다(대장으로 채우지 않는다).

BEGIN;

-- ── 실거래 유형 ──
INSERT INTO ref.enum_groups (enum_key, label) VALUES ('trade_type', '실거래 유형') ON CONFLICT DO NOTHING;
INSERT INTO ref.enums (enum_key, code, label, sort_order) VALUES
  ('trade_type', '상업용건물',  '상업용건물',  10),
  ('trade_type', '상가/사무실', '상가/사무실', 20),
  ('trade_type', '단독/다가구', '단독/다가구', 30),
  ('trade_type', '연립/다세대', '연립/다세대', 40),
  ('trade_type', '오피스텔',    '오피스텔',    50),
  ('trade_type', '토지',        '토지',        60),
  ('trade_type', '공장/창고',   '공장/창고',   70),
  ('trade_type', '숙박시설',    '숙박시설',    80),
  ('trade_type', '기타건물',    '기타건물',    90)
ON CONFLICT DO NOTHING;

ALTER TABLE master.trade DROP COLUMN IF EXISTS trade_type;
ALTER TABLE master.trade ADD COLUMN trade_type text GENERATED ALWAYS AS (
  CASE kind
    WHEN '상업업무용' THEN CASE
      WHEN main_use = '숙박' THEN '숙박시설'
      WHEN deal_kind = '집합' THEN '상가/사무실'
      WHEN main_use IN ('기타', '교육연구') THEN '기타건물'
      ELSE '상업용건물' END
    WHEN '단독다가구' THEN '단독/다가구'
    WHEN '연립다세대' THEN '연립/다세대'
    WHEN '오피스텔'   THEN '오피스텔'
    WHEN '토지'       THEN '토지'
    WHEN '공장창고'   THEN '공장/창고'
  END) STORED;
COMMENT ON COLUMN master.trade.trade_type IS
  '실거래 유형(ref.enums trade_type). 원천 칸(kind · deal_kind · main_use)만으로 정한다. 아파트 · 분양입주권은 비움';

CREATE VIEW master.trade_parcel AS
SELECT t.id AS trade_id, m.pnu, m.method, t.trade_type, COALESCE(t.main_use, t.trade_type) AS use_label,
       t.kind, t.deal_kind, t.contract_ym, t.contract_day, t.price_won AS price,
       t.total_area, t.excl_area, t.land_area, t.floor, t.build_year, t.share, t.complex_name
  FROM master.trade t
  JOIN master.trade_match m ON m.trade_id = t.id
 WHERE t.trade_type IS NOT NULL AND t.canceled_on IS NULL AND t.price_won > 0;
COMMENT ON VIEW master.trade_parcel IS
  '지번에 붙은 실거래 전부(통매 · 호실 · 토지). 해제 · 0원 · 아파트 · 분양입주권 제외. use_label = 원천 용도, 없으면 실거래 유형';

-- ── 매물유형 ──
DELETE FROM ref.enums WHERE enum_key = 'building_major';
INSERT INTO ref.enums (enum_key, code, label, sort_order, meta) VALUES
  ('building_major', '상업용건물',  '상업용건물',  10, '{"naver": ["빌딩", "상가건물", "상가주택"]}'),
  ('building_major', '상가/사무실', '상가/사무실', 20, '{}'),
  ('building_major', '단독/다가구', '단독/다가구', 30, '{}'),
  ('building_major', '연립/다세대', '연립/다세대', 40, '{}'),
  ('building_major', '오피스텔',    '오피스텔',    50, '{}'),
  ('building_major', '토지',        '토지',        60, '{}'),
  ('building_major', '공장/창고',   '공장/창고',   70, '{"naver": ["공장·창고"]}'),
  ('building_major', '숙박시설',    '숙박시설',    80, '{"naver": ["숙박"]}'),
  ('building_major', '기타건물',    '기타건물',    90, '{}');

-- 네이버 유형 원문(load_market.py TYPE_NAME) → 매물유형. 새 유형을 수집하면 그 원문을 meta.naver 에 더한다.
-- 대응은 이 사전 한 곳에만 있다.
-- 모르는 원문이면 NULL(지어내지 않는다)
CREATE OR REPLACE FUNCTION app.naver_major(p text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT code FROM ref.enums WHERE enum_key = 'building_major' AND meta->'naver' ? p LIMIT 1
$$;


COMMIT;
