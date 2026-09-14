-- 0042 · master.buildings 뷰 갱신
--
-- 왜: master.buildings는 buildings_v2를 가리키는 **뷰**다. 뷰는 만들 때 컬럼 목록이 고정돼서
--     기반 테이블에 컬럼을 추가해도 따라오지 않는다. 0040(bcr_src)·0041(far_src)을 넣고도
--     API가 계속 null을 반환했다 — 값은 테이블에 있는데 뷰가 옛 목록을 들고 있었다.
--
-- 정기 적재 때는 loader가 스왑 후 `CREATE OR REPLACE VIEW`로 다시 만들어 저절로 맞는다
-- (pipeline/loader.py). 이 파일은 재적재 전까지의 다리다 — 0034 height·0040 bcr과 같은 규칙:
-- **컬럼을 추가하는 마이그레이션은 값 백필과 뷰 갱신까지 같이 낸다.**
--
-- ALTER TABLE ADD COLUMN은 컬럼을 끝에 붙이므로 CREATE OR REPLACE VIEW로 갱신할 수 있다
-- (중간에 끼워 넣거나 순서를 바꾸면 REPLACE가 거부한다 — 그때는 DROP·재생성이 필요하다).

BEGIN;

CREATE OR REPLACE VIEW master.buildings AS SELECT * FROM master.buildings_v2;

COMMIT;
