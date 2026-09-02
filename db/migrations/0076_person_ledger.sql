-- 0076 · 사람 축의 장부 — 매물에 매달리지 않는 기록
--
-- 왜: 지금까지 모든 커밋은 매물에 붙었다(contacts.target_type='listing').
--   그런데 중개 일의 절반은 특정 매물 얘기가 아니다:
--     · 「소개로 알게 됨 · 강남 쪽 물건 찾는다고」  — 아직 붙일 매물이 없다
--     · 「명절 인사 · 요즘 시장 어떠냐 물어보심」    — 매물 얘기가 아니다
--     · 「세무사 만나서 양도세 확인」               — 우리 쪽 일이다
--   매물에 억지로 붙이면 그 매물 장부가 딴 얘기로 더러워지고, 안 적으면 사라진다.
--
-- 그래서 장부를 셋으로 본다:
--     사람   contacts(target_type='buyer'|'owner')   그 사람과의 일 — 매물 무관
--     매물   contacts(target_type='listing')         그 매물의 일(매도자와의 대화 포함)
--     제안   proposal_events                         매물 × 매수자 관계의 일
--   화면의 「기본」 탭은 이 셋을 사람 기준으로 합쳐 시간순으로 읽고, 쓰기는 사람 장부로 간다.
--
-- 일정도 같다 — 매물 없는 약속이 있다(신규 상담·세무사 미팅).

BEGIN;

-- 매물 없는 약속을 허용한다. 누가 오는지는 schedule_people 이 이미 들고 있다(0075).
ALTER TABLE app.schedules ALTER COLUMN building_pk DROP NOT NULL;

-- 사람 장부를 빨리 찾기 위한 자리(target_type 은 이미 자유 문자열이라 값만 늘어난다)
CREATE INDEX IF NOT EXISTS contacts_person ON app.contacts (team_id, target_type, target_id, occurred_on DESC)
  WHERE target_type IN ('buyer', 'owner');

COMMIT;
