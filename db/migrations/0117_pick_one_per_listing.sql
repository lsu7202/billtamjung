-- 채택은 매물당 하나 — **DB가 지키게 한다**(2026-08-19).
--   지금까지는 「고르면 앞사람을 푼다」를 서버 코드가 지켰다. 코드가 지키는 규칙은 새 경로가
--   생길 때마다 다시 지켜야 하고(가져오기·일괄수정·다른 핸들러), 한 번 어긋난 데이터는
--   화면에서 「계약 상대가 둘」로 나타난다. 불변식은 데이터 옆에 두는 게 맞다.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS proposals_one_pick_per_listing
    ON app.proposals (team_id, building_pk)
 WHERE picked_at IS NOT NULL;

INSERT INTO app.schema_migrations(version) VALUES ('0117_pick_one_per_listing.sql')
ON CONFLICT DO NOTHING;
COMMIT;
