-- 0173 · 팀이 건물에 적는 값을 매물 줄 한 곳에 (2026-09-17)
--
-- 왜: 팀이 건물 하나에 적는 돈이 세 표에 갈려 있었다. 매매가·매도희망가는 app.overlays(범용
--     덧칠 서랍, field='sale_price'), 총임대는 app.listings, 층별은 app.floor_rents. 수익률은
--     어디에도 없어 검색(search.py)·매수자(buyers.py)·상세(buildings.py)가 저마다 세 표를 조인해
--     나눴고 산식이 세 벌이었다(상세는 분모에 추정가를 섞기까지 했다). 대표: 「매매가 희망가,
--     총임대보증금관리비 수익률 등등이 한 자리에 있어야 한다」.
--
-- 무엇: listings 에 값 칸을 둔다. 팀이 적는 순간(mirror.listing_values_fold) 층별 합계·수익률을
--       여기로 접고, 읽는 쪽은 이 줄만 읽는다. overlays 는 **대장값 정정**(승강기·건폐율 …)에만 쓴다.
--       브리핑 코멘트(briefing_comment)는 지운다 — 브리핑 화면은 남고 코멘트 칸만 없어진다.
--
-- 주의: 프로덕션에도 이 파일 그대로 apply.sh 로 돈다. overlays 의 가격 줄을 옮긴 뒤 지우므로
--       되돌리려면 field_events(값 이력)를 본다 — 거기엔 그대로 남아 있다.

ALTER TABLE app.listings
  ADD COLUMN IF NOT EXISTS sale_price       bigint,          -- 매매가(중개인 판단). 원
  ADD COLUMN IF NOT EXISTS ask_price        bigint,          -- 매도희망가(건물주). 원
  ADD COLUMN IF NOT EXISTS total_rent_exvac bigint,          -- 공실 뺀 월임대 합(층별 있을 때만)
  ADD COLUMN IF NOT EXISTS vacant_cnt       int,             -- 공실 층 수(층별 있을 때만)
  ADD COLUMN IF NOT EXISTS roi              numeric(6,2),    -- 총임대×12 ÷ 매매가 (%)
  ADD COLUMN IF NOT EXISTS roi_exvac        numeric(6,2);    -- 공실 뺀 것 ÷ 매매가 (%)

COMMENT ON COLUMN app.listings.sale_price IS '매매가(원). 팀 판단. 0173 에서 overlays 에서 옮김';
COMMENT ON COLUMN app.listings.ask_price  IS '매도희망가(원). 건물주. 0173 에서 overlays 에서 옮김';
COMMENT ON COLUMN app.listings.roi        IS '수익률(%) = 총임대×12 ÷ 매매가. mirror.listing_values_fold 가 채운다';

-- 가격 오버레이가 있는 (팀, 건물)에 매물 줄이 없으면 만든다(담당자 없는 줄 = col normal)
INSERT INTO app.listings(building_pk, team_id)
SELECT DISTINCT o.target_id, o.team_id FROM app.overlays o
 WHERE o.target_type='building' AND o.field IN ('sale_price','ask_price') AND o.value ~ '^[0-9]+$'
ON CONFLICT (building_pk, team_id) DO NOTHING;

UPDATE app.listings l SET sale_price = o.value::bigint
  FROM app.overlays o
 WHERE o.team_id=l.team_id AND o.target_type='building' AND o.target_id=l.building_pk
   AND o.field='sale_price' AND o.value ~ '^[0-9]+$';
UPDATE app.listings l SET ask_price = o.value::bigint
  FROM app.overlays o
 WHERE o.team_id=l.team_id AND o.target_type='building' AND o.target_id=l.building_pk
   AND o.field='ask_price' AND o.value ~ '^[0-9]+$';

-- 층별 실측이 있는 줄은 그 합계로 접는다(층별 > 직접 입력, 0134 규칙 그대로)
WITH agg AS (
  SELECT building_pk, team_id, SUM(rent) AS rent, SUM(deposit) AS deposit, SUM(maintenance) AS mgmt,
         SUM(rent) FILTER (WHERE is_vacant IS NOT TRUE) AS rent_exvac,
         count(*) FILTER (WHERE is_vacant) AS vacant
    FROM app.floor_rents WHERE deleted_at IS NULL GROUP BY building_pk, team_id)
UPDATE app.listings l
   SET total_rent=a.rent, total_deposit=a.deposit, total_mgmt=a.mgmt,
       total_rent_exvac=a.rent_exvac, vacant_cnt=a.vacant
  FROM agg a WHERE a.building_pk=l.building_pk AND a.team_id=l.team_id;

UPDATE app.listings
   SET roi       = CASE WHEN total_rent > 0 AND sale_price > 0 THEN round(total_rent*12.0/sale_price*100, 2) END,
       roi_exvac = CASE WHEN total_rent_exvac > 0 AND sale_price > 0 THEN round(total_rent_exvac*12.0/sale_price*100, 2) END;

-- 옮긴 가격 줄과 브리핑 코멘트는 오버레이에서 걷는다(이력은 field_events 에 남는다)
DELETE FROM app.overlays WHERE field IN ('sale_price','ask_price','briefing_comment');
