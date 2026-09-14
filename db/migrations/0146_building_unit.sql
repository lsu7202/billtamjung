-- 호실(전유부) 표 신설 — 집합건물의 호 단위(2026-08-31).
--
-- 지금까지 우리 데이터의 제일 작은 단위는 **층**이었다(master.floor_outline).
-- 집합건물은 한 층에 여러 호실이 있고 실제 거래·임대는 **호 단위**로 일어난다.
-- 그 칸이 통째로 비어 있었다 — 오피스텔 38.8만 호가 화면에 안 잡혔다.
--
-- 대장이 두 마트로 나눠 주는 것을 하나로 합쳤다:
--   전유부(0309)       호실의 신원 — 동·호·층. 면적이 없다
--   전유공용면적(0306)  그 호실의 면적 — 전유/공용으로 여러 줄
--
-- **전유면적과 공용면적을 따로 둔다.** 합치면 둘 다 못 쓴다 —
-- 임대료는 전유로, 관리비는 공용으로 계산한다.
-- 실측(서울 378만 호): 전유 243.3백만㎡ · 공용 152.4백만㎡ · 전용률 61.5%
--
-- 용도·구조는 **전유 줄에서만** 가져왔다. 공용 줄의 용도(계단실·주차장)를 쓰면
-- 아파트가 '주차장'이 된다.
--
-- 자리: data/tools/build_expos.py · pipeline/export_expos.py

BEGIN;

-- 적재는 세대 스왑(v1↔v2)이라 **물리표는 _v1, 읽는 이름은 뷰**다(building_complex 와 같은 규약).
CREATE TABLE IF NOT EXISTS master.building_unit_v1 (
  unit_pk       text PRIMARY KEY,      -- 전유부 관리PK. 호실 하나에 하나씩 붙는다
  pnu           text,                  -- 필지. 건물이 아니라 땅에 붙는다
  ledger_kind   text,                  -- 집합 (전유부는 집합건물에만 있다)
  ledger_type   text,                  -- 전유부
  addr          text,
  road_addr     text,
  bldg_name     text,                  -- 건물명 — 「청운벽산빌리지」
  dong          text,                  -- 동명칭 — 「5동」. 60% 만 있다(단동 건물은 비어 있다)
  ho            text,                  -- 호명칭 — 「523호」
  floor_kind    text,                  -- 지상 · 지하
  floor         int,                   -- 부호 있는 층. 지하는 음수
  floor_raw     text,                  -- 원본 층번호 — 못 알아본 표기를 지어내지 않는다
  excl_area     numeric,               -- 전유면적(㎡)
  common_area   numeric,               -- 공용면적(㎡)
  main_use      text,                  -- 주용도 — 전유 줄 기준
  etc_use       text,
  structure     text,
  created_ymd   date,                  -- 대장 생성일자
  updated       timestamptz DEFAULT now()
);

-- 건물 화면에서 「이 필지의 호실」을 뽑는 길
CREATE INDEX IF NOT EXISTS building_unit_pnu_idx  ON master.building_unit_v1 (pnu);
-- 층별 화면에서 「이 층의 호실」
CREATE INDEX IF NOT EXISTS building_unit_fl_idx   ON master.building_unit_v1 (pnu, floor);
-- 용도별 집계 — 오피스텔·사무소만 뽑는 일이 잦다
CREATE INDEX IF NOT EXISTS building_unit_use_idx  ON master.building_unit_v1 (main_use);

CREATE OR REPLACE VIEW master.building_unit AS SELECT * FROM master.building_unit_v1;

COMMENT ON VIEW master.building_unit IS
  '건축물대장 전유부(호실). 층(master.floor_outline)보다 한 단계 아래 — 단위를 섞지 않는다.';
COMMENT ON COLUMN master.building_unit_v1.excl_area IS
  '전유면적. 임대료 산정의 분모. 공용과 합치지 말 것.';
COMMENT ON COLUMN master.building_unit_v1.common_area IS
  '공용면적. 관리비 산정의 분모. 97.5% 만 있다.';
COMMENT ON COLUMN master.building_unit_v1.dong IS
  '동명칭. 60% 만 있다 — 단동 건물은 원래 비어 있다. 없는 것을 지어내지 않는다.';

COMMIT;
