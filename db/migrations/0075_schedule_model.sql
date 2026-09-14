-- 0075 · 일정을 제대로 — 용무 · 담당자 · 장소 · 고객 여럿
--
-- 왜: 0070의 일정은 「누구 + 무엇」 한 줄이었다(「김영순 만남」). 실무는 그걸로 안 된다:
--
--   · 계약 날엔 **매도자와 매수자가 같이** 온다 — 고객이 하나라는 전제가 틀렸다.
--     계약날만의 얘기도 아니다. 동행 임장, 가족 동반, 법인 담당자 둘.
--   · 팀원 중 **누가 가는지**가 안 보인다(매물 담당과 다를 수 있다 — 대신 가기도 한다).
--   · **장소**가 없다. 매물에서 볼지 사무실에서 볼지 커피숍에서 볼지가 약속의 절반이다.
--   · **고객 이름이 늘 있는 것도 아니다.** 이름 안 밝히고 「그 건물 얼마냐」 떠보는
--     전화도 고객이다. 이름 석 자나 법인명을 전제하면 그런 사람은 아예 못 적는다.
--
-- 그래서 일정은 이렇게 선다:
--   약속   = 시각 + 담당자(우리 쪽) + 용무(title)
--   고객   = 여럿(schedule_people) — 매수자·매도자·**이름 모르는 사람**
--   장소   = place(자유 문장) · 매물 주소는 building_pk 가 이미 들고 있다
--   근거   = 그 약속을 만든 커밋(event_id / contact_id)

BEGIN;

ALTER TABLE app.schedules ADD COLUMN IF NOT EXISTS place text;
-- 우리 쪽 담당 — 매물 담당자와 다를 수 있다(팀원이 대신 가는 경우).
-- 비어 있으면 매물 담당자가 가는 것으로 읽는다.
ALTER TABLE app.schedules ADD COLUMN IF NOT EXISTS assignee_account_id bigint;

-- ── 이 약속에 오는 사람들 ────────────────────────────────
-- ref_kind: buyer(app.buyers) · owner(app.owners) · guest(우리 장부에 없는 사람)
-- label   : 화면에 쓸 이름. guest 는 이것만 있다 —
--           「이름 안 밝힌 문의(010-1234-5678)」·「강남 김사장님 지인」처럼 부르는 대로.
CREATE TABLE IF NOT EXISTS app.schedule_people (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  schedule_id bigint NOT NULL REFERENCES app.schedules(id) ON DELETE CASCADE,
  ref_kind    text   NOT NULL CHECK (ref_kind IN ('buyer', 'owner', 'guest')),
  ref_id      bigint,                      -- buyer/owner 일 때만
  label       text,                        -- guest 일 때 필수. 나머지는 이름 스냅샷
  phone       text,                        -- 이름 없이 번호만 아는 경우
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT people_ref_ck CHECK (
    (ref_kind = 'guest' AND ref_id IS NULL AND (label IS NOT NULL OR phone IS NOT NULL))
    OR (ref_kind <> 'guest' AND ref_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS schedule_people_sid ON app.schedule_people (schedule_id);

-- ── 이미 있는 일정 옮기기 ────────────────────────────────
-- 지금까지는 「매수 제안이면 그 매수자, 아니면 그 매물의 매도자」 하나였다. 그대로 한 명 넣는다.
INSERT INTO app.schedule_people (schedule_id, ref_kind, ref_id, label)
SELECT s.id, 'buyer', p.buyer_id, y.name
  FROM app.schedules s
  JOIN app.proposals p ON p.id = s.proposal_id
  JOIN app.buyers y ON y.id = p.buyer_id
 WHERE s.side = 'buy'
   AND NOT EXISTS (SELECT 1 FROM app.schedule_people sp WHERE sp.schedule_id = s.id);

INSERT INTO app.schedule_people (schedule_id, ref_kind, ref_id, label)
SELECT s.id, 'owner', l.owner_id, o.name
  FROM app.schedules s
  JOIN app.listings l ON l.building_pk = s.building_pk AND l.team_id = s.team_id
  JOIN app.owners o ON o.id = l.owner_id
 WHERE s.side = 'sell'
   AND NOT EXISTS (SELECT 1 FROM app.schedule_people sp WHERE sp.schedule_id = s.id);

-- 담당자 — 지금까지는 매물 담당이 곧 일정 담당이었다
UPDATE app.schedules s SET assignee_account_id = l.assignee_account_id
  FROM app.listings l
 WHERE l.building_pk = s.building_pk AND l.team_id = s.team_id
   AND s.assignee_account_id IS NULL;

COMMIT;
