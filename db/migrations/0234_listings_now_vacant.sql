-- 0234 · 나대지 매물의 건물번호 = 'P' + 지번번호(옛 규칙) — 지번에 건물이 없으면 대표 건물이 없다(2026-10-06)
BEGIN;
CREATE OR REPLACE FUNCTION app.listings_now(p_team bigint, p_broker boolean)
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
  SELECT v.id, v.team_id, COALESCE(r.rep_pk, 'P' || lp.pnu), lp.pnu, v.owner, v.office, v.price, v.price_on, v.pp_land, v.pp_total,
         v.gongsi_ratio, v.ad_id, v.closed,
         (row_number() OVER (PARTITION BY lp.pnu ORDER BY v.closed, v.grp, v.ord DESC NULLS LAST, v.id))::int
    FROM v JOIN app.listing_parcels lp ON lp.listing_id = v.id AND lp.main
    LEFT JOIN master.parcel_rep r ON r.pnu = lp.pnu;
$$;
COMMIT;
