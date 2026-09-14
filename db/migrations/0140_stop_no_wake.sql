-- 0140 보류에서 「깨우기」를 뺀다 — 사유만 남긴다
--
-- 보류를 걸 때 「언제 다시 볼까」를 같이 묻고 있었다(wake_kind·wake_on·wake_text).
-- 써 보니 기능이 애매하다 — 날짜를 넣어도 그날 무슨 일이 일어나는지가 분명하지 않고,
-- 정작 열린 보류 0건에 깨울 날짜가 든 건 1건뿐이었다. 아무도 안 쓴다.
--
-- 다시 볼 일이 정해져 있으면 그건 **일정**이지 보류가 아니다. 보류는 「지금은 안 본다」이고
-- 그 이유만 있으면 된다. 깨우는 건 사람이 보류를 푸는 것으로 족하다.
--
-- 같이 여는 길: 보류 대상에 proposal(매수자×매물 짝)을 실제로 쓴다.
-- app.stops.target_type 은 처음부터 listing·buyer·proposal 셋을 받게 돼 있었는데
-- 화면이 늘 'listing' 으로 고정해 매물 전체만 세울 수 있었다. 그래서
-- 「이 매수자는 이 매물을 안 산다」를 적을 자리가 없었고, 그 일을 제안 거절(reaction='거절')이
-- 대신하고 있었다. 거절은 한 번 적고 끝인데 보류는 사유가 줄로 서고 풀 수 있다.

BEGIN;

-- 깨우기 세 칸 제거. 열린 보류가 0건이라 옮길 값이 없다.
ALTER TABLE app.stops DROP COLUMN IF EXISTS wake_kind;
ALTER TABLE app.stops DROP COLUMN IF EXISTS wake_on;
ALTER TABLE app.stops DROP COLUMN IF EXISTS wake_text;

-- wake_on 을 쓰던 인덱스를 팀+열림으로 되돌린다
DROP INDEX IF EXISTS app.stops_open_idx;
CREATE INDEX IF NOT EXISTS stops_open_idx
  ON app.stops (team_id) WHERE resolved_at IS NULL;

-- 짝 보류를 빨리 찾기 위한 인덱스 — 매물 화면이 매수자 줄마다 보류를 묻는다
CREATE INDEX IF NOT EXISTS stops_proposal_idx
  ON app.stops (team_id, target_id) WHERE target_type = 'proposal' AND resolved_at IS NULL;

COMMENT ON TABLE app.stops IS
  '보류 — 지금은 안 본다는 표시와 그 사유. 대상은 listing(매물)·buyer(사람)·proposal(매수자×매물 짝).
   깨울 날짜는 두지 않는다(0140) — 다시 볼 일이 정해져 있으면 그건 일정이다.';

-- 「막연한 시점」 낱말집은 살아 있다 — 이제 쓰는 곳이 **매도 희망 시기**(sell_when) 하나뿐이라
-- 이름을 그리로 옮긴다. wake_vague 라는 이름만 남기면 다음 사람이 깨우기를 찾으러 간다.
ALTER TABLE ref.enums DROP CONSTRAINT enums_enum_key_fkey;
INSERT INTO ref.enum_groups(enum_key, label) VALUES ('sell_vague', '막연한 시점')
  ON CONFLICT (enum_key) DO NOTHING;
UPDATE ref.enums SET enum_key = 'sell_vague' WHERE enum_key = 'wake_vague';
DELETE FROM ref.enum_groups WHERE enum_key = 'wake_vague';
ALTER TABLE ref.enums ADD CONSTRAINT enums_enum_key_fkey
  FOREIGN KEY (enum_key) REFERENCES ref.enum_groups(enum_key) ON DELETE CASCADE;

COMMIT;
