-- 0084: 계약 일정은 **명시적 속성**이다 — 제목 문자열 추측이 아니라.
--
-- 파서의 제목 규칙(계약~으로 시작)은 기본값을 채우는 편의 기능으로 내려가고,
-- 최종 결정은 모달의 토글이 갖는다(2026-08-15 — 파서는 부가기능, 모달이 본 기능).
-- 「도장 찍는 날」이라고 이름 붙여도 계약 일정으로 지정할 수 있고,
-- 판정 지점(승격·✓=체결)은 이 플래그 하나만 본다.
ALTER TABLE app.schedules ADD COLUMN IF NOT EXISTS contract boolean NOT NULL DEFAULT false;
UPDATE app.schedules SET contract = true
 WHERE title LIKE '계약%' AND title NOT LIKE '%파기%';
