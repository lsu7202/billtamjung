-- 0198 고객 쪽(S05 §5 · §6, 3묶음 2026-09-29)
--
-- · 알림은 읽을 때 셈한다(배치 없음). 「새 것」은 accounts.alerts_seen_at 뒤에 생긴 것.
--   - 저장한 건물에 저장 뒤 새 광고가 오르면
--   - 알림을 켠 조건에 맞는 새 광고가 오르면(want_alerts 에 쌓는다 — 한 번 맞은 건 남긴다)
-- · 조건 알림은 켠 때부터 센다(notify_since). 켜기 전에 오른 광고는 알림이 아니다.
-- · 조건에 검색 요청 원문(request)을 싣는다 — 화면이 부르는 /search/pins 와 같은 몸통이라 서버가 그대로 다시 부른다.
-- · 신고가 들어오면 광고 review 가 검수중이 된다(S05 §6). 한 계정이 한 광고에 확인중인 신고는 하나.
-- · 목적은 매수자 사전(building_use: 실사용 · 투자용 · 신축용)을 그대로 쓴다.
BEGIN;
ALTER TABLE app.accounts ADD COLUMN IF NOT EXISTS alerts_seen_at timestamptz;
ALTER TABLE app.saved_searches ADD COLUMN IF NOT EXISTS notify_since timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS ad_reports_one_open ON app.ad_reports(ad_id, account_id) WHERE status = '확인중';
CREATE INDEX IF NOT EXISTS saves_account ON app.saves(account_id, created_at DESC);
COMMIT;
