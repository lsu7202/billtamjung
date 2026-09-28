-- 0191 광고 · 문의 · 고객 · 크롤링 매물 (S05, 2026-09-28)
--
-- 화면은 하나, 권한은 계정 종류(accounts.kind) 하나로 가른다. 중개사만 매물관리 · 팀 칸 · 크롤링 자료를 본다.
-- 광고 · 문의 · 저장 표는 빈 채로 시작한다. crawl_listing 만 기존 임대 호가(_crawl_clean)로 채운다.
BEGIN;

-- 계정 종류 — 이 사람이 누구인가. 팀 소속은 「데이터가 사는 곳」이라 따로다.
ALTER TABLE app.accounts ADD COLUMN IF NOT EXISTS kind text;
UPDATE app.accounts SET kind = '중개사' WHERE kind IS NULL;
ALTER TABLE app.accounts ALTER COLUMN kind SET DEFAULT '중개사',
                         ALTER COLUMN kind SET NOT NULL;
ALTER TABLE app.accounts ADD CONSTRAINT accounts_kind_chk CHECK (kind IN ('중개사','고객'));

-- 고객 프로필 — 전부 고객이 직접 적는다. 모르면 null.
-- 의사는 매수자 등급 사전(buyer_grade: A 확실 · B 보통 · C 관망)을 그대로 쓴다 — 고객등록 때 buyers.grade 로 옮겨 적는다.
CREATE TABLE app.customer_profile (
  account_id  bigint PRIMARY KEY REFERENCES app.accounts(id) ON DELETE CASCADE,
  intent      text CHECK (intent IN ('A','B','C')),
  literacy    text CHECK (literacy IN ('처음','관심','공부해봄')),
  purposes    text[],                       -- 실사용 · 투자 · 신축 (building_use 코드)
  regions     text[],                       -- 구 코드(시군구 5자리)
  budget_min  bigint,
  budget_max  bigint,
  note        text,
  updated_at  timestamptz NOT NULL DEFAULT now());

-- 광고 — 매물 모달의 광고 폼으로만 생긴다(자동으로 켜지지 않는다). 값은 복사본이라 매물을 고쳐도 그대로다.
CREATE TABLE app.ads (
  id                 bigserial PRIMARY KEY,
  team_id            bigint NOT NULL REFERENCES app.teams(id) ON DELETE CASCADE,
  listing_id         bigint NOT NULL REFERENCES app.listings(id),
  building_pk        text   NOT NULL,
  deal               text   NOT NULL DEFAULT '매매' CHECK (deal IN ('매매')),
  brokerage          text   NOT NULL DEFAULT '일반' CHECK (brokerage IN ('일반','전속')),
  price              bigint,
  price_open         boolean NOT NULL DEFAULT true,
  land_area          numeric,
  total_area         numeric,
  floors_above       int,
  floors_below       int,
  zoning             text,
  approved_on        date,
  violation          boolean,
  title              text NOT NULL,
  body               text NOT NULL,
  contact_account_id bigint REFERENCES app.accounts(id),
  contact_phone      text,
  address_open       boolean NOT NULL DEFAULT true,
  state              text NOT NULL DEFAULT '노출' CHECK (state IN ('노출','비노출','거래완료','삭제')),
  review             text NOT NULL DEFAULT '통과' CHECK (review IN ('통과','검수중','반려')),
  review_note        text,
  posted_on          date NOT NULL DEFAULT current_date,
  expires_on         date NOT NULL DEFAULT current_date + 30,
  closed_on          date,
  created_by         bigint REFERENCES app.accounts(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now());
CREATE INDEX ads_building ON app.ads(building_pk) WHERE state IN ('노출','거래완료');
CREATE INDEX ads_team ON app.ads(team_id);
-- 매물 하나에 살아 있는 광고 하나
CREATE UNIQUE INDEX ads_one_live ON app.ads(listing_id) WHERE state IN ('노출','비노출');

CREATE TABLE app.ad_photos (
  ad_id    bigint NOT NULL REFERENCES app.ads(id) ON DELETE CASCADE,
  photo_id bigint NOT NULL REFERENCES app.photos(id),
  sort     int NOT NULL DEFAULT 0,
  PRIMARY KEY (ad_id, photo_id));

-- 노출 순위 구매(대표 09-28: 등록은 무료, 돈은 순위로). 규칙 · 가격은 나중.
CREATE TABLE app.ad_boosts (
  id         bigserial PRIMARY KEY,
  ad_id      bigint NOT NULL REFERENCES app.ads(id),
  amount_won bigint NOT NULL,
  starts_on  date NOT NULL,
  ends_on    date NOT NULL,
  created_by bigint REFERENCES app.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now());

-- 문의(상담요청) — 광고를 올린 팀의 고객관리에 선다
CREATE TABLE app.inquiries (
  id          bigserial PRIMARY KEY,
  ad_id       bigint REFERENCES app.ads(id),
  team_id     bigint NOT NULL REFERENCES app.teams(id) ON DELETE CASCADE,
  account_id  bigint NOT NULL REFERENCES app.accounts(id),
  kind        text NOT NULL CHECK (kind IN ('매수 문의','매도 문의','시세 문의')),
  body        varchar(200),
  name        text NOT NULL,
  phone       text NOT NULL,
  consent_at  timestamptz NOT NULL,
  status      text NOT NULL DEFAULT '미확인' CHECK (status IN ('미확인','상담중','고객등록','종료')),
  buyer_id    bigint REFERENCES app.buyers(id),      -- 매수 문의가 고객등록되면
  listing_id  bigint REFERENCES app.listings(id),    -- 매도 문의가 고객등록되면
  handled_by  bigint REFERENCES app.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now());
CREATE INDEX inquiries_team ON app.inquiries(team_id, status);

-- 관심 저장 — 건물 저장(ad_id null) · 광고 저장 둘 다
CREATE TABLE app.saves (
  id          bigserial PRIMARY KEY,
  account_id  bigint NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  building_pk text NOT NULL,
  ad_id       bigint REFERENCES app.ads(id),
  memo        text,
  created_at  timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX saves_one ON app.saves(account_id, building_pk, COALESCE(ad_id, 0));

-- 조건 남기기 — 저장 검색에 알림 칸. 개수 제한 없음(대표 09-28)
ALTER TABLE app.saved_searches ADD COLUMN IF NOT EXISTS notify boolean NOT NULL DEFAULT false,
                               ADD COLUMN IF NOT EXISTS closed_at timestamptz;
CREATE TABLE app.want_alerts (
  saved_search_id bigint NOT NULL REFERENCES app.saved_searches(id) ON DELETE CASCADE,
  ad_id           bigint NOT NULL REFERENCES app.ads(id),
  matched_at      timestamptz NOT NULL DEFAULT now(),
  seen_at         timestamptz,
  PRIMARY KEY (saved_search_id, ad_id));

CREATE TABLE app.ad_reports (
  id          bigserial PRIMARY KEY,
  ad_id       bigint NOT NULL REFERENCES app.ads(id),
  account_id  bigint NOT NULL REFERENCES app.accounts(id),
  reason      text NOT NULL CHECK (reason IN ('거래완료','표시정보 다름')),
  body        text,
  status      text NOT NULL DEFAULT '확인중' CHECK (status IN ('확인중','처리','반려')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  handled_at  timestamptz);

-- 크롤링 매물 — 광고가 아니라 중개사 참고 자료. 출처 · 원문 링크는 두지 않는다(대표 09-28).
-- 게시자(등록번호)는 가입한 중개사의 「다른 사이트에 올리신 매물」을 찾는 열쇠다.
CREATE TABLE master.crawl_listing (
  id                 bigserial PRIMARY KEY,
  deal               text NOT NULL CHECK (deal IN ('매매','임대')),
  building_pk        text,
  pnu                text,
  price              bigint,
  deposit            bigint,
  rent               bigint,
  mgmt               bigint,
  floor              text,
  contract_area      numeric,
  excl_area          numeric,
  office_name        text,
  agent_name         text,
  reg_no             text,
  phone              text,
  first_seen         date,
  last_seen          date,
  gone_on            date,
  claimed_team_id    bigint,
  claimed_listing_id bigint);
CREATE INDEX crawl_listing_bpk ON master.crawl_listing(building_pk);
CREATE INDEX crawl_listing_reg ON master.crawl_listing(reg_no) WHERE reg_no IS NOT NULL;

-- 첫 적재: 주소로 붙인 임대 호가. 날짜 · 게시자는 모른다 = null(지어내지 않는다)
INSERT INTO master.crawl_listing(deal, building_pk, floor, contract_area, excl_area, deposit, rent)
SELECT '임대', building_pk, floor::text, area_c, area_e, deposit, rent FROM master._crawl_clean;

-- 옛 광고 칸 — 0건. 광고는 app.ads 로, 「밖에 나와 있나」는 crawl_listing 이 답한다
ALTER TABLE app.listings DROP COLUMN IF EXISTS ad_status, DROP COLUMN IF EXISTS ad_off;

-- 칩 사전
INSERT INTO ref.enum_groups(enum_key, label) VALUES
  ('customer_literacy', '이해도'), ('inquiry_kind', '문의 유형'), ('inquiry_status', '문의 상태'),
  ('ad_state', '광고 상태'), ('brokerage', '중개유형')
ON CONFLICT DO NOTHING;
INSERT INTO ref.enums(enum_key, code, label, sort_order) VALUES
  ('customer_literacy', '처음', '처음', 10), ('customer_literacy', '관심', '관심', 20),
  ('customer_literacy', '공부해봄', '공부해봄', 30),
  ('inquiry_kind', '매수 문의', '매수 문의', 10), ('inquiry_kind', '매도 문의', '매도 문의', 20),
  ('inquiry_kind', '시세 문의', '시세 문의', 30),
  ('inquiry_status', '미확인', '미확인', 10), ('inquiry_status', '상담중', '상담중', 20),
  ('inquiry_status', '고객등록', '고객등록', 30), ('inquiry_status', '종료', '종료', 40),
  ('ad_state', '노출', '노출', 10), ('ad_state', '비노출', '비노출', 20),
  ('ad_state', '거래완료', '거래완료', 30), ('ad_state', '삭제', '삭제', 40),
  ('brokerage', '일반', '일반', 10), ('brokerage', '전속', '전속', 20)
ON CONFLICT DO NOTHING;

COMMIT;
