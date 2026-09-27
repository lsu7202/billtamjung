-- 매물 표(2026-09-26 대표). 업무 › 매물 탭이 부기사처럼 표 하나가 된다.
--
--   전속      — 표의 주소 옆 표시. null=모름
--   확인일    — 사람이 이 매물에 마지막으로 남긴 기록의 날짜(contacts, auto 아님).
--               대시보드 「재통화」가 셈하던 값과 같다. 이제 칸에 두고 둘 다 여기서 읽는다.
--               contacts 트리거가 기록을 쓰고·고치고·지울 때마다 다시 채운다(쓰는 곳이 여럿이라 표에 건다).
--   분류      — 중개사가 직접 고른다(수익률·신축용·사옥용·리모델링용). 여럿일 수 있어 배열로.
--
-- 지우는 것:
--   co_sent_on  공동중개 발송일 — 고치는 화면이 없어진 뒤 한 번도 안 채워짐
--   app.memos · app.ad_prices · app.favorites — 0행, 부르는 화면 없음.
--     (모달 메모창은 app.contacts kind=메모 다. 이 표와 상관없다)

BEGIN;

ALTER TABLE app.listings ADD COLUMN IF NOT EXISTS exclusive  boolean;
ALTER TABLE app.listings ADD COLUMN IF NOT EXISTS checked_on date;

ALTER TABLE app.listings
  ALTER COLUMN building_use TYPE text[]
  USING CASE WHEN building_use IS NULL OR building_use = '' THEN NULL ELSE ARRAY[building_use] END;

ALTER TABLE app.listings DROP COLUMN IF EXISTS co_sent_on;

DROP TABLE IF EXISTS app.memos;
DROP TABLE IF EXISTS app.ad_prices;
DROP TABLE IF EXISTS app.favorites;

-- 확인일 한 곳 — 사람이 쓴 줄의 가장 늦은 날
CREATE OR REPLACE FUNCTION app.listing_checked_fold(p_pk text, p_team bigint) RETURNS void LANGUAGE sql AS $$
  UPDATE app.listings l
     SET checked_on = (SELECT max(c.occurred_on) FROM app.contacts c
                        WHERE c.team_id = p_team AND c.target_type = 'listing'
                          AND c.target_id = p_pk AND NOT c.auto)
   WHERE l.building_pk = p_pk AND l.team_id = p_team
$$;

CREATE OR REPLACE FUNCTION app.contacts_checked_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.target_type = 'listing' THEN
    PERFORM app.listing_checked_fold(OLD.target_id, OLD.team_id);
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.target_type = 'listing' THEN
    PERFORM app.listing_checked_fold(NEW.target_id, NEW.team_id);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS contacts_checked ON app.contacts;
CREATE TRIGGER contacts_checked AFTER INSERT OR UPDATE OR DELETE ON app.contacts
  FOR EACH ROW EXECUTE FUNCTION app.contacts_checked_trg();

SELECT app.listing_checked_fold(building_pk, team_id) FROM app.listings;

COMMIT;
