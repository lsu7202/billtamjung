-- 0206 · 계정 직급(10-02 대표) — 매물 카드 윗줄 「사무소명 이름 직급」.
-- 팀 사무소의 agent_title(직함)은 사무소에 한 명뿐이라, 팀원이 여럿이면 광고를 올린 사람의 직급을 못 낸다.
-- 모르면 null — 카드엔 빈칸. 계정 칸이 비고 그 계정이 사무소 담당자면 사무소 직함을 빌린다(읽을 때 COALESCE).
ALTER TABLE app.accounts ADD COLUMN IF NOT EXISTS job_title text;
