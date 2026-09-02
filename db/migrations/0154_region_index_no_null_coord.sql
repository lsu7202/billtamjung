-- region_index 가 좌표 없는 동을 내놓지 않게 한다 (2026-09-02).
--
-- ## 왜
--
-- 이 구체화뷰는 동마다 `avg(st_x(geom))` 로 중심 좌표를 낸다. 그런데 그 동의 건물이
-- **전부 좌표가 없으면** avg() 가 NULL 을 준다. 그 한 행 때문에 주소 자동완성이
-- 통째로 죽어 있었다 — `_suggest_refs` 가 float + None 으로 터졌고(500),
-- 화면은 「일치하는 결과가 없습니다」로 조용히 넘어갔다.
--
--     종로구 교남동          건물 3동이 전부 좌표 없음
--     강남구 「194번지」      건물 1동 · 주소가 '서울특별시 강남구 194번지' 라
--                           split_part(addr,' ',3) 이 '194번지' 가 됐다
--
-- 코드 쪽은 이미 막았다(NULL 인 행을 버린다). 여기서는 **애초에 안 만들게** 한다.
-- 좌표가 없으면 지도를 그리로 옮길 수 없으니 후보로 내놔도 쓸모가 없다.
--
-- 「194번지」 같은 깨진 동 이름은 건물 주소 자체가 이상한 것이라 여기서 안 고친다
-- (1동뿐이고, 원장을 우리 판단으로 손대지 않는 것이 규칙이다). 좌표가 없어 어차피 빠진다.

BEGIN;

DROP MATERIALIZED VIEW IF EXISTS master.region_index;

CREATE MATERIALIZED VIEW master.region_index AS
  SELECT sgg_code,
         bjd_code,
         split_part(addr, ' ', 2) AS gu,
         split_part(addr, ' ', 3) AS dong,
         avg(st_x(geom)) AS lng,
         avg(st_y(geom)) AS lat,
         count(*) AS cnt
    FROM master.buildings
   WHERE bjd_code IS NOT NULL AND sgg_code IS NOT NULL
   GROUP BY sgg_code, bjd_code, split_part(addr, ' ', 2), split_part(addr, ' ', 3)
   -- 좌표를 못 내는 동은 아예 내놓지 않는다. cnt 는 건물 수라 그대로 둔다.
  HAVING avg(st_x(geom)) IS NOT NULL AND avg(st_y(geom)) IS NOT NULL;

-- 0028 이 단 유니크 인덱스를 그대로 되살린다. REFRESH MATERIALIZED VIEW CONCURRENTLY
-- 가 이 인덱스를 요구한다 — 없으면 갱신할 때 뷰가 잠긴다.
CREATE UNIQUE INDEX IF NOT EXISTS region_index_uix
  ON master.region_index (sgg_code, bjd_code, gu, dong);

COMMENT ON MATERIALIZED VIEW master.region_index IS
  '동·구 중심좌표와 건물 수 — 주소 자동완성이 읽는다. '
  '좌표를 못 내는 동은 뺀다(0154): 지도를 옮길 수 없어 후보로 쓸모가 없고, '
  '그 NULL 한 행이 자동완성 전체를 죽였다.';

COMMIT;
