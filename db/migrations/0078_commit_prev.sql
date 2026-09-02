-- 0078 · 커밋에 「이전 값」 스냅샷 — 지우면 파생값이 돌아온다
--
-- 왜: 커밋 삭제는 상태·일정·거울까지 되돌리는데 **가격은 안 돌아왔다**.
--   「매매가 760억」 커밋을 지워도 오버레이엔 760이 남고, 「120억이면 하겠다」를 지워도
--   hope_price 는 120 그대로였다 — 장부는 되감기는데 파생값만 미래에 남는 반쪽 되돌리기.
--
-- 커밋이 값을 덮기 전에 **덮이는 값**을 자기 몸에 적어 둔다(prev jsonb).
-- 삭제가 그걸 읽어 되돌린다 — 별도 이력 테이블 없이 커밋 자신이 영수증이다.
--   contacts.prev        {"sale_price": "이전값|null", "ask_price": …}  (null = 오버레이 없었음)
--   proposal_events.prev {"hope_price": 이전값|null, "deal_price": …}

BEGIN;
ALTER TABLE app.contacts        ADD COLUMN IF NOT EXISTS prev jsonb;
ALTER TABLE app.proposal_events ADD COLUMN IF NOT EXISTS prev jsonb;
COMMIT;
