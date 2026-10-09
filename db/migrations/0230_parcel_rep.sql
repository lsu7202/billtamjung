-- 0230 · 지번 값 표 · 매물 순번을 지번으로(2026-10-06 · specs/04-data/매물-중심.md §5 · §5-2 · §6-3,4)
--
-- 보는 단위는 지번이다. 지번마다 **대표 건물**(연면적 큰 동 · 같으면 번호 작은 동)을 하나 두고,
-- 검색 · 핀 · 모델 줄은 대표 건물 줄로만 선다. 건물 칸은 아래 규칙으로 모은 지번 값으로 바꿔 낀다.
--   연면적 · 건축면적 · 용적산정연면적 · 주차 · 승강기  합계
--   지상 · 지하층수 · 높이                              가장 높은 동
--   주용도 · 구조                                      동마다 목록(하나라도 맞으면 걸린다)
--   그 밖(사용승인일 등)                               대표 건물 값
-- **대장 그대로 센다.** 겹쳐 보이는 기록도 판정하지 않는다(10-06 대표).
-- 지번을 모르는 건물(pnu 없음)은 저 혼자 지번처럼 선다.
-- 대장 재적재 뒤 REFRESH 는 파이프라인 때 같이 넣는다(docs/할일.md).
BEGIN;

CREATE MATERIALIZED VIEW master.parcel_rep AS
SELECT COALESCE(b.pnu, 'B' || b.building_pk) AS pkey,
       b.pnu,
       (array_agg(b.building_pk ORDER BY b.total_area DESC NULLS LAST, b.building_pk))[1] AS rep_pk,
       count(*)::int AS n_bldg,
       sum(b.total_area)  AS total_area,
       sum(b.build_area)  AS build_area,
       sum(b.far_area)    AS far_area,
       sum(b.parking)::int  AS parking,
       sum(b.elevator)::int AS elevator,
       max(b.floors_above) AS floors_above,
       max(b.floors_below) AS floors_below,
       max(b.height)       AS height,
       array_agg(DISTINCT b.main_use_name) FILTER (WHERE b.main_use_name IS NOT NULL) AS uses,
       array_agg(DISTINCT b.structure)     FILTER (WHERE b.structure IS NOT NULL)     AS structures
  FROM master.buildings b
 GROUP BY COALESCE(b.pnu, 'B' || b.building_pk), b.pnu;
CREATE UNIQUE INDEX parcel_rep_pkey ON master.parcel_rep(pkey);
CREATE UNIQUE INDEX parcel_rep_rep ON master.parcel_rep(rep_pk);
CREATE INDEX parcel_rep_pnu ON master.parcel_rep(pnu);

-- 아무 동의 번호 → 그 지번의 대표 건물 번호
CREATE FUNCTION app.rep_of(p_pk text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT r.rep_pk FROM master.buildings b JOIN master.parcel_rep r ON r.pkey = COALESCE(b.pnu, 'B' || b.building_pk)
   WHERE b.building_pk = p_pk
$$;

-- 매물 읽기 · 순번(0226)을 지번으로. building_pk 는 **그 지번의 대표 건물**, pnu 는 매물의 대표 지번
DROP FUNCTION app.listings_now(bigint, boolean);
CREATE FUNCTION app.listings_now(p_team bigint, p_broker boolean)
 RETURNS TABLE(listing_id bigint, team_id bigint, building_pk text, pnu text, owner text, office text, price bigint,
               price_on date, pp_land bigint, pp_total bigint, gongsi_ratio numeric, ad_id bigint, closed boolean, rank integer)
 LANGUAGE sql STABLE AS $$
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
  SELECT v.id, v.team_id, r.rep_pk, lp.pnu, v.owner, v.office, v.price, v.price_on, v.pp_land, v.pp_total,
         v.gongsi_ratio, v.ad_id, v.closed,
         (row_number() OVER (PARTITION BY lp.pnu ORDER BY v.closed, v.grp, v.ord DESC NULLS LAST, v.id))::int
    FROM v JOIN app.listing_parcels lp ON lp.listing_id = v.id AND lp.main
    LEFT JOIN master.parcel_rep r ON r.pnu = lp.pnu;
$$;

COMMIT;
