-- 답이 돌려준 건물들의 좌표(2026-09-21). 오른쪽 지도와 본문 카드가 읽는다.
-- 모델에게 간 것이 아니라 **화면용**이라 content(조각) 와 갈라 둔다.
BEGIN;
ALTER TABLE app.ai_message ADD COLUMN IF NOT EXISTS pins jsonb;
COMMENT ON COLUMN app.ai_message.pins IS '답이 돌려준 건물 핀 [{pk,vacant,addr,lng,lat,col,sale_est,price,land_area,total_area}]. 화면 지도용';
COMMIT;
