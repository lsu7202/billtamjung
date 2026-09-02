-- 0132 좌표 없는 건물도 살린다 — buildings.geom NOT NULL 해제(2026-08-27)
--
-- 원천 서울 표제부 585,896동 중 DB 에 560,016동만 있었다.
-- `pipeline/export_seoul.py` 가 「좌표 없으면 제외(지도 필수)」로 25,880동을 버려서다.
-- 원천 연속지적도에 그 PNU 가 없는 것이 원인인데(종로구 내수동 202-1 은 없고 202-2 도로만 있다),
-- **지적도가 없다고 건물이 없는 것은 아니다** — 대장·면적·용도·층수는 다 아는데 위치만 모른다.
-- 스물다섯 자치구에 골고루 4.5%다.
--
-- 이제 좌표만 비우고 건물은 넣는다. 이웃 필지 좌표로 근사하지 않는다 —
-- 지도에 찍히면 정확한 자리로 읽히고, 그건 「모른다」보다 나쁘다.
-- PostGIS 공간조건(ST_DWithin·ST_Within)은 NULL 입력에 NULL 을 돌려주고 WHERE 는 그것을
-- 거짓으로 보므로, 지도 검색·반경 comp 에서 알아서 빠진다. 따로 가드를 달 필요가 없다.

ALTER TABLE master.buildings_v2 ALTER COLUMN geom DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='master' AND table_name='buildings_v1') THEN
    ALTER TABLE master.buildings_v1 ALTER COLUMN geom DROP NOT NULL;
  END IF;
END $$;
