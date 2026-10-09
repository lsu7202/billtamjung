-- 매물 열쇠는 listing_id · 위치는 listing_parcels 뿐 (2026-10-08 · 스펙 12 §3-3 · 매물-중심 §5-0)
--
-- 0229 · 0232 가 매물을 지번 단위로 바꾸면서 listings.building_pk 를 지우지 않고 「대표 동 번호」(나대지는 'P'+지번)로
-- 채워 옛 코드를 돌게 했다 — 덮개다. 매물 위치가 두 곳(지번 정본 · 건물 번호 잔재)에 적혀 있었다.
-- 이 마이그레이션은 잔재 칸을 지운다. 읽던 곳은 칸이 없어져 터지는 대로 같은 묶음에서 옮긴다(덮개를 다시 두지 않는다).
--
-- 먼저 옮길 값: 매물 기록(contacts) 263줄이 건물 번호 문자열(target_id)로 매물을 가리켰다 → listing_id.
-- 지우는 것: listings.building_pk(유일 키 · 대표 동 트리거 t_rep · 지번 채움 트리거 t_parcel) · rep_of ·
--   photos · proposals · schedules 의 building_pk · proposal_from_listing · view_log(쓰기만 하고 읽는 곳 없음).
-- floor_rents.building_pk 는 남는다 — 층은 동의 것이다(임대 줄 하나 = 동 하나의 층).

BEGIN;

-- ── 매물 기록 · 값 이력: listing_id ──
ALTER TABLE app.contacts ADD COLUMN IF NOT EXISTS listing_id bigint REFERENCES app.listings(id) ON DELETE CASCADE;
UPDATE app.contacts c SET listing_id = l.id
  FROM app.listings l WHERE c.target_type = 'listing' AND l.building_pk = c.target_id AND l.team_id = c.team_id;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM app.contacts WHERE target_type = 'listing' AND listing_id IS NULL) THEN
    RAISE EXCEPTION '매물을 못 찾은 매물 기록이 있다 — 옮기지 않고 멈춘다';
  END IF;
END $$;
ALTER TABLE app.contacts ALTER COLUMN target_id DROP NOT NULL;
UPDATE app.contacts SET target_id = NULL WHERE target_type = 'listing';
ALTER TABLE app.contacts ADD CONSTRAINT contacts_listing_key
  CHECK ((target_type = 'listing') = (listing_id IS NOT NULL) AND (target_type <> 'listing' OR target_id IS NULL));
CREATE INDEX IF NOT EXISTS contacts_listing ON app.contacts (listing_id, occurred_on DESC) WHERE listing_id IS NOT NULL;
COMMENT ON COLUMN app.contacts.listing_id IS '매물 기록이면 그 매물. 건물 번호로 가리키지 않는다(0255)';

ALTER TABLE app.field_events ADD COLUMN IF NOT EXISTS listing_id bigint REFERENCES app.listings(id) ON DELETE CASCADE;
ALTER TABLE app.field_events ALTER COLUMN target_id DROP NOT NULL;
ALTER TABLE app.field_events ADD CONSTRAINT field_events_listing_key
  CHECK ((target_type = 'listing') = (listing_id IS NOT NULL) AND (target_type <> 'listing' OR target_id IS NULL));

-- ── 매물 확인일 · 공실 · 만실 — 매물(listing_id) 하나로 ──
DROP FUNCTION IF EXISTS app.listing_checked_fold(text, bigint) CASCADE;
CREATE FUNCTION app.listing_checked_fold(p_listing bigint) RETURNS void LANGUAGE sql AS $$
  UPDATE app.listing_office o
     SET checked_on = (SELECT max(c.occurred_on) FROM app.contacts c WHERE c.listing_id = p_listing AND NOT c.auto)
   WHERE o.listing_id = p_listing
$$;
CREATE OR REPLACE FUNCTION app.contacts_checked_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.listing_id IS NOT NULL THEN PERFORM app.listing_checked_fold(OLD.listing_id); END IF;
  IF TG_OP <> 'DELETE' AND NEW.listing_id IS NOT NULL THEN PERFORM app.listing_checked_fold(NEW.listing_id); END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS contacts_checked ON app.contacts;
CREATE TRIGGER contacts_checked AFTER INSERT OR DELETE OR UPDATE ON app.contacts
  FOR EACH ROW EXECUTE FUNCTION app.contacts_checked_trg();

-- 공실 면적 — 매물의 모든 동 층을 합친다(floor_rents.listing_id)
DROP FUNCTION IF EXISTS app.listing_full_fold(text, bigint);
DROP FUNCTION IF EXISTS app.listing_vacancy(text, bigint);
CREATE FUNCTION app.listing_vacancy(p_listing bigint) RETURNS numeric LANGUAGE sql STABLE AS $$
  WITH v AS (SELECT contract_area FROM app.floor_rents WHERE listing_id = p_listing AND deleted_at IS NULL AND vacant)
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v) THEN NULL
              WHEN EXISTS (SELECT 1 FROM v WHERE contract_area IS NULL) THEN NULL
              ELSE (SELECT sum(contract_area) FROM v) END
$$;
CREATE FUNCTION app.listing_full_fold(p_listing bigint) RETURNS void LANGUAGE sql AS $$
  WITH rows AS (
    SELECT floor, rent, contract_area, app.unit_occupied(tenant_name, place_ref, rent) AS occ
      FROM app.floor_rents WHERE listing_id = p_listing AND deleted_at IS NULL
  ), vac AS (
    SELECT app.floor_signed(floor) AS floor_no,
           CASE WHEN bool_or(contract_area IS NULL) THEN NULL ELSE sum(contract_area) END AS vacant_area
      FROM rows WHERE NOT occ GROUP BY 1
  ), act AS (
    SELECT app.floor_signed(floor) AS fno, sum(rent)::numeric / sum(contract_area) AS p
      FROM rows WHERE occ AND rent > 0 AND contract_area > 0 GROUP BY 1
  ), per AS (
    SELECT v.vacant_area, a.p FROM vac v LEFT JOIN act a ON a.fno = v.floor_no
  ), g AS (
    SELECT (SELECT count(*) FROM rows) AS n,
           (SELECT count(*) FROM rows WHERE occ AND COALESCE(rent, 0) = 0) AS unknown_rent,
           count(*) FILTER (WHERE vacant_area IS NULL OR (vacant_area > 0 AND p IS NULL)) AS miss,
           COALESCE(sum(vacant_area * p) FILTER (WHERE vacant_area > 0), 0) AS add
      FROM per
  )
  UPDATE app.listing_office o
     SET rent_full = CASE WHEN k.ok AND o.total_rent IS NOT NULL THEN round(o.total_rent + k.add) END
    FROM (SELECT n > 0 AND miss = 0 AND unknown_rent = 0 AND app.listing_vacancy(p_listing) IS NOT NULL AS ok, add FROM g) k
   WHERE o.listing_id = p_listing
$$;

-- ── 사진 · 임대 줄: 매물 번호를 반드시 받는다(건물 번호로 매물을 찾지 않는다) ──
CREATE OR REPLACE FUNCTION app.office_row_from_listing() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.listing_id IS NULL THEN
    RAISE EXCEPTION '매물 번호가 없습니다' USING ERRCODE = 'not_null_violation';
  END IF;
  SELECT l.team_id INTO NEW.team_id FROM app.listings l WHERE l.id = NEW.listing_id;
  RETURN NEW;
END $$;

-- ── 매매가로 나눈 셋 — 매물의 땅(지번들 · 딸린 필지 합)으로. 지번이 붙은 뒤에도 다시 센다 ──
-- 땅은 추정가(0250)와 같다: 대지 = 지번마다 대표 동에 딸린 필지와 그 지번 필지의 면적 합 · 연면적 = 지번 동 합 ·
-- 공시총액 = Σ 필지 면적 × 공시. 나대지도 같은 식이라 비지 않는다.
CREATE OR REPLACE FUNCTION app.listing_price_refresh(p_listing bigint) RETURNS void LANGUAGE sql AS $$
  WITH lp AS (SELECT pnu FROM app.listing_parcels WHERE listing_id = p_listing),
  land AS (
    SELECT p.area, p.gongsi_latest FROM master.parcels p
     WHERE p.pnu IN (SELECT pnu FROM lp
                     UNION SELECT bp.pnu FROM master.building_parcels bp
                             JOIN master.parcel_rep r ON r.rep_pk = bp.building_pk JOIN lp ON lp.pnu = r.pnu)),
  a AS (SELECT sum(area) AS la, sum(area * gongsi_latest) FILTER (WHERE gongsi_latest > 0) AS gt FROM land),
  t AS (SELECT sum(r.total_area) AS ta FROM master.parcel_rep r JOIN lp ON lp.pnu = r.pnu)
  UPDATE app.listings l SET
    pp_land = CASE WHEN l.price > 0 AND a.la > 0 THEN round(l.price * 3.305785 / a.la) END,
    pp_total = CASE WHEN l.price > 0 AND t.ta > 0 THEN round(l.price * 3.305785 / t.ta) END,
    gongsi_ratio = CASE WHEN l.price > 0 AND a.gt > 0 THEN round(a.gt / l.price::numeric * 100, 2) END
    FROM a, t WHERE l.id = p_listing
$$;
DROP TRIGGER IF EXISTS t_listing_price ON app.listings;
DROP FUNCTION IF EXISTS app.listing_price_derive();
CREATE OR REPLACE FUNCTION app.listing_price_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app.listing_price_refresh(CASE WHEN TG_TABLE_NAME = 'listings' THEN NEW.id
                                         WHEN TG_OP = 'DELETE' THEN OLD.listing_id ELSE NEW.listing_id END);
  RETURN NULL;
END $$;
CREATE TRIGGER t_listing_price AFTER INSERT OR UPDATE OF price ON app.listings
  FOR EACH ROW EXECUTE FUNCTION app.listing_price_trg();
CREATE TRIGGER t_listing_price AFTER INSERT OR UPDATE OR DELETE ON app.listing_parcels
  FOR EACH ROW EXECUTE FUNCTION app.listing_price_trg();

-- ── 잔재 칸 · 덮개 트리거 지우기 ──
DROP TRIGGER IF EXISTS t_rep ON app.listings;
DROP TRIGGER IF EXISTS t_parcel ON app.listings;
DROP FUNCTION IF EXISTS app.listing_pk_to_rep();
DROP FUNCTION IF EXISTS app.listing_parcel_from_building();
DROP TRIGGER IF EXISTS t_from_listing ON app.proposals;
DROP FUNCTION IF EXISTS app.proposal_from_listing();

DROP TRIGGER IF EXISTS t_from_listing ON app.photos;
CREATE TRIGGER t_from_listing BEFORE INSERT OR UPDATE OF listing_id, team_id ON app.photos
  FOR EACH ROW EXECUTE FUNCTION app.office_row_from_listing();
DROP TRIGGER IF EXISTS t_from_listing ON app.floor_rents;
CREATE TRIGGER t_from_listing BEFORE INSERT OR UPDATE OF listing_id, team_id ON app.floor_rents
  FOR EACH ROW EXECUTE FUNCTION app.office_row_from_listing();
DROP VIEW IF EXISTS app.office_listings;
ALTER TABLE app.listings DROP COLUMN IF EXISTS building_pk;
ALTER TABLE app.photos DROP COLUMN IF EXISTS building_pk;
ALTER TABLE app.proposals DROP COLUMN IF EXISTS building_pk;
ALTER TABLE app.schedules DROP COLUMN IF EXISTS building_pk;
DROP FUNCTION IF EXISTS app.rep_of(text);
DROP TABLE IF EXISTS app.view_log;

-- 사무소 매물 한 줄(관리 칸 포함) — 위치는 대표 지번(pnu)
CREATE VIEW app.office_listings AS
SELECT l.id, l.team_id, lp.pnu, l.price, l.price_on, l.pp_land, l.pp_total, l.gongsi_ratio, l.created_at,
       GREATEST(l.updated_at, o.updated_at) AS updated_at,
       o.assignee_account_id, o.listing_no, o.received_on, o.owner_id, o.status_id, o.hold_reason, o.sold_on, o.sold_price,
       o.ask_price, o.total_deposit, o.total_rent, o.total_mgmt, o.vacant_area, o.rent_full, o.building_major, o.building_use,
       o.grade, o.ipji, o.nohudo, o.price_vs_market, o.exclusive, o.checked_on, o.urgency, o.intent, o.meongdo, o.use_change,
       o.myeolsil, o.sell_on, o.sell_vague, o.call_result, o.rent_check, o.loan, o.loan_open, o.move_in, o.move_in_on
  FROM app.listings l
  JOIN app.listing_office o ON o.listing_id = l.id
  LEFT JOIN app.listing_parcels lp ON lp.listing_id = l.id AND lp.main;

-- 보이는 매물(순번) — 건물 번호 칸을 뺀다. 위치는 pnu, 그 지번의 대표 동이 필요하면 parcel_rep 로
DROP FUNCTION IF EXISTS app.listings_now(bigint, boolean);
CREATE FUNCTION app.listings_now(p_team bigint, p_broker boolean)
 RETURNS TABLE(listing_id bigint, team_id bigint, pnu text, owner text, office text, price bigint, price_on date,
               pp_land bigint, pp_total bigint, gongsi_ratio numeric, ad_id bigint, closed boolean, rank integer)
 LANGUAGE sql STABLE AS $function$
  WITH v AS (
    SELECT l.id, l.team_id, 'mine'::text AS owner, COALESCE(t.office_name, t.name) AS office,
           l.price, l.price_on, l.pp_land, l.pp_total, l.gongsi_ratio,
           (SELECT a.id FROM app.ads a WHERE a.listing_id = l.id AND a.state IN ('노출', '비노출')
             ORDER BY a.id DESC LIMIT 1) AS ad_id,
           o.hold_reason IS NOT DISTINCT FROM '매각됨' AS closed, 1 AS grp, NULL::date AS ord
      FROM app.listings l JOIN app.listing_office o ON o.listing_id = l.id JOIN app.teams t ON t.id = l.team_id
     WHERE p_team IS NOT NULL AND l.team_id = p_team
    UNION ALL
    SELECT l.id, l.team_id, 'office', COALESCE(t.office_name, t.name),
           CASE WHEN a.price_open THEN l.price END, l.price_on,
           CASE WHEN a.price_open THEN l.pp_land END, CASE WHEN a.price_open THEN l.pp_total END,
           CASE WHEN a.price_open THEN l.gongsi_ratio END,
           a.id, false, 2, a.posted_on
      FROM app.listings l JOIN app.teams t ON t.id = l.team_id AND NOT t.system
      JOIN app.ads a ON a.listing_id = l.id AND a.state = '노출' AND a.expires_on >= current_date
     WHERE l.team_id IS DISTINCT FROM p_team
    UNION ALL
    SELECT l.id, l.team_id, 'crawl', COALESCE(t.office_name, t.name),
           l.price, l.price_on, l.pp_land, l.pp_total, l.gongsi_ratio, NULL, false, 3, NULL
      FROM app.listings l JOIN app.teams t ON t.id = l.team_id AND t.system
      JOIN app.listing_crawl c ON c.listing_id = l.id AND c.gone_on IS NULL
     WHERE p_broker)
  SELECT v.id, v.team_id, lp.pnu, v.owner, v.office, v.price, v.price_on, v.pp_land, v.pp_total,
         v.gongsi_ratio, v.ad_id, v.closed,
         (row_number() OVER (PARTITION BY lp.pnu ORDER BY v.closed, v.grp, v.ord DESC NULLS LAST, v.id))::int
    FROM v JOIN app.listing_parcels lp ON lp.listing_id = v.id AND lp.main;
$function$;

-- 모델 매물 표 — 지번으로 대표 동 · 나대지를 찾는다
CREATE OR REPLACE FUNCTION ai.listing_rows(p_team bigint, p_broker boolean)
 RETURNS TABLE("매물ID" bigint, "주인" text, "지번코드" text, "주소" text, "도로명주소" text, "구" text, "동" text, "매매가_원" bigint, "매매가기준일" date, "평단가대지_원평" bigint, "평단가연면적_원평" bigint, "공시비율_pct" numeric, "대지면적_㎡" numeric, "연면적_㎡" numeric, "건축면적_㎡" numeric, "지상층수" integer, "지하층수" integer, "높이_m" numeric, "동수" integer, "주용도" text[], "구조" text, "용도지역" text, "지목" text, "도로접면" text, "지형형상" text, "지세" text, "사용승인일" date, "리모델링일" date, "승강기_대" integer, "주차대수_대" integer, "건폐율_pct" numeric, "용적률_pct" numeric, "법정건폐율_pct" numeric, "법정용적률_pct" numeric, "역거리_m" integer, "전면도로폭_m" numeric, "공시지가_원㎡" bigint, "공시총액_원" bigint, "공시5년상승_pct" numeric, "공시10년상승_pct" numeric, "최근실거래가_원" bigint, "최근실거래월" text, "실거래횟수_건" integer, "추정가_원" bigint, "수집일" date, "광고수" integer, "매물번호" text, "담당자" text, "상태" text, "보류사유" text, "접수일" date, "확인일" date, "매도희망가_원" bigint, "총보증금_원" bigint, "총월임대_원" bigint, "총관리비_원" bigint, "공실면적_㎡" numeric, "대분류" text, "소분류" text, "등급" text, "입지" text, "노후도" text, "시세대비" text, "전속" boolean, "급함" text, "매도의사" text, "명도" text, "용도변경" text, "멸실" text, "소유자유형" text, "관계" text, "협조" text, "친절" text, "매각일" date, "매각금액_원" bigint)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT n.listing_id,
         CASE n.owner WHEN 'mine' THEN '내 매물' WHEN 'crawl' THEN '네이버' ELSE n.office END,
         n.pnu, COALESCE(b.addr, vp.addr), b.road_addr, ri.gu, ri.dong,
         n.price::bigint, n.price_on, n.pp_land::bigint, n.pp_total::bigint, n.gongsi_ratio,
         COALESCE(b.land_area, vp.area), pr.total_area, pr.build_area, pr.floors_above, pr.floors_below, pr.height,
         pr.n_bldg, pr.uses, b.structure, COALESCE(b.use_zone, vp.use_zone), COALESCE(b.jimok, vp.jimok),
         COALESCE(b.road_frontage, vp.road_frontage), COALESCE(b.shape, vp.shape), COALESCE(b.slope, vp.slope),
         b.approval_ymd, b.remodel_ymd, pr.elevator, pr.parking,
         b.bcr, b.far, bl.legal_bcr, bl.legal_far,
         b.station_dist, br.front_m,
         COALESCE(b.gongsi_latest, vp.gongsi_latest), bd.gongsi_total, bd.gongsi_up5, bd.gongsi_up10,
         b.last_sale_price, b.last_sale_ym, sa.sale_cnt::integer,
         se.sale_est::bigint,   -- 지번 추정가(0250) — 여러 동 지번도 값 하나
         lc.seen_on, lc.n_ads,
         l.listing_no, a.name, st.name, l.hold_reason, l.received_on, l.checked_on,
         l.ask_price::bigint, l.total_deposit::bigint, l.total_rent::bigint, l.total_mgmt::bigint, l.vacant_area,
         l.building_major, l.building_use, l.grade, l.ipji, l.nohudo, l.price_vs_market, l.exclusive,
         l.urgency, l.intent, l.meongdo, l.use_change, l.myeolsil,
         ow.owner_type, ow.relation, ow.cooperation, ow.kindness,
         l.sold_on, l.sold_price::bigint
    FROM app.listings_now(p_team, p_broker) n
    LEFT JOIN master.parcel_rep pr ON pr.pnu = n.pnu
    LEFT JOIN master.buildings b ON b.building_pk = pr.rep_pk
    LEFT JOIN master.vacant_parcels vp ON pr.pnu IS NULL AND vp.pnu = n.pnu
    LEFT JOIN master.region_index ri ON ri.bjd_code = COALESCE(b.bjd_code, vp.bjd_code)
    LEFT JOIN master.parcel_sale_est se ON se.pnu = n.pnu
    LEFT JOIN master.building_legal bl ON bl.building_pk = b.building_pk
    LEFT JOIN master.building_road br ON br.building_pk = b.building_pk
    LEFT JOIN master.building_derived bd ON bd.building_pk = b.building_pk
    LEFT JOIN master.sales_agg sa ON sa.pnu = n.pnu
    LEFT JOIN app.listing_crawl lc ON lc.listing_id = n.listing_id
    -- 관리 칸은 내 사무소 매물에만 붙는다(남의 관리 칸은 안 읽는다)
    LEFT JOIN app.listing_office l ON l.listing_id = n.listing_id AND n.owner = 'mine'
    LEFT JOIN app.accounts a ON a.id = l.assignee_account_id
    LEFT JOIN app.statuses st ON st.id = l.status_id
    LEFT JOIN app.owners ow ON ow.id = l.owner_id AND ow.deleted_at IS NULL
   WHERE NOT n.closed
$function$;



-- 매매가로 나눈 셋을 새 땅 기준으로 다시 센다(지금 매물 전부)
SELECT app.listing_price_refresh(id) FROM app.listings;

COMMIT;
