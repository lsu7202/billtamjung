-- 0004_functions.sql — 트리거·함수
-- 근거: specs/04-data/schema-ddl.md §8, schema-ref.md §4, 01-상세설계 §3
BEGIN;

-- (1) updated_at 자동(신선도 원천)
CREATE OR REPLACE FUNCTION app.set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS t_upd ON app.listings;
CREATE TRIGGER t_upd BEFORE UPDATE ON app.listings   FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
DROP TRIGGER IF EXISTS t_upd ON app.overlays;
CREATE TRIGGER t_upd BEFORE UPDATE ON app.overlays   FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
DROP TRIGGER IF EXISTS t_upd ON app.floor_rents;
CREATE TRIGGER t_upd BEFORE UPDATE ON app.floor_rents FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- (2) 오버레이 검증(editable·enum code) — schema-ref §4
CREATE OR REPLACE FUNCTION app.validate_overlay() RETURNS trigger AS $$
DECLARE f ref.fields; BEGIN
  SELECT * INTO f FROM ref.fields WHERE field_key = NEW.field;
  IF NOT FOUND THEN RAISE EXCEPTION '알 수 없는 필드: %', NEW.field; END IF;
  IF NOT f.editable THEN RAISE EXCEPTION '수정 불가 필드: %', NEW.field; END IF;
  IF f.data_type = 'enum' AND NEW.value IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM ref.enums e WHERE e.enum_key=f.enum_key AND e.code=NEW.value AND e.active)
  THEN RAISE EXCEPTION '유효하지 않은 enum 값: %=%', NEW.field, NEW.value; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS t_overlay_validate ON app.overlays;
CREATE TRIGGER t_overlay_validate BEFORE INSERT OR UPDATE ON app.overlays
  FOR EACH ROW EXECUTE FUNCTION app.validate_overlay();

-- (3) 크레딧 원장 → 잔액 캐시
CREATE OR REPLACE FUNCTION app.apply_credit_entry() RETURNS trigger AS $$
BEGIN
  INSERT INTO app.credit_balances(account_id, bucket, amount)
  VALUES (NEW.account_id, NEW.bucket, NEW.amount)
  ON CONFLICT (account_id, bucket)
  DO UPDATE SET amount = app.credit_balances.amount + NEW.amount;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS t_credit ON app.credit_entries;
CREATE TRIGGER t_credit AFTER INSERT ON app.credit_entries
  FOR EACH ROW EXECUTE FUNCTION app.apply_credit_entry();

-- (4) 크레딧 차감(소멸 임박 버킷부터). 베타(P2): 부족해도 예외 안 냄(그림자 계량)
CREATE OR REPLACE FUNCTION app.deduct_credit(p_acct bigint, p_amount int, p_ref bigint)
RETURNS void AS $$
DECLARE remain int := p_amount; b app.credit_bucket; avail int; take int;
BEGIN
  FOREACH b IN ARRAY ARRAY['monthly','earned','purchased']::app.credit_bucket[] LOOP
    EXIT WHEN remain <= 0;
    SELECT amount INTO avail FROM app.credit_balances WHERE account_id=p_acct AND bucket=b;
    IF COALESCE(avail,0) > 0 THEN
      take := LEAST(avail, remain);
      INSERT INTO app.credit_entries(account_id,type,bucket,amount,reason,ref_type,ref_id)
        VALUES (p_acct,'spend',b,-take,'report','report',p_ref);
      remain := remain - take;
    END IF;
  END LOOP;
  IF remain > 0 THEN
    INSERT INTO app.credit_entries(account_id,type,bucket,amount,reason,ref_type,ref_id)
      VALUES (p_acct,'spend','monthly',-remain,'report(overdraft)','report',p_ref);
  END IF;
END $$ LANGUAGE plpgsql;

-- (5) 화면값 병합: master + 팀 오버레이 COALESCE
CREATE OR REPLACE FUNCTION app.building_view(p_pk text, p_team bigint)
RETURNS jsonb AS $$
  SELECT to_jsonb(b) || COALESCE(
    (SELECT jsonb_object_agg(o.field, o.value) FROM app.overlays o
       WHERE o.team_id = p_team AND o.target_type = 'building' AND o.target_id = p_pk),
    '{}'::jsonb)
  FROM master.buildings b WHERE b.building_pk = p_pk;
$$ LANGUAGE sql STABLE;

-- (6) 영역(폴리곤) 검색 — PostGIS ST_Within
CREATE OR REPLACE FUNCTION app.search_polygon(p_geojson jsonb)
RETURNS SETOF master.buildings AS $$
  SELECT b.* FROM master.buildings b
  WHERE ST_Within(b.geom, ST_MakeValid(ST_GeomFromGeoJSON(p_geojson::text)));
$$ LANGUAGE sql STABLE;

-- (7) 신선도 워터마크 = 그 건물 팀 데이터 max(updated_at)
CREATE OR REPLACE FUNCTION app.building_watermark(p_pk text, p_team bigint)
RETURNS timestamptz AS $$
  SELECT max(u) FROM (
    SELECT max(updated_at) u FROM app.overlays    WHERE target_id  = p_pk AND team_id = p_team
    UNION ALL
    SELECT max(updated_at)   FROM app.floor_rents  WHERE building_pk = p_pk AND team_id = p_team
    UNION ALL
    SELECT max(updated_at)   FROM app.listings     WHERE building_pk = p_pk AND team_id = p_team
  ) t;
$$ LANGUAGE sql STABLE;

-- (8) 보고서 신선도(오래됨?) — 인덱스 조회 1회급
CREATE OR REPLACE FUNCTION app.report_is_stale(p_report bigint)
RETURNS boolean AS $$
  SELECT r.master_version <> (SELECT version FROM master.master_version)
      OR COALESCE(r.source_watermark, 'epoch'::timestamptz)
           < COALESCE(app.building_watermark(r.building_pk,
               (SELECT team_id FROM app.team_members tm WHERE tm.account_id = r.account_id
                  AND tm.left_at IS NULL LIMIT 1)), 'epoch'::timestamptz)
  FROM app.reports r WHERE r.id = p_report;
$$ LANGUAGE sql STABLE;

COMMIT;
