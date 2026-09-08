-- AI 어시스턴트 · 도구 결과를 참조로 (2026-09-08)
-- 정본: 10-AI-어시스턴트 §23-1
--
-- ## 왜
-- query() 가 50줄을 돌려주면 그게 대화 이력에 남아 **그다음 모든 질문에 2,000토큰이 실린다.**
-- 도구 결과 한 번이 대화 여섯 턴 몫이다. 표를 세 번 뽑고 나면 이력의 대부분이 사람 말이 아니라
-- 표가 된다. 그래서 개수와 앞 다섯 줄만 모델에게 주고, 나머지는 여기 두고 id 만 오간다.
--
-- ## 누가 쓰나
-- 쓰는 것은 앱 접속(postgres)이고 bt_ai 는 이 표를 못 본다(app 스키마 USAGE 없음).
-- 모델은 result_page(id) 로만 꺼낸다. 같은 대화의 것만(chat_id 검사).
--
-- ## 크기
-- 200줄 상한이라 한 건에 수십 KB. 대화가 지워지면 같이 지워진다(CASCADE).

BEGIN;

CREATE TABLE IF NOT EXISTS app.ai_result (
  id         bigserial PRIMARY KEY,
  chat_id    bigint NOT NULL REFERENCES app.ai_chat(id) ON DELETE CASCADE,
  sql        text   NOT NULL,          -- 재현용. 나중에 「자주 나온 쿼리」를 여기서 센다(§10)
  purpose    text,                     -- 모델이 적은 「무엇을 알려고」
  n          int    NOT NULL,
  rows       jsonb  NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_result_chat ON app.ai_result(chat_id, id);

COMMENT ON TABLE app.ai_result IS 'query() 결과의 나머지 줄. 모델에겐 개수와 앞 다섯 줄만 가고 여기서 id 로 꺼낸다';

COMMIT;
