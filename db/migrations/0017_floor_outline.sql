-- 0017_floor_outline.sql — 층별개요(대장) 프리필 마스터
-- 원천: mart_djy_04_seoul.txt(층별개요) idx0=PK·idx21=층·idx26=용도·idx28=전용면적(㎡).
-- 용도: 층별임대정보 입력 시 층·용도·전용면적을 대장값으로 프리필(사용자는 계약면적·금액만 입력).
-- 마스터 불변 참조 데이터(팀 오버레이 아님) — build_floor_outline로 적재.
BEGIN;

CREATE TABLE IF NOT EXISTS master.floor_outline (
  id             bigserial PRIMARY KEY,
  building_pk    text    NOT NULL,
  seq            int     NOT NULL,        -- 원본 행 순서(층 정렬용)
  floor          text,                    -- 층(1층·지하층 등)
  use            text,                    -- 층별 용도명
  exclusive_area numeric                  -- 전용면적 ㎡
);
CREATE INDEX IF NOT EXISTS floor_outline_pk ON master.floor_outline (building_pk);

COMMIT;
