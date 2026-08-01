-- 0018_vacancy_3state.sql — 공실상태 3값(미지정/임대중/공실), 기본 미지정
-- 컬럼정의서(data-overview §G4): 공실상태 = 공실/임대중/미지정. is_vacant boolean(2값·기본 임대중)이 정의와 불일치.
-- null=미지정(기본) · false=임대중 · true=공실. 기존 행(false=임대중)은 그대로 둠.
BEGIN;
ALTER TABLE app.floor_rents ALTER COLUMN is_vacant DROP DEFAULT;
ALTER TABLE app.floor_rents ALTER COLUMN is_vacant DROP NOT NULL;
COMMIT;
