-- 0038 · 매력도·활용유형·매도가능성을 배치 테이블로
--
-- 왜: 지금 배치로 저장되는 건 적정가(building_sale_est) 하나뿐이고,
--     매력도(F-16)·활용유형(F-20)은 리포트를 만들 때만 계산된다.
--     즉 30크레딧을 써야만 존재하는 값이라 검색·영업 화면에서는 쓸 수가 없다.
--     순수 계산 함수라 미리 돌려두면 어디서나 쓴다(2026-08-09 연결 정리).
--
-- 매도가능성(propensity to sell)은 새로 만든다 — Reonomy 벤치마크.
--   보유기간 · 노후도 · 개발여지 · 정비구역 · 지가상승. 부채 데이터는 우리에게 없다.
--   "예측"이 아니라 "이런 신호가 있다"로 쓴다. 축을 펴서 보여주는 이유.

BEGIN;

CREATE TABLE IF NOT EXISTS master.building_score (
  building_pk   text PRIMARY KEY,

  -- F-16 매력도
  score         numeric(6,1),     -- 0~100
  grade         text,             -- S/A/B/C
  items         jsonb,            -- 8축 원점수(근거를 펴서 보여주려면 필요)

  -- F-20 활용유형
  use_type      text,             -- 신축용 / 리모델링용 / 수익형
  use_scores    jsonb,            -- 유형별 점수
  util_ratio    numeric(8,1),     -- 활용률(현재 용적률 ÷ 법정)

  -- 매도 가능성 — 축별로 편다. 총점만 두면 아무도 안 믿는다.
  sell_score    numeric(5,1),     -- 0~100
  sell_axes     jsonb,            -- {hold:{years,pt}, age:{years,pt}, ...}

  updated       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS building_score_sell_idx ON master.building_score (sell_score DESC)
  WHERE sell_score IS NOT NULL;
CREATE INDEX IF NOT EXISTS building_score_grade_idx ON master.building_score (grade);

-- 0038 초판은 자릿수 없는 numeric이었다 → 43.8999999가 그대로 남는다. 재실행 안전하게 조정.
ALTER TABLE master.building_score
  ALTER COLUMN score      TYPE numeric(6,1),
  ALTER COLUMN util_ratio TYPE numeric(8,1),
  ALTER COLUMN sell_score TYPE numeric(5,1);

COMMIT;
