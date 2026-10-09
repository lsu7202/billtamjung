-- 0220 고객 상태 삭제(2026-10-04 대표 「지금 당장은 필요 없음」)
--
-- 고객 상태(진행 · 계약 · 보류 · 종료 · 해약)는 옛 매수자 사다리에서 온 값이다. S09 에서 고객을 매물과
-- 끊은 뒤로 계약 · 해약이 맞지 않고, 고객 표에도 상태 칸이 없다. 붙은 고객 0명.
-- 상태 사전은 매물 상태 하나만 남는다(고치는 곳 = 매물관리).

DELETE FROM app.statuses WHERE kind = 'buyer';
ALTER TABLE app.buyers DROP COLUMN IF EXISTS status_id, DROP COLUMN IF EXISTS hold_reason;

ALTER TABLE app.statuses DROP CONSTRAINT IF EXISTS statuses_kind_check;
ALTER TABLE app.statuses ADD CONSTRAINT statuses_kind_check CHECK (kind = 'listing');

-- 새 팀에 깔리는 기본 상태도 매물만
CREATE OR REPLACE FUNCTION app.seed_statuses(t bigint) RETURNS void LANGUAGE sql AS $$
  INSERT INTO app.statuses(team_id, kind, name, color, sort) VALUES
    (t,'listing','작업','#3182F6',1), (t,'listing','준비','#8B95A1',2), (t,'listing','보류','#F04452',3), (t,'listing','완료','#191F28',4)
  ON CONFLICT DO NOTHING;
$$;

-- 고객 보류 사유 사전(0201)
DELETE FROM ref.enums WHERE enum_key = 'hold_reason_buyer';
DELETE FROM ref.enum_groups WHERE enum_key = 'hold_reason_buyer';
