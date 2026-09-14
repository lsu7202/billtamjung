-- 0162 · 원천별 증분 파이프라인 장부 (2026-09-06)
-- 왜: run_pipeline.sh 는 어느 원천이 바뀌었든 전체 빌드를 돌았다(디스크 25GB · 몇 시간).
--     소식 하나 갱신에 임대추정 33분이 따라 붙었다. 「무엇이 몇 판째인가」를 적어 두면
--     바뀐 것만, 그것을 읽는 파생만 돌릴 수 있다. 선언 자리는 pipeline/units.py.

CREATE TABLE IF NOT EXISTS master.source_version (
  unit        text PRIMARY KEY,              -- news.notice · sales · ledger · (파생은 step 이름)
  cadence     text NOT NULL,                 -- weekly|monthly|quarterly|semiannual|yearly|derive
  input_sig   text,                          -- 입력 지문(파일 경로·크기·mtime 해시). 같으면 건너뛴다
  version     bigint NOT NULL DEFAULT 0,     -- 성공할 때마다 +1
  loaded_at   timestamptz,
  rows        bigint,
  status      text,
  note        text
);

CREATE TABLE IF NOT EXISTS master.derive_run (
  id             bigserial PRIMARY KEY,
  step           text NOT NULL,
  input_versions jsonb NOT NULL DEFAULT '{}'::jsonb,   -- 실행 당시 입력들의 version
  ran_at         timestamptz NOT NULL DEFAULT now(),
  status         text NOT NULL,
  note           text
);
CREATE INDEX IF NOT EXISTS derive_run_step_idx ON master.derive_run (step, ran_at DESC);
