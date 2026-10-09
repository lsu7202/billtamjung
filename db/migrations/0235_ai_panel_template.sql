-- 0235 · 어시스턴트 오른쪽 판 · 자료 템플릿(2026-10-06 대표)
--
-- 오른쪽 판은 컨테이너 하나 · 한 번에 한 화면(map · artifact · templates). 무엇을 띄울지는 **판 열기 신호**로만 정한다 —
-- 핀(데이터)이 있다고 열지 않는다(건물을 읽기만 해도 지도가 뜨던 것). 답마다 마지막 판을 남겨 다시 열면 돌아온다.
-- 자료 템플릿은 **사용자가 고른 요청에만** 실리는 작성 규격(말투 · 구성 · 지면 · 토큰 · 부품). 자료는 어느 템플릿으로 만들었는지 기억한다.
BEGIN;
ALTER TABLE app.ai_message ADD COLUMN panel jsonb;          -- {view: map|artifact, ...} · 없으면 판을 안 연다
ALTER TABLE app.artifact ADD COLUMN template_key text;       -- 고른 템플릿(promo · report …). 없으면 자유 자료
ALTER TABLE app.artifact ADD COLUMN template_ver int;
ALTER TABLE app.artifact DROP CONSTRAINT artifact_kind_check;
ALTER TABLE app.artifact ADD CONSTRAINT artifact_kind_check CHECK (kind IN ('slides', 'doc', 'promo'));
COMMIT;
