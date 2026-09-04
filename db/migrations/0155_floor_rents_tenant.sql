-- 층별 임대에 상호명 칸을 둔다 (2026-09-04).
--
-- ## 왜
--
-- 「용도」 칸은 대장 용도(근린생활시설 같은 말)를 되풀이할 뿐이라 화면에서 뺀다.
-- 중개인이 실제로 적고 싶은 것은 「누가 들어와 있나」다. 상호명은 처음엔 모르니 비워 둔다.
-- 미지정은 null 이다. 기본값을 지어내지 않는다.

ALTER TABLE app.floor_rents ADD COLUMN IF NOT EXISTS tenant_name text;
COMMENT ON COLUMN app.floor_rents.tenant_name IS '상호명 — 팀이 적는다. 모르면 null(0155)';
