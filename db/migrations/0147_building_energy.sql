-- 건물에너지(전기·가스) 표 신설 — 필지·월별 사용량(2026-09-01).
--
-- 국토부 건물에너지 통합 자료. 전기 570,689행 · 가스 396,752행 · 2026-01~04.
--
-- **열쇠가 건물이 아니라 주소다.** 대장 PK 가 아니라 PNU + 새주소일련번호로 온다.
-- 한 필지에 건물이 여럿이면 일련번호로 갈린다. 그래서 master.buildings 와 직접
-- 잇지 않는다 — 잇는 것은 나중 일이고, 지금은 원본 그대로 싣는다.
--
-- **전기와 가스를 한 표에 담는다.** 원본 칸이 완전히 같고(14칸) 성격도 같다.
-- kind 로 갈라 두면 「이 건물의 에너지」를 한 번에 읽는다. 따로 두면 매번 두 번 조회한다.
--
-- 단위는 둘 다 kWh 다 — 가스도 환산되어 온다(원본 칸 이름이 `사용량(KWh)`).
-- 사용량 0 은 「안 썼다」는 사실이지 결측이 아니다. 그대로 싣는다.
--
-- 자리: data/tools/build_energy.py · pipeline/export_energy.py

BEGIN;

-- 적재는 세대 스왑(v1↔v2)이라 **물리표는 _v1, 읽는 이름은 뷰**다.
CREATE TABLE IF NOT EXISTS master.building_energy_v1 (
  pnu           text NOT NULL,
  addr_seq      text,                  -- 새주소일련번호. 한 필지에 건물이 여럿일 때 가른다
  kind          text NOT NULL,         -- elec | gas
  use_ym        text NOT NULL,         -- YYYYMM
  usage_kwh     numeric,               -- 전기·가스 모두 kWh. 0 은 '안 썼다'는 사실
  addr          text,
  road_addr     text,
  sgg_code      text,
  bjd_code      text,
  updated       timestamptz DEFAULT now(),
  PRIMARY KEY (pnu, addr_seq, kind, use_ym)
);

-- 「이 필지의 에너지」 — 화면이 제일 자주 묻는 것
CREATE INDEX IF NOT EXISTS building_energy_pnu_idx ON master.building_energy_v1 (pnu, kind, use_ym);
-- 지역·월별 집계
CREATE INDEX IF NOT EXISTS building_energy_ym_idx  ON master.building_energy_v1 (use_ym, kind);

CREATE OR REPLACE VIEW master.building_energy AS SELECT * FROM master.building_energy_v1;

COMMENT ON VIEW master.building_energy IS
  '국토부 건물에너지(전기·가스) 월별 사용량. 열쇠는 건물 PK 가 아니라 PNU+새주소일련번호다.';
COMMENT ON COLUMN master.building_energy_v1.usage_kwh IS
  '전기·가스 모두 kWh. 가스도 환산값이다. 0 은 결측이 아니라 미사용.';
COMMENT ON COLUMN master.building_energy_v1.addr_seq IS
  '새주소일련번호. 한 필지에 건물이 여럿일 때 이것으로 갈린다 — PK 의 일부다.';

COMMIT;
