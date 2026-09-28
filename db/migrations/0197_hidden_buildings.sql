-- 0197 숨기기(대표 09-28)
--
-- 「안 보기」는 조건과 상관없이 계속 안 보인다. 예전엔 검색 조건에 딸린 값이라(세션 · 저장 조건)
-- 필터를 바꾸면 다시 나오고 창을 닫으면 잊었다. 이제 계정마다 저장하고, 「다시 보기」로만 되돌린다.
-- 고객 계정도 쓴다(팀이 없어도 된다).
BEGIN;
CREATE TABLE IF NOT EXISTS app.hidden_buildings (
  account_id  bigint NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  building_pk text   NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, building_pk)
);
COMMIT;
