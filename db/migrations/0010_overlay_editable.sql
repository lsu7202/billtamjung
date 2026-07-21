-- 0010_overlay_editable.sql — 오버레이 정책 정정: 좌표·주소·식별자 외 전부 수정 가능
-- 컬럼정의서 원칙(사용자 확정): 폴리곤·주소·좌표 제외 모든 데이터가 유저 오버레이로 수정 가능.
-- ref.fields = enum 검증·라벨 메타(게이트 아님). editability는 차단목록으로만 판단.
BEGIN;

-- 1) 오버레이 field FK 제거(미등록 필드도 허용) — 실제 제약명은 overlays_field_fkey
ALTER TABLE app.overlays DROP CONSTRAINT IF EXISTS overlays_field_fkey;
ALTER TABLE app.overlays DROP CONSTRAINT IF EXISTS overlays_field_fk;

-- 2) 검증 트리거 재작성: 차단목록(식별·위치) 거부 + enum이면 코드 검증 + 나머지 허용
CREATE OR REPLACE FUNCTION app.validate_overlay() RETURNS trigger AS $$
DECLARE f ref.fields; BEGIN
  -- 불변 필드(수정 불가): 식별자·주소·좌표·폴리곤
  IF NEW.field IN (
    'building_pk','pnu','addr','road_addr','jibun_norm','geom','lng','lat',
    'sgg_code','bjd_code'
  ) THEN
    RAISE EXCEPTION '수정 불가 필드(식별·위치): %', NEW.field;
  END IF;
  -- 레지스트리에 있으면 메타 활용(enum 코드 검증)
  SELECT * INTO f FROM ref.fields WHERE field_key = NEW.field;
  IF FOUND AND f.data_type = 'enum' AND NEW.value IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM ref.enums e WHERE e.enum_key=f.enum_key AND e.code=NEW.value AND e.active)
  THEN RAISE EXCEPTION '유효하지 않은 enum 값: %=%', NEW.field, NEW.value; END IF;
  -- 미등록 필드·비enum = 자유값 허용(마스터 위 오버레이)
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- 3) editable 플래그는 이제 참고용(전부 true로 정규화 — enum/비enum 무관)
UPDATE ref.fields SET editable = true
  WHERE field_key NOT IN ('building_pk','pnu','addr','road_addr','geom','lng','lat','sgg_code','bjd_code');

COMMIT;
