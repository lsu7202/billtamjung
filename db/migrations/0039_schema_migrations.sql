-- 0039 · 적용 이력 테이블
--
-- 왜: 지금까지 "어디까지 적용됐나"를 기록하는 곳이 없었다. 그래서
--   (1) 배포할 때 사람이 "이번에 새 마이그레이션 있었나"를 기억해야 했고 — 2026-08-07에 0032를 빠뜨려
--       프로덕션 브리핑이 8/7~8/10 내내 500이었다(app.teams.office_name 없음).
--   (2) apply.sh는 전부 재실행하므로 프로덕션에 못 돌린다. 0011에
--       `DELETE FROM app.overlays WHERE field IN (...)`가 있어 **운영 중인 팀 오버레이가 지워진다.**
--       못 돌리니까 손으로 골라 적용하고, 손으로 고르니까 또 빠뜨린다. 같은 원인의 두 증상이다.
--
-- 이력이 생기면 apply.sh가 "안 들어간 것만" 돌린다 → 손으로 고를 일이 없고, 0011도 다시 안 돈다.
--
-- 체크섬을 같이 둔다. 0035처럼 이미 적용된 파일을 나중에 고치는 일이 실제로 있었다(멱등하게 감쌌다).
-- 내용이 바뀌면 apply.sh가 경고한다 — 조용히 어긋나는 것보다 시끄럽게 알리는 편이 낫다.

BEGIN;

-- 이력 테이블은 다른 모든 마이그레이션보다 **먼저** 만들어져야 한다(apply.sh가 제일 먼저 돌린다).
-- 빈 DB에서는 app 스키마를 만드는 0003보다도 앞서므로 여기서 확보한다.
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.schema_migrations (
  version     text PRIMARY KEY,          -- 파일명(예: 0032_briefing_assets.sql)
  checksum    text,                      -- sha256(파일 내용)
  applied_at  timestamptz NOT NULL DEFAULT now(),
  applied_by  text DEFAULT current_user,
  -- 이미 들어가 있던 것을 실행 없이 기록만 한 경우(도입 시점 백필). 감사 때 구분이 된다.
  baselined   boolean NOT NULL DEFAULT false
);

COMMIT;
