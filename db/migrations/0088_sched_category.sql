-- 0088: 일정 종류 축 — 일반 · 계약 · 중도금 · 잔금.
--
-- 0084 의 contract 불린을 승격한다. 색·굵기(캘린더)와 체크리스트가 전부 이 축을 탄다.
-- 계약만 갈래로 두면 잔금·중도금은 「일반」에 섞여 돈이 오가는 날이 안 보인다.
ALTER TABLE app.schedules ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT '일반';
UPDATE app.schedules SET category = '계약' WHERE contract AND category = '일반';
-- 이름이 잔금인 예정 약속은 잔금으로(파서·모달이 없던 시절 데이터)
UPDATE app.schedules SET category = '잔금'
 WHERE category = '일반' AND title LIKE '잔금%';
