-- 0031 층 표기 통일
--
-- 건축물대장 층별개요의 층 표기가 제각각이다. 같은 3층이 '3층'·'3'·'지상3층'·'삼층'으로 흩어져
-- 있고(2,100종), 문자열로 층을 맞추는 곳이 전부 어긋났다.
--   실측: 종로2가 71-6은 층이 '6'·'지1'이라 주변 임대시세가 층 매칭에 실패해 보증금·임대료가 통째로 비었다.
--
-- floor를 정규 표기로 통일하고 원본은 floor_raw에 보존한다.
--   지상 'N층' · 지하 '지하N층' · 옥탑 '옥탑N층' · 중층 '중N층' · 내부구획 '내…'
-- 값 변환은 data/tools/floor_label.py 규칙으로 scripts/normalize_floor_labels.py가 수행(2,100종 → 매핑).
-- '내'는 합치지 않는다 — 같은 건물에 '1층'과 '내1층'이 함께 있는 경우가 99%(별개 구획, 합치면 면적 이중계상).

ALTER TABLE master.floor_outline ADD COLUMN IF NOT EXISTS floor_raw text;
UPDATE master.floor_outline SET floor_raw = floor WHERE floor_raw IS NULL;

-- 정렬·매칭용 서명 층수 — 정규 표기 기준. 옥탑·중층·내부구획이 지상 N층과 겹치지 않게 대역을 나눈다.
CREATE OR REPLACE FUNCTION app.signed_floor(fl text) RETURNS int
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT CASE
     WHEN fl IS NULL THEN NULL
     WHEN fl ~ '^내' THEN 3000 + COALESCE(app.signed_floor(regexp_replace(fl, '^내', '')), 0)
     WHEN fl ~ '옥탑'  THEN 1000 + COALESCE(NULLIF(regexp_replace(fl, '\D', '', 'g'), '')::int, 1)
     WHEN fl ~ '^중'   THEN  500 + COALESCE(NULLIF(regexp_replace(fl, '\D', '', 'g'), '')::int, 1)
     WHEN fl LIKE '지하%' OR fl ~* '^\s*B'
       THEN -COALESCE(NULLIF(regexp_replace(fl, '\D', '', 'g'), '')::int, 1)
     ELSE COALESCE(NULLIF(regexp_replace(fl, '\D', '', 'g'), '')::int, 0)
   END $$;
