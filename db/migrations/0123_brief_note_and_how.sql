-- 브리핑은 **한 일의 기록**이다(2026-08-20) — 일정은 부가.
--   전엔 「일정을 잡고 소화하면 방식이 켜진다」였는데, 실제로는 그냥 만나서 보여주고 오는 일이
--   훨씬 잦다. 그때마다 지나간 약속을 지어내야 했다. 이제 **어디서 · 무엇을**이 본체다.
--     brief_how   어디서 — 현장에서 · 사무실에서 · 전화 · 자료 발송 (복수)
--     brief_note  무엇을 — 「임대내역·수익률까지 설명, 3층 공실 걸림」
--   낱말도 바꾼다: 「만나서」는 어디서 만났는지를 안 말한다. 브리핑 일정 창의 **장소**와
--   같은 축으로 놓기 위해 현장/사무실로 가른다(장소가 곧 방식이다).
BEGIN;

ALTER TABLE app.proposals ADD COLUMN IF NOT EXISTS brief_note text;

INSERT INTO ref.enums(enum_key, code, label, sort_order) VALUES
  ('brief_how', '현장에서',   '현장에서',   10),
  ('brief_how', '사무실에서', '사무실에서', 20),
  ('brief_how', '전화',       '전화',       30),
  ('brief_how', '자료 발송',  '자료 발송',  40)
ON CONFLICT (enum_key, code) DO UPDATE SET label = EXCLUDED.label,
                                           sort_order = EXCLUDED.sort_order, active = true;
-- 「만나서」는 폐기 — 이미 찍힌 것은 현장에서로 옮긴다(대개 매물에서 보여준 것이다)
UPDATE app.proposals
   SET brief_how = (SELECT array_agg(DISTINCT CASE WHEN e = '만나서' THEN '현장에서' ELSE e END)
                      FROM unnest(brief_how) e)
 WHERE brief_how && ARRAY['만나서'];
UPDATE app.schedules SET method = '현장에서' WHERE method = '만나서';
UPDATE ref.enums SET active = false WHERE enum_key = 'brief_how' AND code = '만나서';

INSERT INTO app.schema_migrations(version) VALUES ('0123_brief_note_and_how.sql')
ON CONFLICT DO NOTHING;
COMMIT;
