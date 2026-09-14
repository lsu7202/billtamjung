-- 베타 테스터 설문 응답 — 익명 제출 허용(로그인 없이도 답변 가능), 계정 있으면 연결
CREATE TABLE IF NOT EXISTS app.survey_responses (
  id           bigserial PRIMARY KEY,
  account_id   bigint REFERENCES app.accounts(id) ON DELETE SET NULL,   -- 익명이면 NULL
  survey_key   text NOT NULL DEFAULT 'beta-2026-08',                    -- 설문 회차 구분
  answers      jsonb NOT NULL,                                          -- 문항별 응답 원본
  contact      text,                                                    -- 인터뷰 동의 시 연락처
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS survey_responses_key_idx ON app.survey_responses(survey_key, created_at DESC);
