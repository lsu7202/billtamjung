-- 필지 규제 이름 사전(2026-09-22). 모델 검색의 「규제」 조건이 값 목록(막이·스키마 enum)으로 읽는다.
-- 898k 필지 × 규제 열 개를 요청 때 세면 statement_timeout 에 걸려 표로 둔다.
-- 필지(master.parcels)를 다시 적재하면 아래 INSERT 를 그대로 다시 돌린다(파이프라인 적재 마디).
CREATE TABLE IF NOT EXISTS master.regulation_names (
  name      text PRIMARY KEY,
  buildings integer NOT NULL      -- 그 규제가 걸린 건물 수(필지 하나라도)
);
TRUNCATE master.regulation_names;
INSERT INTO master.regulation_names (name, buildings)
SELECT e->>0, count(DISTINCT p.building_pk)
  FROM master.parcels p, jsonb_array_elements(p.regulations) e
 WHERE p.building_pk IS NOT NULL AND e->>0 IS NOT NULL
 GROUP BY 1;
