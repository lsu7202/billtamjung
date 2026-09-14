-- 0032 브리핑 자료 준비 — 사무소 정보 + 서류/사진 분류
--
-- 브리핑은 '그 건물에 대한 사실'만 담는 기초자료다(우리 판단을 서술하는 빌탐정 리포트와 반대).
-- 원본(specs/03-features/브리핑자료.pptx)을 뜯어보니 7장 중 5장이 이미지 슬롯이었다.
--   표지 · 개요표+건물사진 · 토지이용계획확인원|건축물대장 · 지적도 · 임대내역 · 건물사진2 · 마무리
-- 그래서 (1)서류 종류 구분 (2)슬롯에 맞추는 배치값 (3)표지·마무리에 넣을 사무소 정보가 필요하다.

-- ── 사무소 정보(표지·마무리·문서 하단) ──
-- 팀 단위로 둔다. 브리핑을 받는 쪽이 보는 건 '어느 중개사무소가 준 자료인가'라서.
ALTER TABLE app.teams
  ADD COLUMN IF NOT EXISTS office_name text,      -- 상호(예: The 두꺼비 부동산)
  ADD COLUMN IF NOT EXISTS agent_name  text,      -- 담당자명
  ADD COLUMN IF NOT EXISTS agent_title text,      -- 직함(이사·대표 등)
  ADD COLUMN IF NOT EXISTS phone       text,
  ADD COLUMN IF NOT EXISTS fax         text,
  ADD COLUMN IF NOT EXISTS email       text,
  ADD COLUMN IF NOT EXISTS office_addr text,
  ADD COLUMN IF NOT EXISTS logo_path   text;      -- 스토리지 키

-- ── 서류/사진 분류 ──
-- kind가 없어서 '이건 건축물대장, 저건 외관 사진'을 구분할 수 없었다.
DO $$ BEGIN
  CREATE TYPE app.photo_kind AS ENUM (
    'exterior',        -- 건물 외관
    'interior',        -- 내부
    'land_use',        -- 토지이용계획확인원
    'building_ledger', -- 건축물대장
    'cadastral',       -- 지적도·위치도
    'etc');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE app.photos
  ADD COLUMN IF NOT EXISTS kind       app.photo_kind NOT NULL DEFAULT 'exterior',
  ADD COLUMN IF NOT EXISTS caption    text,
  ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0,
  -- 슬롯 배치값 — 원본 슬롯이 3.75x5.92 / 4.76x5.91 / 4.20x6.49처럼 세로가 길다.
  -- 세로 스캔본과 가로 사진이 섞여 들어오므로 잘라내지 않고 사용자가 맞춘 값을 그대로 쓴다.
  -- {zoom: 1.0, x: 0.5, y: 0.5}  — x·y는 0~1 초점 위치(object-position과 같은 의미)
  ADD COLUMN IF NOT EXISTS transform  jsonb;

CREATE INDEX IF NOT EXISTS photos_kind_idx
  ON app.photos (building_pk, team_id, kind, sort_order) WHERE deleted_at IS NULL;

COMMENT ON COLUMN app.photos.transform IS
  '업로드 시 사용자가 맞춘 슬롯 배치 {zoom,x,y}. 원본은 그대로 두고 표시에서만 적용(마스터 불변 원칙과 동일).';
