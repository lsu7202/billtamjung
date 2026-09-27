-- 임대 내역 호실(2026-09-27 대표)
--   use 삭제       — 임대 내역엔 용도가 뜻이 없다. 무엇이 들었는지는 업종(cat_nodes, 0189)이 말한다
--   excl_area 추가 — 전용면적(㎡). 계약서엔 계약면적과 전용면적이 둘 다 적힌다. 공실·평당가 셈은 계약면적 그대로
--   ref.biz_cat.n  — 그 업종 마디 아래 지금 있는 업체 수. 업종 고르기 목록이 10곳 이상인 마디만 쓴다
BEGIN;
ALTER TABLE app.floor_rents DROP COLUMN IF EXISTS use;
ALTER TABLE app.floor_rents ADD COLUMN IF NOT EXISTS excl_area numeric;

DO $$
BEGIN
  IF to_regclass('ref.biz_cat') IS NOT NULL THEN
    ALTER TABLE ref.biz_cat ADD COLUMN IF NOT EXISTS n int;
    IF to_regclass('master.biz') IS NOT NULL THEN
      UPDATE ref.biz_cat c SET n = COALESCE(x.n, 0)
        FROM ref.biz_cat c2 LEFT JOIN (
          SELECT array_to_string(cat_nodes[1:k], ' > ') AS path, count(*) AS n
            FROM master.biz, generate_series(1, 5) k
           WHERE gone_on IS NULL AND cardinality(cat_nodes) >= k GROUP BY 1) x ON x.path = c2.path
       WHERE c.id = c2.id;
    END IF;
  END IF;
END $$;
COMMIT;
