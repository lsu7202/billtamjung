-- 0040 · 건폐율 결측 보완 + 출처 컬럼
--
-- 왜: 서울 560,016동 중 건폐율이 189,860동(33.9%) 비어 있었다. 그런데 그중 대부분은
--     대장이 건폐율 칸만 비워둔 것이고 건축면적·대지면적은 멀쩡히 있다. 나누면 나오는 값을
--     "—"로 두고 있었다. 입체 지적도는 그걸 0.9(대지의 81%)라는 임의값으로 그려 왔다.
--
-- 파급은 그림만이 아니다. far/bcr 결측은 F-09b(용적률 여유)·F-20(활용률)·F-21/F-22(개발여지)를
-- 34%에서 결측으로 돌린다. 어제 돌린 building_score 배치도 그 상태로 계산됐다.
--
-- 출처를 남기는 이유: 셋을 구분해야 화면이 사실과 추정을 다르게 말할 수 있다.
--   대장          — 원본 그대로
--   건축면적      — 건축면적÷대지면적. **추정 아님**(둘 다 대장 값. 검증 중앙 오차 0.00%p)
--   층별개요추정  — 최대 지상층 면적÷대지면적. **추정**(검증 중앙 오차 0.6% · ±10% 76.4%)
--
-- 정본은 파이프라인(build_building_master.py)이다. 여기 백필은 정기 적재 전까지의 다리다 —
-- 컬럼만 추가하고 값을 안 채우면 재적재 전까지 전부 NULL이 된다(0034 height에서 겪었다).

BEGIN;

ALTER TABLE master.buildings_v2
  ADD COLUMN IF NOT EXISTS bcr_src text;   -- 대장 | 건축면적 | 층별개요추정

-- ① 이미 값이 있던 것 = 대장
UPDATE master.buildings_v2 SET bcr_src = '대장'
 WHERE bcr IS NOT NULL AND bcr_src IS NULL;

-- ② 건축면적으로 계산 — 추정 아님
UPDATE master.buildings_v2
   SET bcr = round(build_area / land_area * 100, 2), bcr_src = '건축면적'
 WHERE bcr IS NULL AND build_area > 0 AND land_area > 0
   AND build_area / land_area * 100 <= 100;   -- 100% 초과는 원본 오류로 보고 안 쓴다

-- ③ 층별개요 최대 지상층으로 — 추정
--    지하는 뺀다(지하가 더 넓은 건물이 흔해 넣으면 건폐율이 과대해진다).
--    building_pk 단위라 한 필지 여러 동이어도 남의 동 면적을 끌어오지 않는다.
WITH mx AS (
  SELECT building_pk, max(floor_area) AS a
    FROM master.floor_outline
   WHERE floor_area > 0 AND floor ~ '^[0-9]+층$'
   GROUP BY 1)
UPDATE master.buildings_v2 b
   SET bcr = round(mx.a / b.land_area * 100, 2), bcr_src = '층별개요추정'
  FROM mx
 WHERE mx.building_pk = b.building_pk
   AND b.bcr IS NULL AND b.land_area > 0
   AND mx.a / b.land_area * 100 <= 100;

CREATE INDEX IF NOT EXISTS buildings_v2_bcr_src_idx ON master.buildings_v2 (bcr_src)
  WHERE bcr_src = '층별개요추정';   -- 추정분만 따로 세거나 걸러낼 때

COMMIT;
