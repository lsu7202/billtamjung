-- 폐쇄말소대장(사라진 건물) 표 신설(2026-09-01).
--
-- 철거·멸실되어 대장이 닫힌 건물. 현행 표제부에서는 사라졌고 여기에만 남는다.
-- 서울 346,377동 — 말소 293,574 · 폐쇄 28,986 · 일부말소 21,059 · 일부폐쇄 2,758.
--
-- **왜 갖고 있나.** 「건축물대장 주소인데 연속지적도에 없다」던 26,295건이 있었다.
-- 옛 주소를 물어보면 아무것도 안 나오거나, 사라진 건물이 우리 데이터에 남는다.
-- 닫힌 대장을 갖고 있어야 「왜 없는지」에 답할 수 있다.
-- 중개 실무에서도 그 자리에 무엇이 있었고 언제 헐렸는지는 신축 검토에 바로 쓰인다.
--
-- **현행 건물(master.buildings)과 절대 섞지 않는다.**
-- 관리번호 계열이 다르다 — 관리폐쇄말소대장PK 이지 관리건축물대장PK 가 아니다.
-- 화면에서도 「폐쇄」임을 반드시 표시해야 한다. 섞이면 없는 건물을 팔게 된다.
--
-- 「일부말소·일부폐쇄」는 건물의 일부만 닫힌 것이라 나머지는 살아 있다.
-- close_kind 를 보지 않고 「사라졌다」고 단정하면 안 된다.
--
-- 자리: data/tools/build_closed.py · pipeline/export_closed.py

BEGIN;

CREATE TABLE IF NOT EXISTS master.building_closed_v1 (
  closed_pk     text PRIMARY KEY,      -- 관리폐쇄말소대장PK. 현행 대장 PK 와 다른 계열
  pnu           text,
  close_kind    text,                  -- 말소 | 폐쇄 | 일부말소 | 일부폐쇄
  close_ymd     date,                  -- 폐쇄말소일. 93.7% 에 있다
  ledger_kind   text,
  ledger_type   text,
  addr          text,
  road_addr     text,
  bldg_name     text,
  dong          text,
  sgg_code      text,
  bjd_code      text,
  land_area     numeric,
  build_area    numeric,
  bcr           numeric,               -- 대장이 준 그대로. 100% 초과도 그대로 싣는다
  total_area    numeric,
  far_area      numeric,
  far           numeric,
  structure     text,
  main_use      text,
  main_use_name text,
  etc_use       text,
  floors_above  int,
  floors_below  int,
  height        numeric,
  households    int,
  families      int,
  ho_cnt        int,
  permit_ymd    date,
  start_ymd     date,
  approval_ymd  date,
  created_ymd   date,
  updated       timestamptz DEFAULT now()
);

-- 「이 필지에 있던 건물」 — 신축 검토에서 제일 먼저 묻는다
CREATE INDEX IF NOT EXISTS building_closed_pnu_idx  ON master.building_closed_v1 (pnu);
-- 「최근 헐린 것」
CREATE INDEX IF NOT EXISTS building_closed_ymd_idx  ON master.building_closed_v1 (close_ymd DESC);

CREATE OR REPLACE VIEW master.building_closed AS SELECT * FROM master.building_closed_v1;

COMMENT ON VIEW master.building_closed IS
  '폐쇄말소대장(사라진 건물). master.buildings 와 PK 계열이 다르다 — 섞지 말 것.';
COMMENT ON COLUMN master.building_closed_v1.close_kind IS
  '일부말소·일부폐쇄는 건물 일부만 닫힌 것이다. 보지 않고 사라졌다고 단정하면 안 된다.';

COMMIT;
