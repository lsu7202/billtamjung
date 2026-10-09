-- 0225 저장한 조건의 옛 가격 이름 → 새 이름(0224 매매가 한 표)
--
-- 매매가가 하나가 되면서 검색 필터 이름도 하나가 됐다. 저장해 둔 조건에 옛 이름이 남으면
-- 필터 모델(extra=forbid)이 422 로 거절해 그 조건이 통째로 안 돈다.
--   listing_price_min/max          → price_min/max(이미 있으면 그 값을 둔다)
--   pp_land_team · pp_total_team · gongsi_ratio_team → *_sale
--   value_* · ad_price_* · mk_price_* → 지운다(모델 전용이던 이름. 매매가 하나로 들어갔다)
BEGIN;

CREATE FUNCTION pg_temp.fix(f jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(f) <> 'object' THEN f ELSE (
    SELECT COALESCE(jsonb_object_agg(k2, v), '{}'::jsonb) FROM (
      SELECT DISTINCT ON (k2) k2, v FROM (
        SELECT CASE
                 WHEN k = 'listing_price_min' THEN 'price_min'
                 WHEN k = 'listing_price_max' THEN 'price_max'
                 WHEN k ~ '^(pp_land|pp_total|gongsi_ratio)_team_(min|max)$' THEN replace(k, '_team_', '_sale_')
                 ELSE k END AS k2,
               v, (k LIKE 'listing_price_%') AS from_old
          FROM jsonb_each(f) AS e(k, v)
         WHERE k !~ '^(value|ad_price|mk_price)_(min|max)$') x
       ORDER BY k2, (v = 'null'::jsonb), from_old) y) END
$$;

UPDATE app.saved_searches SET conditions_json = jsonb_set(conditions_json, '{filters}', pg_temp.fix(conditions_json->'filters'))
 WHERE jsonb_typeof(conditions_json->'filters') = 'object';
UPDATE app.buyer_conditions SET conditions_json = jsonb_set(conditions_json, '{filters}', pg_temp.fix(conditions_json->'filters'))
 WHERE jsonb_typeof(conditions_json->'filters') = 'object';

COMMIT;
