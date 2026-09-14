-- 0169 · 표 설명 — 모델이 「무엇이 어디 있는지」를 지시문에서 바로 안다
--
-- 왜: 「성수동2가 병원 건물 찾아줘」에 모델이 바퀴를 일곱 돌았다(2026-09-09).
--     첫 SQL 은 pk·address·appraisal_price 처럼 **없는 칸 이름**을 지어냈고, 그다음
--     list_tables → describe → codes → skill 을 차례로 부르며 탐색했다. 한 바퀴가 1만 토큰이다.
--     그러고도 업체 원장(localdata_permit)이 있는 줄 몰라 대장 주용도만 보고 2동이라 답했다
--     (실제 영업 중 의료 업체 47곳 · 지번 42곳).
--
-- 어디에 두나: **DB 에 둔다.** 칸 설명(0167·0168)과 같은 자리다. 지시문에 손으로 적으면
--     표가 바뀔 때 따로 논다. 여기 두면 표를 옮기는 사람이 설명도 같이 옮긴다.
--     app/ai/tools/query.py 의 tables_brief() 가 이걸 읽어 지시문에 싣는다(캐시가 받는다).

-- 표·뷰·구체화뷰가 섞여 있어 COMMENT 문이 갈린다(master.buildings 는 뷰다).
-- 갈래를 보고 맞는 문을 만들어 돌린다.
DO $$
DECLARE r record; kind text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('master.buildings', '건물 본표(대장 표제부). building_pk 가 열쇠. addr·total_area(연면적㎡)·land_area(대지㎡)·floors_above/below·bcr·far·main_use(코드)·main_use_name·approval_ymd·bjd_code·pnu·geom'),
    ('master.parcels', '필지. pnu 가 열쇠, building_pk 로 건물과 잇는다. area(㎡)·jimok(지목)·use_zone(용도지역)·gongsi_latest(원/㎡)·legal_bcr/far·road_frontage'),
    ('master.floor_outline', '대장 층별개요. building_pk+seq. floor·use(용도)·floor_area(바닥면적㎡). **금액은 없다**'),
    ('master.building_parcels', '건물↔필지 잇기. building_pk·pnu·role(rep=대표필지)'),
    ('master.building_legal', '법정 건폐·용적(토지이음 산식). building_pk·legal_bcr·legal_far'),
    ('master.building_road', '도로 접면. building_pk·front_m(전면 도로폭)·n_roads(접한 도로 수)'),
    ('master.building_ledger_raw', '대장 원본 JSON. 보통 안 쓴다 — 파생표를 먼저 본다'),
    ('master.vacant_parcels', '나대지(건물 없는 필지) 33만. pnu·addr·area·use_zone·gongsi_latest'),
    ('master.localdata_permit', '**영업 인허가 업체 315만**(행안부 LOCALDATA). 「이 건물·동네에 무슨 가게가 있나」는 여기. name·biz1(업종)·open_on·close_on(NULL=영업 중)·floor_no(층)·jibun·road·geom. **building_pk 가 없다** — ST_DWithin(b.geom::geography, p.geom::geography, 25) 로 잇는다(::geography 를 빼면 25가 도가 되어 전국을 센다)'),
    ('master.sbiz_store', '소상공인 상가정보 55만. localdata 와 겹치지만 **pnu 와 층이 있다**. name·cat1~3(업종)·pnu·floor·ho·geom'),
    ('ref.biz_category', '업종 이름 → 상권 갈래(먹자·판매·업무·유흥·생활서비스·교육·의료·기타)'),
    ('master.sanggwon', '상권 72개 경계. id·nm·geom'),
    ('master.sanggwon_rent_series', '상권별 분기 임대료 지수. sanggwon·floor·y·q·rate'),
    ('master.trade_area', '서울시 상권 영역 1,650. code·nm·kind_nm·gu·geom'),
    ('master.sales_history', '실거래(국토부). building_pk·contract_ym(YYYYMM)·price(원)·total_area. **실제 계약이라 사실이다**'),
    ('master.sales_agg', '건물별 거래 요약. building_pk·sale_cnt·p_last(최근가)·p_prev'),
    ('master.gongsi_series', '개별공시지가 연도별. pnu·year·price(원/㎡). 1990~2026'),
    ('master.apt_price', '공동주택 공시가격. unit_pk·year·price. seq=0 만 보면 된다'),
    ('master.land_adjust', '구별 연도별 지가변동률. gu·yr·adj'),
    ('master.area_event', '**주변 소식·호재 한 자리**(고시·인허가·정비·보도자료). id·kind(갈래)·name(제목)·on_date·body(본문 7천건)·source_url·geom. 화면은 /buildings/{pk}/events 로 읽는다'),
    ('master.urban_notice', '도시계획 고시 본문 4.4만. notice_no·title·body·pdf_text'),
    ('master.press_event', '보도자료. **본문 저장·표시 금지** — 제목(title)만 쓴다'),
    ('master.redevel_zone', '정비구역 839. name·kind·gosi_no·geom'),
    ('master.building_redevel', '건물↔정비구역. building_pk·zone_id·kind·name'),
    ('master.district_plan', '지구단위계획구역 948. name·sgg·geom'),
    ('master.building_district_plan', '건물↔지구단위계획. building_pk·plan_id·name'),
    ('master.city_facility', '도시계획시설 2.5만. name·cls_l/m/s(갈래)·geom'),
    ('master.g2b_bid', '나라장터 공사 발주 4,763. name·inst·price·notice_on·geom'),
    ('master.building_permit', '건축 인허가 71.8만. act(신축·증축·철거)·pnu·addr·use_name·permit_on·done_on'),
    ('master.living_pop', '서울 생활인구 250m 격자(KT 통신량 추정). **참조 등급** — 사실이 아니다. day_avg=11~21시 평균'),
    ('master.building_pop', '건물별 생활인구(격자값 복사). building_pk 로 붙는다. 참조 등급'),
    ('master.subway_stations', '지하철역 784. name·route·lng·lat'),
    ('master.road_segment', '도로 구간 6.7만. rn(도로명)·road_bt(폭)·geom'),
    ('master.region_index', '구·동 이름 ↔ bjd_code·sgg_code. **동 이름으로 코드를 찾는 자리**. gu·dong·bjd_code'),
    ('ref.enums', 'enum 사전. enum_key·code·label. 코드→이름은 codes 도구가 더 싸다'),
    ('ref.enum_groups', 'enum 갈래 목록'),
    ('ref.fields', '칸 사전. 이름·단위·형')
  ) AS t(name, note) LOOP
    SELECT CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END
      INTO kind
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = split_part(r.name, '.', 1) AND c.relname = split_part(r.name, '.', 2);
    IF kind IS NULL THEN
      RAISE NOTICE '없는 표 건너뜀: %', r.name;
      CONTINUE;
    END IF;
    EXECUTE format('COMMENT ON %s %s IS %L', kind, r.name, r.note);
  END LOOP;
END $$;
