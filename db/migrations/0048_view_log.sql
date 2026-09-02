-- 0048 · 매물 조회 로그 — F-23 행동 학습의 재료
--
-- 개인화는 설문이 아니라 로그로 한다(2026-08-10 결정 — 유튜브 방식).
-- 활동 지역·주력 가격대·유형은 "무엇을 열어봤나"에서 나온다. 지금부터 안 쌓으면
-- 몇 달 뒤에도 학습할 재료가 없다. 화면 변화 없음 — 상세 조회 시 한 줄 기록.
--
-- 설계:
--   · 계정 단위(팀 아님) — 개인의 행동은 본인 추천에만 쓴다. 팀 공유 안 함.
--   · 일 단위 집계(PK = 계정+건물+날짜, n 증가) — 행 폭발 방지. 시각 정밀도는 필요 없다.
--   · 급매↔관계 성향 문항은 폐기 — 수집해도 조준할 실행 수단이 없다(같은 날 결정).

BEGIN;

CREATE TABLE IF NOT EXISTS app.view_log (
  account_id  bigint NOT NULL,
  team_id     bigint NOT NULL,
  building_pk text   NOT NULL,
  viewed_on   date   NOT NULL DEFAULT current_date,
  n           int    NOT NULL DEFAULT 1,
  PRIMARY KEY (account_id, building_pk, viewed_on)
);

-- "이 계정이 최근 어디를 봤나" — 학습 쿼리의 기본 축
CREATE INDEX IF NOT EXISTS view_log_recent_idx ON app.view_log (account_id, viewed_on DESC);

COMMIT;
