-- 0202 구해요 · 관심 정도(S06, 대표 09-30)
--
-- 구해요 = 고객이 건물에 남기는 「이런 건물 구해요」. 중개사는 목록에서 보고 제안을 보낸다(팀당 하나, 5개면 마감).
-- 고객이 제안을 고르면 그 팀에 매수 문의가 생긴다(inquiries.seek_id). 가격 칸은 두지 않는다(호가창 금지).
-- 관심 정도 = 저장 수(app.saves) + 오늘 상세를 연 계정 수(building_views).
BEGIN;

CREATE TABLE IF NOT EXISTS app.building_views (
  building_pk text   NOT NULL,
  account_id  bigint NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  viewed_on   date   NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,
  PRIMARY KEY (building_pk, viewed_on, account_id)
);

CREATE TABLE IF NOT EXISTS app.seeks (
  id          bigserial PRIMARY KEY,
  account_id  bigint NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  building_pk text   NOT NULL,
  note        varchar(200),
  state       text   NOT NULL DEFAULT '열림' CHECK (state IN ('열림','마감','닫힘')),
  cap         int    NOT NULL DEFAULT 5,
  expires_on  date   NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Seoul')::date + 30),
  created_at  timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz
);
-- 한 고객이 한 건물에 열린(열림 · 마감) 구해요는 하나
CREATE UNIQUE INDEX IF NOT EXISTS seeks_one_open ON app.seeks(account_id, building_pk) WHERE state <> '닫힘';
CREATE INDEX IF NOT EXISTS seeks_building ON app.seeks(building_pk) WHERE state <> '닫힘';

CREATE TABLE IF NOT EXISTS app.seek_proposals (
  id          bigserial PRIMARY KEY,
  seek_id     bigint NOT NULL REFERENCES app.seeks(id) ON DELETE CASCADE,
  team_id     bigint NOT NULL REFERENCES app.teams(id) ON DELETE CASCADE,
  account_id  bigint NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  listing_pk  text,
  message     varchar(300),
  state       text   NOT NULL DEFAULT '보냄' CHECK (state IN ('보냄','채택','거절')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (seek_id, team_id)
);

ALTER TABLE app.inquiries ADD COLUMN IF NOT EXISTS seek_id bigint REFERENCES app.seeks(id) ON DELETE SET NULL;

COMMIT;
