-- 0013_social_accounts.sql — 소셜 로그인(카카오·네이버) 계정 연동
-- 기능목록 재분류(2026-07-22): OAuth 로그인은 베타. 스키마를 지금 확정해 나중 마이그레이션 회피.
-- accounts.phone·phone_verified_at 은 이미 존재(전화 SMS 인증=정식) → 여기선 소셜만.
BEGIN;

CREATE TABLE IF NOT EXISTS app.social_accounts (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id    bigint NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  provider      text   NOT NULL CHECK (provider IN ('kakao','naver')),
  provider_uid  text   NOT NULL,                       -- 제공자 고유 사용자 ID
  email         text,                                  -- 제공자 제공 이메일(있으면)
  linked_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)                       -- 한 소셜 계정 = 한 빌탐정 계정
);
CREATE INDEX IF NOT EXISTS social_accounts_account_idx ON app.social_accounts(account_id);

COMMIT;
