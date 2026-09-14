-- AI 어시스턴트 1단계 — 대화 표 둘과 오류 문구 표 (2026-09-08)
-- 정본: specs/07-architecture/10-AI-어시스턴트.md §8 · §21-1
--
-- ## 왜 우리가 저장하나
-- Anthropic Messages API 는 상태가 없다. 매 호출에 지난 대화를 통째로 다시 보낸다.
-- 프롬프트 캐시가 있지만 수명이 분·시간 단위라 정본이 못 된다.
-- 그러니 선택지가 「우리 DB냐 API냐」가 아니다. **우리가 저장 안 하면 아무 데도 안 남는다.**
--
-- ## 개인이다
-- 이 앱의 업무 데이터는 전부 team_id 로 잠긴다(가입하면 1인 팀이 자동으로 생긴다).
-- 대화·기억·문서는 **앱 최초로 account_id 로 잠기는 개인 소유 데이터**다.
-- AI 가 보는 업무 데이터는 여전히 팀 것이다. 잠그는 열쇠가 둘로 갈린다.

BEGIN;

-- ── 대화 ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.ai_chat (
  id          bigserial PRIMARY KEY,
  account_id  bigint NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  title       text,                      -- 첫 답 뒤 Haiku 가 짓는다. NULL 이면 아직 못 지었다
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz                -- 지우기는 먼저 여기 찍고, 실삭제는 배치가 한다
);
CREATE INDEX IF NOT EXISTS ai_chat_mine ON app.ai_chat(account_id, updated_at DESC)
  WHERE archived_at IS NULL;

COMMENT ON TABLE  app.ai_chat            IS 'AI 대화. account_id 로 잠긴다(팀 아님)';
COMMENT ON COLUMN app.ai_chat.archived_at IS '지운 시각. 잘못 눌러 날린 대화를 되살릴 길을 남긴다';

-- ── 메시지 ──────────────────────────────────────────────────────────
--
-- content 가 jsonb 인 이유: 답 한 통에 글·부품·아티팩트가 섞여 나온다.
--   [{"t":"text","v":"…"},
--    {"t":"ui","name":"floor_rents","props":{"pk":"…"}},
--    {"t":"artifact","id":183}]
-- 텍스트 한 칸으로는 순서도 위치도 못 담는다. 다시 열면 부품은 **지금 값**으로 그리고
-- 글자는 그때 그대로 남는다. 어긋나면 데이터가 바뀐 것이고 정상이다.
CREATE TABLE IF NOT EXISTS app.ai_message (
  id          bigserial PRIMARY KEY,
  chat_id     bigint NOT NULL REFERENCES app.ai_chat(id) ON DELETE CASCADE,
  seq         int    NOT NULL,           -- 대화 안 차례. 1 부터
  role        text   NOT NULL CHECK (role IN ('user','assistant')),
  content     jsonb  NOT NULL DEFAULT '[]'::jsonb,
  tool_calls  jsonb,                     -- 부른 도구·쓴 SQL·돌아온 줄 수. 나중에 원인을 보려면 있어야 한다
  model       text,
  tok_in      int,
  tok_out     int,
  stop_reason text,                      -- 'end_turn' | 'stop' | 'error:<code>'
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chat_id, seq)
);
CREATE INDEX IF NOT EXISTS ai_message_chat ON app.ai_message(chat_id, seq);

COMMENT ON COLUMN app.ai_message.content    IS '조각 목록 jsonb. t=text|ui|artifact';
COMMENT ON COLUMN app.ai_message.tool_calls IS '재현용. 이게 없으면 왜 틀렸는지 못 본다';

-- ── 오류 문구 ───────────────────────────────────────────────────────
--
-- 서버는 코드만 던지고 문구는 여기서 온다. **문구를 고칠 때 배포를 안 한다.**
CREATE TABLE IF NOT EXISTS ref.error_msg (
  code   text PRIMARY KEY,
  title  text NOT NULL,
  body   text,
  action text,                           -- 'retry' | 'topup' | 'contact' | NULL
  level  text NOT NULL DEFAULT 'warn'    -- 'info' | 'warn' | 'error'
);

INSERT INTO ref.error_msg(code, title, body, action, level) VALUES
  ('AI_NOT_CONFIGURED', '아직 준비 중입니다',      '조금만 기다려 주세요.',              NULL,    'info'),
  ('AI_UPSTREAM_DOWN',  '지금은 답할 수 없습니다',  '잠시 뒤 다시 시도해 주세요.',        'retry', 'warn'),
  ('AI_TIMEOUT',        '답이 늦어지고 있습니다',   '잠시 뒤 다시 시도해 주세요.',        'retry', 'warn'),
  ('AI_QUOTA',          '크레딧이 부족합니다',      NULL,                                'topup', 'info'),
  ('AI_TOOL_FAILED',    '자료를 못 읽었습니다',     '다시 물어봐 주세요.',                'retry', 'warn'),
  ('AI_TOO_LONG',       '대화가 너무 깁니다',       '새 대화를 시작해 주세요.',           NULL,    'info')
ON CONFLICT (code) DO UPDATE
  SET title = EXCLUDED.title, body = EXCLUDED.body,
      action = EXCLUDED.action, level = EXCLUDED.level;

COMMIT;
