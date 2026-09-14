-- 0136 · 필지 규제 전부 담기 (2026-08-28)
--
-- 지금까지 규제를 reg_godo·reg_district·reg_jeongbi·reg_gyeong·reg_banghwa·reg_munhwa
-- 여섯 칸에만 담았다. 국토부 토지이용계획정보 원장(AL_D155)을 받아 보니 서울 필지에 걸린
-- 지역·지구등이 317종인데, 여섯 칸에 담기는 건 건수로 6.6% 뿐이었다.
--
-- 버려지던 것 중에 실무가 먼저 보는 것들이 있다:
--   토지거래계약에관한허가구역 90.2만(매매에 허가가 필요하다) · 대공방어협조구역 81.5만(고도 제한)
--   상대·절대보호구역 46.6만(유흥·숙박 업종 제한) · 중점경관관리구역 22.7만(높이·디자인 심의)
--   가로구역별 최고높이 제한 6.7만 · 건축허가·착공제한지역 6.7만 · 개발제한구역 3.8만
--
-- 근거는 「토지이용규제 기본법」 제5조의 지역·지구등이고, 원장의 코드 접두가 근거 법률로 갈린다
-- (UQA/UQQ 국토계획법 · UNE 군사기지법 · UOA 교육환경보호법 · ZQ0/ZA0 서울시 조례 …).
--
-- 저촉여부는 「포함·저촉」만 담는다. 「접함」은 토지이음도 용도지역 칸에 안 세고,
-- 표본 2,857필지 대조에서 접함까지 넣으면 일치율이 100% → 86.87% 로 떨어졌다.

ALTER TABLE master.parcels_v2
  ADD COLUMN IF NOT EXISTS regulations jsonb;   -- [{"명":…, "코드":…, "저촉":"포함|저촉"}…]

COMMENT ON COLUMN master.parcels_v2.regulations IS
  '토지이용계획정보 원장(AL_D155)의 지역·지구등 전부. 용도지역 16종은 use_zone 이 따로 갖는다.';

CREATE INDEX IF NOT EXISTS parcels_v2_regulations_gin
  ON master.parcels_v2 USING gin (regulations jsonb_path_ops);

-- parcels 뷰 재정의 — 새 칸을 밖으로 낸다
CREATE OR REPLACE VIEW master.parcels AS
  SELECT pnu, building_pk, geom, uqa, area, is_rep, jimok, land_use, slope, shape,
         road_frontage, use_zone, legal_bcr, legal_far, gongsi_latest,
         reg_godo, reg_district, reg_jeongbi, reg_gyeong, reg_banghwa, reg_munhwa,
         regulations
    FROM master.parcels_v2;
