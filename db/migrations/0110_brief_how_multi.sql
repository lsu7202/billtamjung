-- 브리핑 방식은 **여럿일 수 있다**(2026-08-19) — 자료를 보내고 나중에 만나서 또 한다.
-- 하나만 고르게 하면 나중 것이 앞의 것을 지운다(무엇을 했는지가 사라진다).
BEGIN;

-- 뷰가 이 컬럼을 참조하므로 잠시 내렸다 다시 세운다(0093 정의를 그대로 다시 적용)
DROP VIEW IF EXISTS app.v_proposal_stage;

ALTER TABLE app.proposals
  ALTER COLUMN brief_how TYPE text[]
  USING CASE WHEN brief_how IS NULL OR brief_how = '' THEN NULL
             ELSE ARRAY[brief_how] END;

-- 뷰 재생성은 0093 을 다시 적용해 맞춘다(아래 apply 스크립트가 순서대로 돌린다)

INSERT INTO app.schema_migrations(version) VALUES ('0110_brief_how_multi.sql')
ON CONFLICT DO NOTHING;
COMMIT;
