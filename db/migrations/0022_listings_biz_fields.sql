-- 업무(listings) 필드 확장 — S02 업무탭 편집 + S01b 필터 대상.
-- 기존 컬럼(status,urgency,grade,ipji,owner_type,relation,cooperation,kindness,intent,owner_phone,listing_no,received_on)에
-- 명도·용도변경·멸실·노후도·건물용도 추가(그동안 UI엔 있으나 저장 컬럼 없어 미작동).
ALTER TABLE app.listings
  ADD COLUMN IF NOT EXISTS meongdo      text,   -- 명도
  ADD COLUMN IF NOT EXISTS use_change   text,   -- 용도변경 가능성
  ADD COLUMN IF NOT EXISTS myeolsil     text,   -- 멸실
  ADD COLUMN IF NOT EXISTS nohudo       text,   -- 노후도
  ADD COLUMN IF NOT EXISTS building_use text;   -- 건물용도(활용 유형: 수익률/신축용/사옥용/리모델링용)
