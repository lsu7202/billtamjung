-- 0215 고객 출처에 「구해요」(S09) — 구해요로 들어온 문의를 고객으로 등록하면 지금까지 「광고」로 적혔다
BEGIN;
INSERT INTO ref.enums(enum_key, code, label, sort_order) VALUES ('buyer_source', '구해요', '구해요', 25)
ON CONFLICT DO NOTHING;
COMMIT;
