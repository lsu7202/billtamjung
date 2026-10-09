-- 0226 매물 중심 (2026-10-05 대표 승인 · specs/04-data/매물-중심.md)
--
-- 매물이 주인공이다. 매물 하나에 매매가 하나. 매물에 종류는 없고 주인(사무소)이 있다.
--   app.listings          매물 공통 — 주인 · 건물 · 매매가 · 평단가
--   app.listing_office    사람 사무소 매물의 관리 칸(1:1) — 지금 listings 의 칸을 그대로 옮긴다
--   app.listing_crawl     수집 매물의 수집 정보(1:1) — 주인은 수집 사무소(teams.system, 수집처마다 하나)
--   app.ads               사람 사무소 매물의 노출 기록 — 매물 값을 복사해 들던 칸을 지운다
-- 0224 의 app.sale_prices 는 매물의 매매가 칸으로 들어가고 없어진다.
-- 한 사무소 · 한 건물에 매물은 하나(지금 유일 그대로). 다시 받으면 그 매물을 다시 연다.
-- 닫힘은 칸으로 두지 않는다 — 사람 사무소 매물은 보류 사유 「매각됨」, 수집 매물은 gone_on.
-- 사무소 쪽 표(임대내역 · 사진 · 짝 · 메모 · 값 이력)의 열쇠를 매물 번호로 바꾸는 것은 0227.
BEGIN;

-- ── 1. 수집 사무소 ─────────────────────────────────────────────
ALTER TABLE app.teams ADD COLUMN system boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN app.teams.system IS '수집 사무소(빌탐정 시스템 · 수집처마다 하나). 사람이 속하지 않고 사람 기능(팀 목록 · 초대 · 상태 사전)에서 빠진다(0226)';
ALTER TABLE app.teams ALTER COLUMN owner_account_id DROP NOT NULL;
ALTER TABLE app.teams ADD CONSTRAINT teams_owner_ck CHECK (system OR owner_account_id IS NOT NULL);
CREATE OR REPLACE FUNCTION app.t_team_statuses() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT NEW.system THEN PERFORM app.seed_statuses(NEW.id); END IF;   -- 수집 사무소엔 상태 사전이 없다
  RETURN NEW;
END $$;
INSERT INTO app.teams(name, office_name, system) VALUES ('네이버', '네이버', true);

-- ── 2. 사람 사무소 매물의 관리 칸 ───────────────────────────────
CREATE TABLE app.listing_office (
  listing_id          bigint PRIMARY KEY REFERENCES app.listings(id) ON DELETE CASCADE,
  assignee_account_id bigint REFERENCES app.accounts(id),
  listing_no          text,
  received_on         date,
  owner_id            bigint REFERENCES app.owners(id),
  status_id           bigint REFERENCES app.statuses(id) ON DELETE SET NULL,
  hold_reason         text,
  sold_on             date,
  sold_price          bigint,
  ask_price           bigint,
  total_deposit       bigint,
  total_rent          bigint,
  total_mgmt          bigint,
  vacant_area         numeric,
  rent_full           bigint,
  full_est            boolean,
  building_major      text,
  building_use        text[],
  grade               text,
  ipji                text,
  nohudo              text,
  price_vs_market     text,
  exclusive           boolean,
  checked_on          date,
  urgency             text,
  intent              text,
  meongdo             text,
  use_change          text,
  myeolsil            text,
  sell_on             date,
  sell_vague          text,
  call_result         text,
  rent_check          text,
  loan                bigint,
  loan_open           boolean NOT NULL DEFAULT true,
  move_in             text CHECK (move_in = ANY (ARRAY['즉시입주', '협의', '날짜'])),
  move_in_on          date,
  updated_at          timestamptz NOT NULL DEFAULT now());
COMMENT ON TABLE app.listing_office IS '사람 사무소 매물의 관리 칸(0226). 「내 매물」 = 주인이 내 사무소인 매물';
INSERT INTO app.listing_office
SELECT id, assignee_account_id, listing_no, received_on, owner_id, status_id, hold_reason, sold_on, sold_price,
       ask_price, total_deposit, total_rent, total_mgmt, vacant_area, rent_full, full_est,
       building_major, building_use, grade, ipji, nohudo, price_vs_market, exclusive, checked_on,
       urgency, intent, meongdo, use_change, myeolsil, sell_on, sell_vague, call_result, rent_check,
       loan, loan_open, move_in, move_in_on, updated_at
  FROM app.listings;
CREATE INDEX listing_office_owner ON app.listing_office(owner_id);
CREATE TRIGGER t_upd BEFORE UPDATE ON app.listing_office FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- 매물번호 · 접수일 자동(0068 · 0183) — 관리 칸을 따라 옮긴다
DROP TRIGGER t_listing_register ON app.listings;
CREATE OR REPLACE FUNCTION app.listing_register_defaults() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.assignee_account_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.assignee_account_id IS DISTINCT FROM NEW.assignee_account_id) THEN
    NEW.listing_no  := COALESCE(NEW.listing_no,  (1000 + NEW.listing_id)::text);
    NEW.received_on := COALESCE(NEW.received_on, current_date);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER t_listing_register BEFORE INSERT OR UPDATE OF assignee_account_id ON app.listing_office
  FOR EACH ROW EXECUTE FUNCTION app.listing_register_defaults();

-- 확인일 접기(0182) — 칸이 관리 표로 갔다
CREATE OR REPLACE FUNCTION app.listing_checked_fold(p_pk text, p_team bigint) RETURNS void LANGUAGE sql AS $$
  UPDATE app.listing_office o
     SET checked_on = (SELECT max(c.occurred_on) FROM app.contacts c
                        WHERE c.team_id = p_team AND c.target_type = 'listing'
                          AND c.target_id = p_pk AND NOT c.auto)
    FROM app.listings l
   WHERE l.id = o.listing_id AND l.building_pk = p_pk AND l.team_id = p_team
$$;

-- 만실 월임대 접기(0181 · 0185 · 0224) — 칸이 관리 표로 갔다
CREATE OR REPLACE FUNCTION app.listing_full_fold(p_pk text, p_team bigint)
 RETURNS void LANGUAGE sql AS $function$
  WITH rows AS (
    SELECT floor, rent, contract_area, app.unit_occupied(tenant_name, place_ref, rent) AS occ
      FROM app.floor_rents
     WHERE building_pk = p_pk AND team_id = p_team AND deleted_at IS NULL
  ), vac AS (
    SELECT app.floor_signed(floor) AS floor_no,
           CASE WHEN bool_or(contract_area IS NULL) THEN NULL ELSE sum(contract_area) END AS vacant_area
      FROM rows WHERE NOT occ GROUP BY 1
  ), act AS (
    SELECT app.floor_signed(floor) AS fno, sum(rent)::numeric / sum(contract_area) AS p
      FROM rows WHERE occ AND rent > 0 AND contract_area > 0 GROUP BY 1
  ), est AS (
    SELECT app.floor_signed(fo.floor) AS fno, sum(fre.rent_est)::numeric / NULLIF(sum(fo.floor_area), 0) AS p
      FROM master.floor_outline fo JOIN master.floor_rent_est fre USING (building_pk, seq)
     WHERE fo.building_pk = p_pk AND fre.rent_est > 0 GROUP BY 1
  ), per AS (
    SELECT v.vacant_area, COALESCE(a.p, e.p) AS p, (a.p IS NULL AND e.p IS NOT NULL) AS is_est
      FROM vac v LEFT JOIN act a ON a.fno = v.floor_no LEFT JOIN est e ON e.fno = v.floor_no
  ), g AS (
    SELECT (SELECT count(*) FROM rows) AS n,
           (SELECT count(*) FROM rows WHERE occ AND COALESCE(rent, 0) = 0) AS unknown_rent,
           count(*) FILTER (WHERE vacant_area IS NULL OR (vacant_area > 0 AND p IS NULL)) AS miss,
           COALESCE(sum(vacant_area * p) FILTER (WHERE vacant_area > 0), 0) AS add,
           COALESCE(bool_or(is_est) FILTER (WHERE vacant_area > 0), false) AS est
      FROM per
  )
  UPDATE app.listing_office o
     SET rent_full = CASE WHEN k.ok AND o.total_rent IS NOT NULL THEN round(o.total_rent + k.add) END,
         full_est  = CASE WHEN k.ok AND o.total_rent IS NOT NULL THEN k.est END
    FROM (SELECT n > 0 AND miss = 0 AND unknown_rent = 0
                 AND app.listing_vacancy(p_pk, p_team) IS NOT NULL AS ok, add, est FROM g) k,
         app.listings l
   WHERE l.id = o.listing_id AND l.building_pk = p_pk AND l.team_id = p_team
$function$;

-- ── 3. 매물 공통 · 매매가 ───────────────────────────────────────
ALTER TABLE app.listings ADD COLUMN price bigint CHECK (price > 0),
                         ADD COLUMN price_on date,
                         ADD COLUMN pp_land bigint,
                         ADD COLUMN pp_total bigint,
                         ADD COLUMN gongsi_ratio numeric;
COMMENT ON COLUMN app.listings.price IS '매매가(원) — 매물 하나에 하나(0226). 모르면 null';
-- 내 매물 값, 없으면 그 매물 광고에 걸었던 값(광고 가격 = 매물 매매가가 된다)
UPDATE app.listings l SET price = s.price, price_on = s.on_date
  FROM app.sale_prices s WHERE s.source = '내매물' AND s.listing_id = l.id;
UPDATE app.listings l SET price = s.price, price_on = s.on_date
  FROM app.sale_prices s JOIN app.ads a ON a.id = s.ad_id
 WHERE s.source = '빌탐정매물' AND a.listing_id = l.id AND l.price IS NULL;

-- 평단가 · 공시비율 — 산식 한 벌(0224 를 매물로 옮김)
CREATE OR REPLACE FUNCTION app.listing_price_derive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.price IS NULL THEN
    NEW.pp_land := NULL; NEW.pp_total := NULL; NEW.gongsi_ratio := NULL;
  ELSE
    SELECT CASE WHEN b.land_area > 0 THEN round(NEW.price * 3.305785 / b.land_area) END,
           CASE WHEN b.total_area > 0 THEN round(NEW.price * 3.305785 / b.total_area) END,
           CASE WHEN d.gongsi_total > 0 THEN round(d.gongsi_total / NEW.price::numeric * 100, 2) END
      INTO NEW.pp_land, NEW.pp_total, NEW.gongsi_ratio
      FROM master.buildings b LEFT JOIN master.building_derived d ON d.building_pk = b.building_pk
     WHERE b.building_pk = NEW.building_pk;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER t_listing_price BEFORE INSERT OR UPDATE OF price, building_pk ON app.listings
  FOR EACH ROW EXECUTE FUNCTION app.listing_price_derive();
UPDATE app.listings SET price = price;

CREATE FUNCTION app.listings_rederive() RETURNS bigint LANGUAGE sql AS $$
  WITH u AS (UPDATE app.listings SET price = price WHERE price IS NOT NULL RETURNING 1) SELECT count(*) FROM u;
$$;
CREATE OR REPLACE FUNCTION master.refresh_building_derived() RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  n := master.refresh_building_derived_core();
  PERFORM app.listings_rederive();           -- 매물의 평단가 · 공시비율은 공시총액을 따라간다(0226)
  RETURN n;
END $$;

-- ── 4. 수집 매물 ───────────────────────────────────────────────
CREATE TABLE app.listing_crawl (
  listing_id    bigint PRIMARY KEY REFERENCES app.listings(id) ON DELETE CASCADE,
  seen_on       date NOT NULL,                 -- 마지막으로 보인 수집일
  gone_on       date,                          -- 끝까지 다 돈 수집에서 안 보인 첫날 — 있으면 닫힘
  n_ads         int,
  posted_on     date,
  ad_land_area  numeric,
  ad_total_area numeric,
  ad_use_type   text);
COMMENT ON TABLE app.listing_crawl IS '수집 매물의 수집 정보(0226). 주인은 수집 사무소(teams.system). 수집처 이름 = 사무소 이름';

-- 수집 기록에 매매가 칸을 되돌린다(0224 에서 sale_prices 로 옮겼던 것) — 날마다의 시계열
ALTER TABLE master.market_sale ADD COLUMN price bigint;
UPDATE master.market_sale m SET price = s.price
  FROM app.sale_prices s
 WHERE s.source = '네이버매물' AND s.building_pk = m.building_pk AND s.on_date = m.observed_on;

-- 최근 수집일의 줄 → 수집 사무소 매물
WITH t AS (SELECT id FROM app.teams WHERE system AND name = '네이버'),
     d AS (SELECT max(observed_on) AS day FROM master.market_sale)
INSERT INTO app.listings(building_pk, team_id, price, price_on)
SELECT m.building_pk, t.id, m.price, m.observed_on
  FROM master.market_sale m, t, d WHERE m.observed_on = d.day;
INSERT INTO app.listing_crawl(listing_id, seen_on, n_ads, posted_on, ad_land_area, ad_total_area, ad_use_type)
SELECT l.id, m.observed_on, m.n_ads, m.posted_on, m.land_area, m.total_area, m.use_type
  FROM app.listings l JOIN app.teams t ON t.id = l.team_id AND t.system
  JOIN master.market_sale m ON m.building_pk = l.building_pk AND m.observed_on = l.price_on;

-- ── 5. 광고 — 노출 기록만 ───────────────────────────────────────
DROP INDEX IF EXISTS app.ads_team;
DROP INDEX IF EXISTS app.ads_building;
CREATE INDEX ads_listing ON app.ads(listing_id) WHERE state IN ('노출', '거래완료');
ALTER TABLE app.ads ALTER COLUMN listing_id SET NOT NULL;
ALTER TABLE app.ads DROP COLUMN team_id, DROP COLUMN building_pk, DROP COLUMN deal, DROP COLUMN brokerage,
                    DROP COLUMN use_type, DROP COLUMN deposit, DROP COLUMN monthly_rent, DROP COLUMN loan,
                    DROP COLUMN loan_open, DROP COLUMN move_in, DROP COLUMN move_in_on;

-- ── 6. 매물 공통에서 관리 칸 지우기 ─────────────────────────────
DROP INDEX IF EXISTS app.listings_claim;
DROP INDEX IF EXISTS app.listings_owner_idx;
ALTER TABLE app.listings
  DROP COLUMN assignee_account_id, DROP COLUMN urgency, DROP COLUMN grade, DROP COLUMN ipji, DROP COLUMN intent,
  DROP COLUMN listing_no, DROP COLUMN received_on, DROP COLUMN meongdo, DROP COLUMN use_change, DROP COLUMN myeolsil,
  DROP COLUMN nohudo, DROP COLUMN building_use, DROP COLUMN owner_id, DROP COLUMN call_result, DROP COLUMN sell_on,
  DROP COLUMN sell_vague, DROP COLUMN rent_check, DROP COLUMN total_deposit, DROP COLUMN total_rent, DROP COLUMN total_mgmt,
  DROP COLUMN ask_price, DROP COLUMN vacant_area, DROP COLUMN rent_full, DROP COLUMN full_est, DROP COLUMN exclusive,
  DROP COLUMN checked_on, DROP COLUMN building_major, DROP COLUMN price_vs_market, DROP COLUMN status_id,
  DROP COLUMN sold_on, DROP COLUMN sold_price, DROP COLUMN hold_reason, DROP COLUMN loan, DROP COLUMN loan_open,
  DROP COLUMN move_in, DROP COLUMN move_in_on;
CREATE INDEX listings_building ON app.listings(building_pk);

-- 사람 사무소 매물 + 관리 칸을 한 줄로 읽는 곳(읽기 전용). 쓰기는 listings · listing_office 에 바로 한다
CREATE VIEW app.office_listings AS
SELECT l.id, l.team_id, l.building_pk, l.price, l.price_on, l.pp_land, l.pp_total, l.gongsi_ratio,
       l.created_at, GREATEST(l.updated_at, o.updated_at) AS updated_at,
       o.assignee_account_id, o.listing_no, o.received_on, o.owner_id, o.status_id, o.hold_reason, o.sold_on,
       o.sold_price, o.ask_price, o.total_deposit, o.total_rent, o.total_mgmt, o.vacant_area, o.rent_full,
       o.full_est, o.building_major, o.building_use, o.grade, o.ipji, o.nohudo, o.price_vs_market, o.exclusive,
       o.checked_on, o.urgency, o.intent, o.meongdo, o.use_change, o.myeolsil, o.sell_on, o.sell_vague,
       o.call_result, o.rent_check, o.loan, o.loan_open, o.move_in, o.move_in_on
  FROM app.listings l JOIN app.listing_office o ON o.listing_id = l.id;
COMMENT ON VIEW app.office_listings IS '사람 사무소 매물 + 관리 칸(0226). 읽기 전용';

-- ── 7. 읽는 곳 하나 — 누가 무엇을 보나 · 건물 안 순번 ─────────────
--   내 사무소        그 사무소 · 매각된 것도 낸다(closed) — 「지금 나와 있나」는 부르는 쪽이 closed 로 가린다
--   다른 사람 사무소  광고가 노출 중 · 기한 남음일 때 누구나 · 매매가는 가격 공개일 때만
--   수집 사무소       중개사만 · 내려가지 않은 것
--   순번(rank)       건물 안에서 ① 내 매물 ② 다른 사무소 광고 매물(지금은 최근 올린 순 · 나중엔 광고 티어) ③ 수집 매물
CREATE FUNCTION app.listings_now(p_team bigint, p_broker boolean)
RETURNS TABLE (listing_id bigint, team_id bigint, building_pk text, owner text, office text,
               price bigint, price_on date, pp_land bigint, pp_total bigint, gongsi_ratio numeric,
               ad_id bigint, closed boolean, rank int)
LANGUAGE sql STABLE AS $$
  WITH v AS (
    SELECT l.id, l.team_id, l.building_pk, 'mine'::text AS owner, COALESCE(t.office_name, t.name) AS office,
           l.price, l.price_on, l.pp_land, l.pp_total, l.gongsi_ratio,
           (SELECT a.id FROM app.ads a WHERE a.listing_id = l.id AND a.state IN ('노출', '비노출')
             ORDER BY a.id DESC LIMIT 1) AS ad_id,
           o.hold_reason IS NOT DISTINCT FROM '매각됨' AS closed, 1 AS grp, NULL::date AS ord
      FROM app.listings l JOIN app.listing_office o ON o.listing_id = l.id JOIN app.teams t ON t.id = l.team_id
     WHERE p_team IS NOT NULL AND l.team_id = p_team
    UNION ALL
    SELECT l.id, l.team_id, l.building_pk, 'office', COALESCE(t.office_name, t.name),
           CASE WHEN a.price_open THEN l.price END, l.price_on,
           CASE WHEN a.price_open THEN l.pp_land END, CASE WHEN a.price_open THEN l.pp_total END,
           CASE WHEN a.price_open THEN l.gongsi_ratio END,
           a.id, false, 2, a.posted_on
      FROM app.listings l JOIN app.teams t ON t.id = l.team_id AND NOT t.system
      JOIN app.ads a ON a.listing_id = l.id AND a.state = '노출' AND a.expires_on >= current_date
     WHERE l.team_id IS DISTINCT FROM p_team
    UNION ALL
    SELECT l.id, l.team_id, l.building_pk, 'crawl', COALESCE(t.office_name, t.name),
           l.price, l.price_on, l.pp_land, l.pp_total, l.gongsi_ratio, NULL, false, 3, NULL
      FROM app.listings l JOIN app.teams t ON t.id = l.team_id AND t.system
      JOIN app.listing_crawl c ON c.listing_id = l.id AND c.gone_on IS NULL
     WHERE p_broker)
  SELECT id, team_id, building_pk, owner, office, price, price_on, pp_land, pp_total, gongsi_ratio, ad_id, closed,
         (row_number() OVER (PARTITION BY building_pk ORDER BY closed, grp, ord DESC NULLS LAST, id))::int
    FROM v;
$$;
COMMENT ON FUNCTION app.listings_now IS '매물 읽기 한 곳(0226) — 공개 범위 · 건물 안 순번(rank 1 = 핀에 서는 매물)';

-- ── 8. 0224 걷기 ───────────────────────────────────────────────
DROP FUNCTION app.sale_prices_now(bigint, boolean);
DROP FUNCTION app.sale_prices_rederive();
DROP TABLE app.sale_prices;
DROP FUNCTION app.sale_price_derive();

COMMIT;
