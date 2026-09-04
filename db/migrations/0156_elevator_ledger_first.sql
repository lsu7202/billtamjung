-- 승강기는 대장이 본값. 승강기공단 값은 참조 칸으로 옮긴다 (2026-09-04).
--
-- ## 왜
--
-- 빌더가 대장 승용승강기수가 비었을 때 한국승강기안전공단 설치현황으로 `elevator` 를
-- **덮어썼다**. 그래서 화면의 「엘리베이터」가 대장과 다른 값을 보였다.
-- 화면 값은 확인설명서·계약서로 그대로 이어지므로 본값 자리에는 대장이 서야 한다.
--
-- 공단 값을 버리지는 않는다. 대장이 비었을 때 중개인이 참고할 수 있어야 한다.
-- 다만 **옆에 참조로만** 선다. 건폐율·용적률의 계산값(master.building_calc)과 같은 취급이다.
--
-- 이 칸은 파이프라인이 다음에 buildings 를 다시 실을 때 채워진다.
-- 지금 있는 `elevator` 에는 덮어쓴 값이 섞여 있고, 그건 재적재 전에는 못 가른다.

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'master' AND c.relkind = 'r' AND c.relname LIKE 'buildings\_v%'
  LOOP
    EXECUTE format('ALTER TABLE master.%I ADD COLUMN IF NOT EXISTS elevator_ext integer', t);
    EXECUTE format('COMMENT ON COLUMN master.%I.elevator_ext IS %L', t,
      '승강기공단 설치현황 대수 — 참조용(0156). 본값은 elevator(대장 승용승강기수)');
  END LOOP;
END $$;
