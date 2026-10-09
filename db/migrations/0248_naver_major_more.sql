-- 네이버 매매 수집을 넓힌 유형의 원문 → 매물유형 (2026-10-08 · 0246 뒤)
-- 원문 = scripts/market/load_market.py TYPE_NAME. 코드는 네이버 화면 REAL_ESTATE_TYPE 에서 확인.

BEGIN;
UPDATE ref.enums SET meta = jsonb_set(meta, '{naver}', v.naver) FROM (VALUES
  ('연립/다세대', '["빌라", "연립", "다세대", "도시형생활주택"]'::jsonb),
  ('단독/다가구', '["단독/다가구", "전원주택", "한옥주택"]'::jsonb),
  ('오피스텔',    '["오피스텔"]'::jsonb),
  ('토지',        '["토지"]'::jsonb)
) v(code, naver)
 WHERE enum_key = 'building_major' AND ref.enums.code = v.code;
COMMIT;
