-- 지번 주소 함수 · 문의 · 저장의 건물 번호 칸을 지운다 (2026-10-08 · 스펙 12 §3-3)
-- 문의 · 저장의 building_pk 는 주소를 찾는 데만 썼다. 주소는 매물(listing_parcels 대표 지번) · 구해요(seeks.pnu) 의 지번에서 읽는다.
-- 두 표 모두 0줄(10-08).

BEGIN;

-- 지번 → 사람이 읽는 주소. 대표 동 주소, 동이 없으면 나대지 목록의 주소
CREATE OR REPLACE FUNCTION app.parcel_addr(p_pnu text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT b.addr FROM master.parcel_rep r JOIN master.buildings b ON b.building_pk = r.rep_pk WHERE r.pnu = p_pnu),
                  (SELECT v.addr FROM master.vacant_parcels v WHERE v.pnu = p_pnu))
$$;

ALTER TABLE app.inquiries DROP COLUMN IF EXISTS building_pk;
ALTER TABLE app.saves DROP COLUMN IF EXISTS building_pk;

COMMIT;
