-- 0158 「가계약」·「본계약 전 합의금」을 **「계약금 일부」**로(2026-09-05 대표 지시)
--
-- 「가계약」은 법에 없는 말이고 현장에서 뜻이 갈린다 — 어떤 이는 계약서를 쓰기 전 구두 약속을,
-- 어떤 이는 돈이 먼저 오간 것을 가리킨다. 실제로 일어나는 일은 하나다: **계약금의 일부가
-- 먼저 움직인다.** 그래서 그 사실을 그대로 부른다.
--
-- 지금 `app.schedules.category` 에 「가계약」 행은 없다(2026-09-05 확인 · 일반3 계약5 중도금1 잔금4 임장2).
-- 그래도 옛 판으로 들어온 값이 있을 수 있으니 멱등으로 갈아 둔다.

UPDATE app.schedules SET category = '계약금 일부' WHERE category = '가계약';

-- 문서 창의 영수증 종류는 `app.contract_docs.body` 안 JSON(`rcpt`)에 든다 — 표 칸이 아니다.
-- DocPage 가 읽을 때 갈아 끼우던 것을 **값에서** 없앤다.
UPDATE app.contract_docs
   SET body = jsonb_set(body, '{rcpt}', '"계약금 일부"')
 WHERE body ? 'rcpt' AND body->>'rcpt' IN ('가계약금', '본계약 전 합의금');
