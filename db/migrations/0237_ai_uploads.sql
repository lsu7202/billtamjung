-- 0237 · 어시스턴트 대화에 올린 이미지(2026-10-06 대표 「올릴 이미지가 필요 · 그걸 쓰려고 업로드」)
-- 자료(홍보물 · 보고서 · 자유 자료)에 넣는 용도다. 파일은 바깥 모델로 보내지 않는다 — 모델은 번호만 받아
-- 부품 <bt-upload id="N"> 으로 자료에 넣고, 굽는 쪽이 파일을 박는다. 올린 사람 본인만 연다.
BEGIN;
CREATE TABLE app.ai_uploads (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id  bigint NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  chat_id     bigint REFERENCES app.ai_chat(id) ON DELETE SET NULL,
  path        text   NOT NULL,                 -- storage 열쇠
  mime        text   NOT NULL,
  name        text,                            -- 올린 파일 이름(화면 표시용)
  created_at  timestamptz NOT NULL DEFAULT now());
CREATE INDEX ai_uploads_account ON app.ai_uploads(account_id, id DESC);
COMMIT;
