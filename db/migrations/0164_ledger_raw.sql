-- 표제부 원문 보유 표 (2026-09-07)
--
-- ## 왜
-- 대표 원칙: 「최근대수선구분·건물명·세대수·내진 같은 것은 **화면에 닿을 필요가 없어서** 안 보이게
-- 한 것이다. 대신 **데이터로는 가지고 있어서** 추후 AI 가 활용할 수 있는 정보가 되어야 한다.」
--
-- 화면 미노출은 의도다. 문제는 **보유가 안 되고 있었다**는 것이다. 빌더(build_building_master)가
-- 건물마다 키 48개를 내는데 21개가 build_integrated 에서 끊기고, 그중 아홉(내진적용·내진능력·지붕·
-- 기타구조·비상용승강기·최근대수선구분·대수선이력·사용승인일_정밀도·총동연면적)은 **포스트그레스
-- 어디에도 없다.** 살아남는 곳은 빌드 중간 파일 `_building_master.jsonl`(754MB) 하나 — 질의가 안 되고
-- 청소 대상 옆에 있다.
--
-- ## 어떻게
-- **칸을 고르지 않는다.** 48키를 통째로 jsonb 한 줄로 담는다. 원천에 키가 늘어도 스키마를 안 건드린다.
-- 화면·API 는 **안 읽는다**(읽기 시작하면 「대장이 본값」 규칙이 흐려진다 — 0144·0156).
-- 읽는 것은 AI·분석·나중 파생뿐이다.
--
-- 세대 스왑을 안 쓴다. `load_ledger_raw.py` 가 대장 적재 뒤 되붙임으로 통째 갈아끼운다
-- (floor_outline·road_width 와 같은 자리).

BEGIN;

CREATE TABLE IF NOT EXISTS master.building_ledger_raw (
  building_pk text PRIMARY KEY,
  rec         jsonb NOT NULL,          -- 표제부 원문 48키 그대로. 키를 고르지 않는다
  loaded_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE master.building_ledger_raw IS
  '건축HUB 표제부 원문(빌더 48키) — 화면·API 는 안 읽는다. AI·분석용 보유(2026-09-07)';
COMMENT ON COLUMN master.building_ledger_raw.rec IS
  '_building_master.jsonl 한 줄 그대로. 내진적용·지붕·최근대수선구분처럼 어느 표에도 없는 값이 여기 산다';

-- GIN 색인은 안 건다 — 화면이 안 읽고, 600MB 표에 색인을 얹을 이유가 없다.
-- 나중에 특정 키로 자주 찾게 되면 그때 표현식 색인 하나를 건다.

COMMIT;
