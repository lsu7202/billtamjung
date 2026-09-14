-- 총괄표제부(단지) 표 신설 — 대장을 100% 싣는다(2026-08-31).
--
-- 건축물대장은 세 층이다: **총괄표제부(단지) · 표제부(동) · 전유부(호실)**.
-- 우리는 표제부만 실었고, 총괄표제부는 대지면적·건폐율·용적률 세 칸만 빌려 쓰고 버렸다.
-- 그래서 두 가지가 우리 데이터에 없었다:
--   ① 단지명 — 「헬리오시티」「현대아파트」로 부를 이름이 없다
--   ② 동별 표제부가 없는 33곳 — 학교·관공서·군시설. 총괄표제부에만 있어 건물로 안 보인다
-- 부속지번 마트는 단지 단위 필지 관계도 싣는데 받을 표가 없어, building_parcels 에
-- 갈 곳 없는 14,255행(단지 3,669개)이 떠 있었다. 이제 갈 곳이 생긴다.
--
-- **동(buildings)과 섞지 않는다.** 단위가 다르다 — 단지는 여러 동을 묶은 것이고,
-- 계약서·확인설명서가 가리키는 것은 동이다. 검색·화면의 기본 단위는 그대로 동이다.
-- 단지는 「이 건물이 속한 단지」로 옆에 서고, 동이 없는 33곳에서만 홀로 선다.
--
-- 레이아웃은 정의서에 없어(mart-layout.md ⬜) 표제부 동 합계와 대조해 확정했다.
-- 헬리오시티(168동)에서 건축면적·연면적·용적산정이 동 합계와 **정확히** 일치한다.
-- 자리: data/tools/build_complex.py · pipeline/export_complex.py

BEGIN;

-- 적재는 세대 스왑(v1↔v2)이라 **물리표는 _v1, 읽는 이름은 뷰**다(sales_history 와 같은 규약).
CREATE TABLE IF NOT EXISTS master.building_complex_v1 (
  complex_pk      text PRIMARY KEY,     -- 총괄표제부 관리PK(표제부 PK 와 다른 계열)
  ledger_kind     text,                 -- 일반 | 집합
  pnu             text,                 -- 대표 필지. 나머지는 building_parcels 가 잇는다
  addr            text NOT NULL,
  addr_full       boolean,              -- 주소가 '서울특별시…' 로 완전한가(98.7%).
                                        -- 1.3%(246건)는 지번만 있다 — 지어내지 않고 표시만 나눈다
  road_addr       text,
  name            text,                 -- 단지명 — 「헬리오시티」. 38.9% 만 있다
  sgg_code        text,
  bjd_code        text,
  land_area       numeric,              -- 대지면적(㎡). 단지 전체
  build_area      numeric,              -- 건축면적(㎡) = 동 합계
  bcr             numeric,              -- 건폐율(%) = build_area / land_area
  total_area      numeric,              -- 연면적(㎡) = 동 합계
  far_area        numeric,              -- 용적률산정연면적(㎡) = 동 합계
  far             numeric,              -- 용적률(%) = far_area / land_area
  main_use        text,
  main_use_name   text,
  etc_use         text,
  households      int,                  -- 세대수
  families        int,                  -- 가구수
  main_bldg_cnt   int,                  -- 주건축물 수
  annex_bldg_cnt  int,                  -- 부속건축물 수  (둘의 합 = 동수)
  parking         int,                  -- 총주차(옥내기계·옥외기계·옥내자주·옥외자주 합)
  permit_ymd      date,
  start_ymd       date,
  approval_ymd    date,
  updated         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS building_complex_pnu_idx  ON master.building_complex_v1 (pnu);
CREATE INDEX IF NOT EXISTS building_complex_bjd_idx  ON master.building_complex_v1 (bjd_code);
-- 단지명 검색 — 있는 것만(38.9%) 색인해 작게 유지한다
CREATE INDEX IF NOT EXISTS building_complex_name_idx ON master.building_complex_v1 (name)
  WHERE name IS NOT NULL;

CREATE OR REPLACE VIEW master.building_complex AS SELECT * FROM master.building_complex_v1;

COMMENT ON VIEW master.building_complex IS
  '건축물대장 총괄표제부(단지). 표제부(master.buildings, 동)와 단위가 다르다 — 섞지 않는다.';
COMMENT ON COLUMN master.building_complex_v1.addr_full IS
  '주소가 완전한가. false 면 지번만 있는 원문이다(246건) — 앞부분을 지어내지 않았다는 표시.';
COMMENT ON COLUMN master.building_complex_v1.name IS
  '단지명. 38.9% 만 있다 — 없는 것을 주소로 대신 채우지 않는다.';

COMMIT;
