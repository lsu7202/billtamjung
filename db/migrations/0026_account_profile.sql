-- 0024: 회원 프로필 확장 — 분석용 수집 항목 + 동의 이력(개인정보·마케팅).
-- 직군·가입경로·관심지역은 가입 시 수집(분석·세그먼트용), 동의는 시각 기록(법정 증빙).
ALTER TABLE app.accounts
  ADD COLUMN IF NOT EXISTS job_role text,               -- 직군: broker|assistant|investor|landlord|etc
  ADD COLUMN IF NOT EXISTS referral_source text,        -- 가입경로: referral|search|sns|ad|etc
  ADD COLUMN IF NOT EXISTS interest_region text,        -- 관심 지역(자유입력 — 예: 강남구, 서초구)
  ADD COLUMN IF NOT EXISTS privacy_agreed_at timestamptz,   -- 개인정보 수집·이용 동의(필수)
  ADD COLUMN IF NOT EXISTS marketing_agreed_at timestamptz; -- 마케팅 수신 동의(선택)
ALTER TABLE app.accounts ADD COLUMN IF NOT EXISTS gender text;   -- 성별(선택): male|female|none
ALTER TABLE app.accounts
  ADD COLUMN IF NOT EXISTS office_status text,   -- 사무소: has|preparing|none (중개사·보조원)
  ADD COLUMN IF NOT EXISTS career_years text,    -- 경력: lt1|y1_3|y3_10|gt10
  ADD COLUMN IF NOT EXISTS prior_tools text;     -- 타 프로그램 경험: none|lookup|manage|both
ALTER TABLE app.accounts
  ADD COLUMN IF NOT EXISTS birth_date date,        -- 생년월일(가입 폼)
  ADD COLUMN IF NOT EXISTS expect_feature text;    -- 기대 기능: search|valuation|report|manage
