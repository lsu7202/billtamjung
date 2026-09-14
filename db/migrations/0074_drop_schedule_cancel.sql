-- 0074 · 일정에서 「취소」를 없앤다 — 완료와 삭제만
--
-- 왜: 취소된 약속을 캘린더에 남겨 둘 이유가 없다. 지난 칸에 회색 줄이 쌓이기만 하고,
--   무슨 일이 있었는지는 **장부의 문장**이 이미 들고 있다("사장님 사정으로 방문 취소됨").
--   상태를 셋(예정·완료·취소)으로 두면 화면마다 세 갈래를 그려야 하는데, 그 값어치가 없다.
--
--   예정 → 완료      끝냈다
--   예정 → (삭제)    깨졌거나 잘못 들어왔다. 캘린더에서 지운다(기록은 장부에 남는다)

BEGIN;

DELETE FROM app.schedules WHERE state = '취소';
ALTER TABLE app.schedules ADD CONSTRAINT schedules_state_ck
  CHECK (state IN ('예정', '완료'));

COMMIT;
