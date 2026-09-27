-- 앞 턴의 도구 결과를 줄여서 다시 넘긴다(10-AI §23-4 · 할일 A-14, 2026-09-26 확정)
-- 답 한 줄마다 그 턴에 돈 도구의 「입력 + 줄인 결과」. 다음 물음 때 최근 3턴을 도구 호출 모양으로 재현한다.
--   search → 조건 · 건물(순서·건물번호·주소, 최대 45) · 전체 수 / building → 건물번호·주소 / make·fix → 자료번호·제목
BEGIN;
ALTER TABLE app.ai_message ADD COLUMN IF NOT EXISTS refs jsonb;
COMMIT;
