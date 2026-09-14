-- 헷갈리는 칸에 뜻을 단다 — 지시문보다 싸고 정확하다 (2026-09-09)
--
-- ## 왜
-- 겨루기 2번(「성수동1가 200평 넘는 건물」)에서 모델이 SQL 을 여섯 번 짜다 바퀴를 다 썼다.
--   · 없는 칸 `bjd_name` 을 지어냈다 (지역 이름이 어디 있는지 몰라서)
--   · **연면적(total_area)과 대지면적(land_area)을 뒤바꿔** 썼다
--   · pnu 와 building_pk 사이를 오갔다
-- `describe` 는 주석을 그대로 모델에 보여 준다. 지시문에 적으면 매 대화에 실리지만
-- 주석은 그 표를 볼 때만 실린다. **같은 값을 더 싸게 준다.**

BEGIN;

DO $$
DECLARE t text;
  cmt jsonb := '{
    "total_area":   "연면적(㎡). 모든 층 바닥면적의 합. **대지면적이 아니다**. 평 = ㎡/3.3058",
    "land_area":    "대지면적(㎡). 필지 넓이. 연면적과 다르다",
    "build_area":   "건축면적(㎡). 1층이 덮는 넓이",
    "parcel_area":  "대표 필지 면적(㎡). parcels 에서 온 값",
    "bjd_code":     "법정동 코드 10자리. 접두 LIKE 로 동을 거른다. **동 이름은 master.region_index 에 있다**",
    "sgg_code":     "시군구 코드 5자리",
    "jibun_norm":   "붙여쓴 지번 주소(성동구성수동1가14-53). 검색용이라 띄어쓰기가 없다",
    "building_pk":  "건물 열쇠. 한 필지에 건물이 여럿일 수 있어 pnu 와 1:1 이 아니다",
    "pnu":          "필지 열쇠 19자리. parcels·gongsi_series 와 잇는다",
    "floors_above": "지상 층수", "floors_below": "지하 층수",
    "bcr":          "건폐율(%). 대장값. 법정 상한은 parcels.legal_bcr",
    "far":          "용적률(%). 대장값. 법정 상한은 parcels.legal_far",
    "gongsi_latest":"최근 개별공시지가(원/㎡). 만원 = /10000",
    "last_sale_price":"최근 실거래가(원). 억 = /1e8",
    "elevator":     "승강기 대수(대장)", "elevator_ext": "승강기 대수(승강기안전공단). 대장과 다를 수 있다",
    "station_dist": "가장 가까운 지하철역까지 거리(m)"
  }'::jsonb;
  k text; v text;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'master' AND c.relkind = 'r' AND c.relname ~ '^buildings(_v[0-9]+)?$'
  LOOP
    FOR k, v IN SELECT * FROM jsonb_each_text(cmt) LOOP
      IF EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='master' AND table_name=t AND column_name=k) THEN
        EXECUTE format('COMMENT ON COLUMN master.%I.%I IS %L', t, k, v);
      END IF;
    END LOOP;
  END LOOP;
END $$;

COMMENT ON MATERIALIZED VIEW master.region_index IS '구·동 이름 ↔ bjd_code·sgg_code. 지역 이름으로 코드를 찾는 자리';

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname='master' AND c.relkind='r' AND c.relname ~ '^parcels(_v[0-9]+)?$'
  LOOP
    EXECUTE format('COMMENT ON COLUMN master.%I.legal_bcr IS %L', t,
                   '법정 건폐율 상한(%). 걸침 필지는 배열로 병기. 토지이음 산식');
    EXECUTE format('COMMENT ON COLUMN master.%I.legal_far IS %L', t,
                   '법정 용적률 상한(%). 대장 far 와 견주면 남은 여유가 나온다');
  END LOOP;
END $$;

COMMIT;
