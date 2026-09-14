-- 0152 · 층별개요에 대장이 주는 칸 넷을 더 싣는다 (2026-09-01)
--
-- 빌더(build_floor_outline.py)가 이름으로 읽도록 옮기면서 옛 판이 버리던 칸 넷을 싣기
-- 시작했는데 표와 적재기가 안 따라와 적재가 막혔다. 검사는 옳게 걸린 것이다 —
-- 「모양이 다르면 안 넣는다」가 그 스크립트의 일이다.
--
--   dong           동명칭. 한 필지에 여러 동이 있을 때 층을 동별로 갈라야 한다
--   area_excluded  면적제외여부. 연면적 산정에서 빼는 층인지. 모르면 층별 합이 연면적과 안 맞는다
--   structure      구조코드명
--   main_sub       주부속구분코드명(주건축물·부속건축물)
--
-- **원본 그대로 text 다.** 면적제외여부를 참/거짓으로 옮기지 않는다 — 원본이 무엇을
-- 넣는지(0/1·N/Y) 우리가 정할 일이 아니다.
--
-- 표를 여기서 고치는 이유: 적재기가 표를 새로 만들어 이름을 바꿔 다는 방식이었는데,
-- 그러면 이 표를 읽는 MV(floor_est_by_floor·floor_est_total)가 옛 표를 따라가 끊긴다.
-- 그래서 표는 그대로 두고 안만 갈아 끼우는 방식으로 바꿨고, 표 모양은 마이그레이션이 맡는다.

BEGIN;

ALTER TABLE master.floor_outline ADD COLUMN IF NOT EXISTS dong          text;
ALTER TABLE master.floor_outline ADD COLUMN IF NOT EXISTS area_excluded text;
ALTER TABLE master.floor_outline ADD COLUMN IF NOT EXISTS structure     text;
ALTER TABLE master.floor_outline ADD COLUMN IF NOT EXISTS main_sub      text;

COMMENT ON COLUMN master.floor_outline.area_excluded IS
  '면적제외여부 — 대장 원문 그대로. 연면적 산정에서 빼는 층인지.';
COMMENT ON COLUMN master.floor_outline.dong IS
  '동명칭 — 한 필지에 여러 동일 때 층을 동별로 가른다.';

COMMIT;
