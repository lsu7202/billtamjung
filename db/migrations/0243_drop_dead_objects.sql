-- 부르는 곳 없는 표 · 함수 · 사전 행 (2026-10-07 전수 감사 · 대표 승인)
--
-- 표
--   app.ad_boosts · app.ai_result                0행 · 참조 0
--   app.wiki_posts · _comments · _votes · _reports 건물 위키 — 라우트 9개를 뺐다(화면이 안 불렀다)
--   app.deal_docs                                계약 서류 체크 — 라우트를 뺐다
--   app.series_points                            차트 보정(/series) — 모듈을 뺐다
--   app.floor_hidden                             층 숨기기 — 쓰는 라우트가 화면에 없었다
--   ref.biz_category                             상권 구성 갈래 사전(0242 로 상권 구성 삭제)
--   master.income_cap                            지운 추정임대 위의 구별 수익률. (나)안이 새 재료로 다시 만든다(스펙 12 §2-1)
--   master.building_redevel · building_district_plan  건물 태깅(미래가치 F-21 이 읽던 것). 구역 폴리곤(redevel_zone · district_plan)은 주변 소식이 읽어 남긴다
--   master.apt_price(+ apt_price_v3)             공동주택가격 2,795만 행 · 3GB. 09-02 에 빌드에서 뺐는데 표가 남아 있었다
-- 함수
--   app.search_polygon                           0004 유산 · 참조 0
-- 사전 행
--   ref.fields value_score(F-16 가치점수) · ref.formula_params F-16 매력도 12행 + similarity.floor
--   ref.enums 상태 사다리 · 안 쓰는 갈래 7종

BEGIN;
DROP TABLE IF EXISTS app.ad_boosts, app.ai_result;
DROP TABLE IF EXISTS app.wiki_comments, app.wiki_votes, app.wiki_reports, app.wiki_posts;
DROP TABLE IF EXISTS app.deal_docs, app.series_points, app.floor_hidden;
DROP TABLE IF EXISTS ref.biz_category;
DROP TABLE IF EXISTS master.income_cap, master.building_redevel, master.building_district_plan;
DROP VIEW IF EXISTS master.apt_price;
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='master' AND tablename ~ '^apt_price_v[0-9]+$' LOOP
    EXECUTE format('DROP TABLE master.%I', t);
  END LOOP;
END $$;
DO $$ DECLARE f regprocedure; BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='app' AND p.proname='search_polygon' LOOP
    EXECUTE format('DROP FUNCTION %s', f);
  END LOOP;
END $$;
DELETE FROM ref.fields WHERE field_key = 'value_score';
DELETE FROM ref.formula_params WHERE formula_id = 'F-16' OR param_key = 'similarity.floor';
DELETE FROM ref.enums WHERE enum_key IN ('ad_off','ad_status','offer_side','wake_kind','buyer_exclusive','inquiry_kind','inquiry_status');
COMMIT;
