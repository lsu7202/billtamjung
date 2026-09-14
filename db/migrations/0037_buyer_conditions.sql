-- 0037 · 매수자 조건을 여러 개로 · 등급을 enum으로
--
-- 0036은 매수자당 조건을 하나(buyers.conditions_json)로 뒀는데 현장은 그렇지 않다.
-- 한 사람이 "종로 수익형 50~100억"과 "강남 신축부지 200억대"를 같이 들고 다닌다.
-- 조건을 이름 붙은 세트로 분리한다.
--
-- 등급도 자유입력이었다. 우리 시스템의 선택형 필드는 전부 ref.enums + 칩(Chips)이다.
-- 매수자만 텍스트 입력이면 일관성이 깨지고 집계도 안 된다.
-- 매물 등급(grade: 매우좋음~매우나쁨)과는 뜻이 달라 별도 키로 둔다.

BEGIN;

-- ── 조건 세트 ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.buyer_conditions (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id         bigint NOT NULL REFERENCES app.teams(id) ON DELETE CASCADE,
  buyer_id        bigint NOT NULL REFERENCES app.buyers(id) ON DELETE CASCADE,
  name            text NOT NULL DEFAULT '조건',      -- '종로 수익형' 처럼 사람이 부르는 이름
  -- saved_searches.conditions_json과 같은 모양: {values, regions, polygon, filters}
  -- values/regions = 모달 재편집용 원본 · filters = 검색 엔진 입력
  conditions_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS buyer_conditions_buyer_idx ON app.buyer_conditions (buyer_id);

DROP TRIGGER IF EXISTS t_upd ON app.buyer_conditions;
CREATE TRIGGER t_upd BEFORE UPDATE ON app.buyer_conditions
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- 기존 단일 조건을 세트 하나로 옮긴다(빈 조건은 옮기지 않는다 — 빈 세트는 매칭에 방해만 된다)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='app' AND table_name='buyers' AND column_name='conditions_json') THEN
    INSERT INTO app.buyer_conditions (team_id, buyer_id, name, conditions_json)
    SELECT team_id, id, '조건 1', conditions_json
      FROM app.buyers
     WHERE conditions_json IS NOT NULL AND conditions_json <> '{}'::jsonb
       AND NOT EXISTS (SELECT 1 FROM app.buyer_conditions c WHERE c.buyer_id = app.buyers.id);
    ALTER TABLE app.buyers DROP COLUMN conditions_json;
  END IF;
END $$;

-- ── 매수자 등급 enum ────────────────────────────────────
-- 엑셀 표기(C/A+)를 그대로 옮기지 않고 등급만 남긴다. 세부는 메모.
INSERT INTO ref.enum_groups(enum_key, label)
VALUES ('buyer_grade', '매수자 등급')
ON CONFLICT (enum_key) DO NOTHING;

INSERT INTO ref.enums(enum_key, code, label, sort_order, active)
VALUES ('buyer_grade', '미지정', '미지정', 0, true),
       ('buyer_grade', 'A', 'A · 확실', 1, true),
       ('buyer_grade', 'B', 'B · 보통', 2, true),
       ('buyer_grade', 'C', 'C · 관망', 3, true)
ON CONFLICT (enum_key, code) DO NOTHING;

INSERT INTO ref.enum_groups(enum_key, label)
VALUES ('buyer_source', '매수자 유입경로')
ON CONFLICT (enum_key) DO NOTHING;

INSERT INTO ref.enums(enum_key, code, label, sort_order, active)
VALUES ('buyer_source', '미지정', '미지정', 0, true),
       ('buyer_source', '소개', '소개', 1, true),
       ('buyer_source', '광고', '광고', 2, true),
       ('buyer_source', '직접문의', '직접문의', 3, true),
       ('buyer_source', '기존고객', '기존고객', 4, true),
       ('buyer_source', '기타', '기타', 5, true)
ON CONFLICT (enum_key, code) DO NOTHING;

COMMIT;
