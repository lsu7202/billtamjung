-- 0067 · 자동 커밋 표식 — 전파로 생긴 기록을 사람이 쓴 기록과 구분한다
--
-- 계약과 계약파기는 **한 사건의 양면**이다. 매수자 B가 건물 X를 계약하면 X의 매도도
-- 계약된 것이고, 깨지면 양쪽이 같이 깨진다. 그래서 한쪽 장부에 커밋이 서면 반대편에도
-- 같은 사실이 서야 한다.
--
-- 표식이 필요한 이유는 **순환** 때문이다. 매수 계약이 만든 매도 커밋이 다시 매수로 전파되면
-- 무한히 돈다. 전파는 **사람이 쓴 커밋에만** 반응하고, 자동으로 생긴 줄은 재전파하지 않는다.
-- 화면에서도 「내가 안 쓴 줄」임을 알 수 있어야 한다.

BEGIN;

ALTER TABLE app.proposal_events ADD COLUMN IF NOT EXISTS auto boolean NOT NULL DEFAULT false;
ALTER TABLE app.contacts        ADD COLUMN IF NOT EXISTS auto boolean NOT NULL DEFAULT false;

COMMIT;
