-- 0024_password_resets.sql — 비밀번호 찾기/재설정 토큰 (S00 [MVP])
-- 베타: 메일 발송은 스텁(콘솔 로그). 정식: SMTP 발송으로 교체.
BEGIN;

CREATE TABLE IF NOT EXISTS app.password_resets (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id  bigint NOT NULL REFERENCES app.accounts(id),
  token       text UNIQUE NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_resets_acct ON app.password_resets(account_id);

COMMIT;
