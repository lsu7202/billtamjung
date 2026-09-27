-- 자료(아티팩트) — 말로 만드는 시각자료. 정본 specs/07-architecture/10-AI-어시스턴트.md §11.
--
-- **어디에도 안 묶인다**(2026-09-24 대표). 한 건물을 설명하는 자료가 아닐 수 있다.
-- 세 건물 비교도, 한 동네 정리도 된다. 그래서 building_pk 가 없다. chat_id 는 「어느 대화에서
-- 나왔나」일 뿐 잠금이 아니고, 대화가 지워져도 자료는 산다(ON DELETE SET NULL).
--
-- 원본(src_html)과 구운 것(baked_html)을 나눈다. 원본이 있어야 부분 수정이 되고,
-- 굽기를 열 때로 미뤄야 데이터가 살아 있다. 굳히는 건 내보낸 판 하나뿐이다
-- (「데이터 변경됨」 판정은 안 만든다 — 분석보고서의 stale 은 폐지됐다).
BEGIN;

CREATE TABLE IF NOT EXISTS app.artifact (
  id          bigserial PRIMARY KEY,
  account_id  bigint NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  chat_id     bigint REFERENCES app.ai_chat(id) ON DELETE SET NULL,
  title       text   NOT NULL,
  kind        text   NOT NULL DEFAULT 'slides' CHECK (kind IN ('slides','doc')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX IF NOT EXISTS artifact_mine ON app.artifact(account_id, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS app.artifact_ver (
  id            bigserial PRIMARY KEY,
  artifact_id   bigint NOT NULL REFERENCES app.artifact(id) ON DELETE CASCADE,
  ver           int    NOT NULL,          -- 1 부터. 고칠 때마다 선다
  src_html      text   NOT NULL,          -- 모델이 쓴 것. 고치기·재굽기의 바탕
  baked_html    text,                     -- 굳힌 판만 채워진다(bt-* 를 값으로 바꾼 결과)
  pinned_reason text CHECK (pinned_reason IN ('pdf','image','manual')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, ver)
);
CREATE INDEX IF NOT EXISTS artifact_ver_last ON app.artifact_ver(artifact_id, ver DESC);

COMMENT ON TABLE  app.artifact             IS '말로 만드는 시각자료. account_id 로 잠긴다(팀 아님)';
COMMENT ON COLUMN app.artifact.chat_id     IS '어느 대화에서 나왔나. 잠금이 아니다 — 대화가 지워져도 자료는 산다';
COMMENT ON COLUMN app.artifact.kind        IS 'slides=가로 16:9 / doc=세로 A4·폰. 방향은 폭이 정한다';
COMMENT ON COLUMN app.artifact_ver.src_html   IS '모델이 쓴 HTML. bt-map·bt-photo 가 섞여 있다';
COMMENT ON COLUMN app.artifact_ver.baked_html IS 'PDF·이미지로 내보낸 판만 굳힌다. 손님 손에 있는 물건이라 변하면 안 된다';

COMMIT;
