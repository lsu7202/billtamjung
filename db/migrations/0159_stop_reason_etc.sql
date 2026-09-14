-- 0159 보류 사유에 「기타」 · 메모 칸 폐지(2026-09-05 대표 지시)
--
-- 보류 창에 사유 칩과 **메모 입력칸**이 같이 서 있었다. 그런데 메모는 사유를 고르지 못했을 때
-- 쓰는 자리였다 — 「사유가 곧 상태」라는 규칙과 어긋난다. 칩으로 못 고르는 것이 있으면
-- 그건 **사유 목록이 모자란 것**이지 자유 글칸이 필요한 게 아니다.
--
-- 그래서 여섯 갈래 전부에 **기타**를 둔다. 무엇을 자주 고르는지는 값으로 세어 보면 되고,
-- 「기타」가 쌓이면 그때 새 사유를 만든다. 자유 글은 세지 못한다.
--
-- 메모 칸은 화면에서 뺀다. `app.stops.note` 칸 자체는 남긴다 — 이미 적힌 글을 지우지 않는다.

INSERT INTO ref.enums(enum_key, code, label, sort_order, active)
SELECT k, '기타', '기타', 900, true
  -- 갈래는 `ref.enum_groups` 에 있는 것만(외래키가 걸려 있다). info 는 사유를 안 쓴다.
  FROM (VALUES ('stop_reason_owner'), ('stop_reason_touch'), ('stop_reason_intent'),
               ('stop_reason_asset'), ('stop_reason_match'), ('stop_reason_find'),
               ('stop_reason_deal')) v(k)
ON CONFLICT (enum_key, code) DO UPDATE SET active = true, label = '기타';
