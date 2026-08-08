-- 0034 건물 높이(m)
--
-- 입체 지적도가 높이를 '층수 × 3.5m'로 가정해 세우고 있었다. 브리핑은 사실만 담는 자료인데
-- 화면에는 「28m」로 단정해 나갔다. 1층 상가·주차층이 끼면 층고 3.5m는 쉽게 2~3m 틀린다.
--
-- 실제 높이는 이미 우리가 내려받는 원천에 있다 — 건축HUB 표제부 42번 컬럼(높이, m).
-- master.buildings에만 안 실어놨을 뿐이다(specs/04-data/mart-layout.md §42).
--   확보율 56.2%(서울 표본 40만행) · 중앙값 12.0m
--   원본 오류가 섞여 있어 적재 전에 버린다: h≤1m·h>600m, 층당 2~8m 밖(build_building_master._height)
-- 없는 건물은 NULL로 둔다. 가정값을 사실처럼 내보내지 않는다 — 화면에서도 높이 치수를 안 그린다.
--
-- 버전 테이블 모두에 넣는다: 라이브(v가 최신)와 다음 스왑 대상 모두.
-- loader가 CREATE TABLE (LIKE ... INCLUDING ALL)로 새 버전을 만들므로 라이브에 있으면 상속된다.

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'master' AND table_name ~ '^buildings_v\d+$'
  LOOP
    EXECUTE format('ALTER TABLE master.%I ADD COLUMN IF NOT EXISTS height numeric', t);
  END LOOP;
END $$;

-- 뷰는 컬럼 목록을 고정하므로 다시 만든다(CREATE OR REPLACE는 컬럼 추가를 허용한다).
DO $$
DECLARE v int;
BEGIN
  SELECT max(substring(table_name from '_v(\d+)$')::int) INTO v
  FROM information_schema.tables
  WHERE table_schema = 'master' AND table_name ~ '^buildings_v\d+$';
  EXECUTE format('CREATE OR REPLACE VIEW master.buildings AS SELECT * FROM master.buildings_v%s', v);
END $$;
