-- 0224 매매가는 한 표에 (2026-10-05 대표)
--
-- 매물로 내놓은 값은 뜻이 하나다. 내 매물에 적은 값, 빌탐정 광고에 건 값, 네이버에 올라온 값은
-- 누가 내놓았느냐만 다르다. 예전엔 셋이 listings.sale_price · ads.price · market_sale.price 에 따로 살고
-- 읽는 곳마다 이름(team_price · ad_price_min · mk_price · listing_price · price)을 새로 붙였다.
-- 읽는 쪽이 출처마다 하나를 골라 나머지를 버리니, 매매가가 빈 내 매물은 네이버 값이 있어도 가격이 없었다.
--
-- 이제 매매가는 app.sale_prices 한 표다. 한 줄 = 매매가 하나, 출처는 칸이다.
--   내매물      매물 하나에 한 줄(listing_id). 이력은 field_events 가 든다
--   빌탐정매물  광고 하나에 한 줄(ad_id)
--   네이버매물  건물 × 수집일 한 줄. 날마다 쌓여 시계열이 된다
-- 읽는 곳은 app.sale_prices_now(사무소, 중개사인가) 하나다. 누가 무엇을 보나 · 출처마다 지금 값은 여기서만 정한다.
-- 평단가 · 공시비율은 줄에 저장한다(트리거 + 밤 배치 뒤 다시 계산). 수익률은 임대료와 짝이라 읽을 때 계산한다.
-- 매각금액(sold_price) · 매도희망가(ask_price) · 실거래가는 매매가가 아니다 — 옮기지 않는다.
BEGIN;

CREATE TABLE app.sale_prices (
  id            bigserial PRIMARY KEY,
  building_pk   text NOT NULL,
  source        text NOT NULL CHECK (source IN ('내매물', '빌탐정매물', '네이버매물')),
  price         bigint NOT NULL CHECK (price > 0),       -- 원. 모르면 줄을 만들지 않는다
  on_date       date NOT NULL,                           -- 내매물=적은 날 · 빌탐정매물=올린 날 · 네이버매물=수집일
  listing_id    bigint REFERENCES app.listings(id) ON DELETE CASCADE,
  ad_id         bigint REFERENCES app.ads(id) ON DELETE CASCADE,
  n_ads         int,                                     -- 네이버매물만 — 그날 같은 건물 광고 수
  pp_land       bigint,                                  -- 매매가 ÷ 대지(원/평)
  pp_total      bigint,                                  -- 매매가 ÷ 연면적(원/평)
  gongsi_ratio  numeric,                                 -- 공시총액 ÷ 매매가(%)
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((source = '내매물')     = (listing_id IS NOT NULL)),
  CHECK ((source = '빌탐정매물') = (ad_id IS NOT NULL)),
  CHECK (source = '네이버매물' OR n_ads IS NULL));
CREATE UNIQUE INDEX sale_prices_listing ON app.sale_prices(listing_id) WHERE source = '내매물';
CREATE UNIQUE INDEX sale_prices_ad      ON app.sale_prices(ad_id)      WHERE source = '빌탐정매물';
CREATE UNIQUE INDEX sale_prices_naver   ON app.sale_prices(building_pk, on_date) WHERE source = '네이버매물';
CREATE INDEX sale_prices_day ON app.sale_prices(source, on_date, building_pk);
CREATE INDEX sale_prices_bpk ON app.sale_prices(building_pk);
COMMENT ON TABLE app.sale_prices IS '매매가 한 곳(0224). 한 줄 = 매매가 하나 · 출처는 칸. 읽기는 app.sale_prices_now 로만';

-- 평단가 · 공시비율 — 산식은 여기 한 벌. 트리거와 밤 배치가 같이 부른다
CREATE FUNCTION app.sale_price_derive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT CASE WHEN b.land_area > 0 THEN round(NEW.price * 3.305785 / b.land_area) END,
         CASE WHEN b.total_area > 0 THEN round(NEW.price * 3.305785 / b.total_area) END,
         CASE WHEN d.gongsi_total > 0 THEN round(d.gongsi_total / NEW.price::numeric * 100, 2) END
    INTO NEW.pp_land, NEW.pp_total, NEW.gongsi_ratio
    FROM master.buildings b LEFT JOIN master.building_derived d ON d.building_pk = b.building_pk
   WHERE b.building_pk = NEW.building_pk;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER t_sale_price_derive BEFORE INSERT OR UPDATE OF price, building_pk ON app.sale_prices
  FOR EACH ROW EXECUTE FUNCTION app.sale_price_derive();

-- 공시지가 · 면적이 바뀐 뒤(밤 배치) 다시 계산 — 같은 트리거를 태운다
CREATE FUNCTION app.sale_prices_rederive() RETURNS bigint LANGUAGE sql AS $$
  WITH u AS (UPDATE app.sale_prices SET price = price RETURNING 1) SELECT count(*) FROM u;
$$;
ALTER FUNCTION master.refresh_building_derived() RENAME TO refresh_building_derived_core;
CREATE FUNCTION master.refresh_building_derived() RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  n := master.refresh_building_derived_core();
  PERFORM app.sale_prices_rederive();        -- 매매가 줄의 평단가 · 공시비율은 공시총액을 따라간다(0224)
  RETURN n;
END $$;

-- 읽는 곳 하나 — 누가 무엇을 보나 · 출처마다 지금 값
--   내매물      그 사무소만. 매각된 매물도 내준다(sold) — 「지금 나와 있나」는 부르는 쪽이 sold 로 가린다
--   빌탐정매물  노출 중 · 기한 남음 · 가격 공개. 누구나
--   네이버매물  중개사만. 가장 최근 수집일의 줄만 — 그날 수집에 없으면 지금은 안 나와 있다
CREATE FUNCTION app.sale_prices_now(p_team bigint, p_broker boolean)
RETURNS TABLE (building_pk text, source text, price bigint, on_date date, n_ads int,
               pp_land bigint, pp_total bigint, gongsi_ratio numeric,
               listing_id bigint, ad_id bigint, sold boolean)
LANGUAGE sql STABLE AS $$
  SELECT s.building_pk, s.source, s.price, s.on_date, NULL::int, s.pp_land, s.pp_total, s.gongsi_ratio,
         s.listing_id, NULL::bigint, l.hold_reason IS NOT DISTINCT FROM '매각됨'
    FROM app.sale_prices s JOIN app.listings l ON l.id = s.listing_id
   WHERE s.source = '내매물' AND p_team IS NOT NULL AND l.team_id = p_team
  UNION ALL
  SELECT s.building_pk, s.source, s.price, s.on_date, NULL, s.pp_land, s.pp_total, s.gongsi_ratio,
         NULL, s.ad_id, false
    FROM app.sale_prices s JOIN app.ads a ON a.id = s.ad_id
   WHERE s.source = '빌탐정매물' AND a.state = '노출' AND a.expires_on >= current_date AND a.price_open
  UNION ALL
  SELECT s.building_pk, s.source, s.price, s.on_date, s.n_ads, s.pp_land, s.pp_total, s.gongsi_ratio,
         NULL, NULL, false
    FROM app.sale_prices s
   WHERE s.source = '네이버매물' AND p_broker
     AND s.on_date = (SELECT max(x.on_date) FROM app.sale_prices x WHERE x.source = '네이버매물');
$$;

-- 옮기기
INSERT INTO app.sale_prices(building_pk, source, price, on_date, listing_id)
SELECT building_pk, '내매물', sale_price, COALESCE(updated_at::date, received_on, current_date), id
  FROM app.listings WHERE sale_price > 0;
INSERT INTO app.sale_prices(building_pk, source, price, on_date, ad_id)
SELECT building_pk, '빌탐정매물', price, COALESCE(posted_on, created_at::date), id
  FROM app.ads WHERE price > 0 AND building_pk IS NOT NULL;
INSERT INTO app.sale_prices(building_pk, source, price, on_date, n_ads)
SELECT building_pk, '네이버매물', price, observed_on, n_ads
  FROM master.market_sale WHERE price > 0;

-- 만실 수익률은 이제 읽을 때 낸다 — 만실 월임대(rent_full)만 접는다
CREATE OR REPLACE FUNCTION app.listing_full_fold(p_pk text, p_team bigint)
 RETURNS void LANGUAGE sql AS $function$
  WITH rows AS (
    SELECT floor, rent, contract_area, app.unit_occupied(tenant_name, place_ref, rent) AS occ
      FROM app.floor_rents
     WHERE building_pk = p_pk AND team_id = p_team AND deleted_at IS NULL
  ), vac AS (          -- 층마다 공실 호실 면적의 합. 면적 모르는 공실이 있으면 그 층은 모름(null)
    SELECT app.floor_signed(floor) AS floor_no,
           CASE WHEN bool_or(contract_area IS NULL) THEN NULL ELSE sum(contract_area) END AS vacant_area
      FROM rows WHERE NOT occ GROUP BY 1
  ), act AS (          -- 같은 층 실측 평당가(원/㎡)
    SELECT app.floor_signed(floor) AS fno, sum(rent)::numeric / sum(contract_area) AS p
      FROM rows WHERE occ AND rent > 0 AND contract_area > 0 GROUP BY 1
  ), est AS (          -- 층별 추정 평당가(원/㎡)
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
  UPDATE app.listings l
     SET rent_full = CASE WHEN k.ok AND l.total_rent IS NOT NULL THEN round(l.total_rent + k.add) END,
         full_est  = CASE WHEN k.ok AND l.total_rent IS NOT NULL THEN k.est END
    FROM (SELECT n > 0 AND miss = 0 AND unknown_rent = 0
                 AND app.listing_vacancy(p_pk, p_team) IS NOT NULL AS ok, add, est FROM g) k
   WHERE l.building_pk = p_pk AND l.team_id = p_team
$function$;

-- 옛 칸 — 매매가 셋과, 내 매물 매매가 하나로 나눠 두던 파생 다섯
ALTER TABLE app.listings DROP COLUMN sale_price, DROP COLUMN roi, DROP COLUMN roi_full,
                         DROP COLUMN pp_land_team, DROP COLUMN pp_total_team, DROP COLUMN gongsi_ratio_team;
ALTER TABLE app.ads DROP COLUMN price;
ALTER TABLE master.market_sale DROP COLUMN price;

COMMIT;
