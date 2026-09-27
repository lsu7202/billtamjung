-- 임대 내역 호실에 업종 나무(2026-09-27 대표) — 층별 정보의 업체와 같은 모양으로 보인다.
-- cat_nodes = 업종 조상까지 펼친 것(「음식점 > 중식」 → {음식점,중식}), master.biz.cat_nodes 와 같은 칸.
-- 매물 등록 때 크롤링 업체를 복사하며 같이 들어온다. 팀이 직접 만든 호실은 null.
BEGIN;
ALTER TABLE app.floor_rents ADD COLUMN IF NOT EXISTS cat_nodes text[];

-- 이미 복사된 호실 채우기 — 같은 건물(필지)의 같은 이름 업체. master.biz 가 없는 환경(적재 전)은 건너뛴다
DO $$
BEGIN
  IF to_regclass('master.biz') IS NOT NULL THEN
    UPDATE app.floor_rents fr SET cat_nodes = x.cat_nodes
      FROM (SELECT DISTINCT ON (f.id) f.id, b.cat_nodes
              FROM app.floor_rents f JOIN master.biz b
                ON b.name_norm = f.place_ref AND f.building_pk = ANY(b.building_pks) AND b.gone_on IS NULL
             WHERE f.place_ref IS NOT NULL AND b.cat_nodes IS NOT NULL
             ORDER BY f.id, b.id) x
     WHERE fr.id = x.id AND fr.cat_nodes IS NULL;
  END IF;
END $$;
COMMIT;
