-- 0090 · 업무 사다리 — 확인 상태 · 통화 결과 · 광고 상태 · 멈춤 · 협상 양방향
--
-- 정본: specs/03-features/S04b-업무-사다리와-필드.md
--
-- 이번엔 **더하기만** 한다. listings.status/grade/building_use 폐기는 파생값을 먼저 세운 뒤
-- 별도 마이그레이션으로 뗀다 — 검색·거울 코드가 물려 있어 한 번에 지우면 화면이 죽는다.
--
-- 기존 구조를 그대로 탄다: 선택형 값은 ref.enum_groups + ref.enums(0037 규칙),
-- 화면은 useEnums().options(key) + <Chips>. **parent_code는 안 쓴다** —
-- extras.py가 enum_key·code·label·tier만 내보내서 화면까지 안 온다.
-- 그래서 칸별 사유는 키를 나눈다(stop_reason_owner 등).

BEGIN;

-- ══════════════ ① 확인 상태를 **값으로** (S04b §3.4) ══════════════
-- 지금은 빈 칸 하나라 「안 물어봤다」와 「물어봤는데 소유자도 모른다」가 같아 보인다.
-- 그래서 「뭘 더 알아봐야 하나」를 만들 수 없고, 만들면 소유자도 모르는 걸 계속 재촉한다.
-- 현장 엑셀은 값으로 구분했다 — 명도 확인중 87 · 멸실 확인중 339 · 용도변경 확인중 62.
-- 「미지정」 **바로 뒤**에 둔다. 붙어 있어야 뜻이 대비로 읽힌다.
-- 기존 값들이 10 단위(미지정 10 · 완료 20 …)라 그 사이인 15를 준다.
INSERT INTO ref.enums(enum_key, code, label, sort_order, active) VALUES
  ('meongdo',    '확인중', '확인중', 15, true),
  ('myeolsil',   '확인중', '확인중', 15, true),
  ('use_change', '확인중', '확인중', 15, true)
ON CONFLICT (enum_key, code) DO UPDATE SET sort_order = EXCLUDED.sort_order;

-- ══════════════ ② 통화 결과 (기준 ①③) ══════════════
-- 「건 것 자체」가 기록이다. 지금은 상태를 안 바꾸는 통화가 아무 데도 안 남아서,
-- 세 번 걸어 세 번 못 받은 사람과 아무도 안 건드린 사람이 화면에서 같아 보인다.
-- 회의록 규칙: 「부재중 제외 나머지는 다시 연락할 때를 기록해둠」
-- 마지막 접촉일·연속 실패는 이 값에서 **파생**한다(따로 저장하지 않는다).
INSERT INTO ref.enum_groups(enum_key, label) VALUES ('call_result', '통화 결과')
ON CONFLICT (enum_key) DO NOTHING;
INSERT INTO ref.enums(enum_key, code, label, sort_order, active) VALUES
  ('call_result', '통화됨',   '통화됨',   1, true),
  ('call_result', '부재',     '부재중',   2, true),
  ('call_result', '전원꺼짐', '전원꺼짐', 3, true),
  ('call_result', '끊김',     '끊어짐',   4, true),
  ('call_result', '통화중',   '통화중',   5, true),
  ('call_result', '로밍',     '해외로밍', 6, true),
  ('call_result', '결번',     '결번',     7, true)
ON CONFLICT (enum_key, code) DO NOTHING;

-- ══════════════ ③ 광고 상태 — **경쟁 정보** (S04b §3.5) ══════════════
-- 우리가 광고를 올리지 않아도 필요하다. 광고 중이면 다른 중개사도 안다(경쟁),
-- 광고가 없으면 나만 아는 물건(가치가 높다), 광고 불가면 조용히 팔아야 한다.
-- 현장에서 「광고없음,광고불가능」이 228건으로 가장 많았다 — 「우리만 아는 물건」을 세는 칸이었다.
INSERT INTO ref.enum_groups(enum_key, label) VALUES ('ad_status', '광고 상태')
ON CONFLICT (enum_key) DO NOTHING;
INSERT INTO ref.enums(enum_key, code, label, sort_order, active) VALUES
  ('ad_status', '미지정', '미지정',    0, true),
  ('ad_status', '가능',   '광고 가능', 1, true),
  ('ad_status', '광고중', '광고 중',   2, true),
  ('ad_status', '내림',   '광고 내림', 3, true),
  ('ad_status', '불가',   '광고 불가', 4, true)
ON CONFLICT (enum_key, code) DO NOTHING;

-- 내린·불가 사유. 「매각됨」은 실거래(master.sales_history)로 우리가 자동 감지한다 —
-- 사람이 안 찍어도 알 수 있는 유일한 사유다.
INSERT INTO ref.enum_groups(enum_key, label) VALUES ('ad_off', '광고 내린 사유')
ON CONFLICT (enum_key) DO NOTHING;
INSERT INTO ref.enums(enum_key, code, label, sort_order, active) VALUES
  ('ad_off', '가치없음',   '광고가치 없음',      1, true),
  ('ad_off', '매각됨',     '매각됨',            2, true),
  ('ad_off', '매각철회',   '매각 철회',          3, true),
  ('ad_off', '소유자요청', '소유자가 원치 않음',  4, true)
ON CONFLICT (enum_key, code) DO NOTHING;

ALTER TABLE app.listings ADD COLUMN IF NOT EXISTS call_result text;
ALTER TABLE app.listings ADD COLUMN IF NOT EXISTS ad_status   text;
ALTER TABLE app.listings ADD COLUMN IF NOT EXISTS ad_off      text;

-- ══════════════ ④ 매수자 — 본인/대리인 · 긴급도 (S04b §4) ══════════════
-- 공동중개 상대는 매수자 명단에 **그대로 한 줄로 선다** — 희망가·지역·조건까지 같은 칸에.
-- 다른 건 「공동중개」라고 적힌 것뿐이라, 새 개체가 아니라 표시 하나면 된다.
-- 긴급도는 현장의 `긴급도/찐` 두 축 중 앞 축. 뒤 축(진성도)은 buyers.grade가 이미 담는다.
-- 값은 매물 urgency를 **재사용**한다 — 같은 뜻을 두 벌로 만들지 않는다.
ALTER TABLE app.buyers ADD COLUMN IF NOT EXISTS is_agent boolean NOT NULL DEFAULT false;
ALTER TABLE app.buyers ADD COLUMN IF NOT EXISTS urgency  text;   -- ref.enums 'urgency'

-- ══════════════ ⑤ 협상은 양쪽이 오간다 (S04b §5.1) ══════════════
-- 지금 제안 장부는 한쪽만 있다. 매도자의 답을 담을 자리가 없어서,
-- ask_price를 덮어쓰면 「거절하면서 133을 불렀다」인지 「그냥 값을 내렸다」인지 구분이 안 된다.
-- side 한 칸이면 기존 price·reaction·reject_price를 양쪽이 나눠 쓴다 — 컬럼을 오히려 아낀다.
--   매도 148억 → 매도 140억 → 매수 140억 → 매수 거절·128억 → 매도 128억 거절·133억 → …
-- 협의 폭이 「마지막 매도값 − 마지막 매수값」으로 바로 나온다.
-- 기존 줄은 전부 매수 쪽이라 DEFAULT '매수'가 곧 백필이다.
ALTER TABLE app.proposal_events ADD COLUMN IF NOT EXISTS side text NOT NULL DEFAULT '매수';

INSERT INTO ref.enum_groups(enum_key, label) VALUES ('offer_side', '제안 쪽')
ON CONFLICT (enum_key) DO NOTHING;
INSERT INTO ref.enums(enum_key, code, label, sort_order, active) VALUES
  ('offer_side', '매수', '매수 쪽', 1, true),
  ('offer_side', '매도', '매도 쪽', 2, true)
ON CONFLICT (enum_key, code) DO NOTHING;

-- ══════════════ ⑥ 멈춤 — 어느 칸에서든 겹치는 공통 축 (S04b §2.3) ══════════════
-- 「실패」는 칸마다 생긴다(연락처 못 캠 · 연락두절 · 안 판다 · 진행불가 · 매수자 없음 · 보류).
-- 그런데 전부 같은 말이다: **지금은 못 간다 + 무엇이 있으면 다시 간다.**
-- 칸마다 필드를 두면 예닐곱 개가 되는데, 하나로 합치면 화면도 하나로 쓴다.
--
-- 철회와 다르다 — 철회는 죽은 것이고 멈춤은 **살아 있는 채로 멈춘 것**이다.
-- 철회로 밀면 영영 안 뜨고, 그냥 두면 매일 재촉이 뜬다. 지금은 이 둘뿐이다.
--
-- 깨우는 조건은 날짜만 받으면 대부분 못 적는다. 막연한 시점이 실무의 표준이다 —
-- 「26년 봄에 매각예정」·「9월쯤?」·「연말쯤」·「저쪽 계약 결과 나오면」·「좋은 매물 있으면」.
-- 현장은 이 칸을 직접 팠다가(9_1「결과 추후 재시작 요일」) 한 줄도 못 채웠다.
CREATE TABLE IF NOT EXISTS app.stops (
  id           bigserial PRIMARY KEY,
  team_id      bigint NOT NULL REFERENCES app.teams(id) ON DELETE CASCADE,
  target_type  text   NOT NULL,          -- listing · buyer · proposal
  target_id    text   NOT NULL,          -- building_pk · buyer_id · proposal_id
  stage        text   NOT NULL,          -- 어느 칸에서 멈췄나(사유 목록을 고르는 키이기도 하다)
  reason       text,                     -- ref.enums 'stop_reason_<stage>'
  wake_kind    text   NOT NULL DEFAULT 'none',   -- date · vague · event · cond · none
  wake_on      date,                     -- 날짜로 떨어질 때만
  wake_text    text,                     -- '26년 봄' · '저쪽 계약 결과 나오면'
  note         text,
  created_by   bigint REFERENCES app.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz               -- NULL이면 **지금 멈춤 중**
);

-- 「잠든 것」 화면 전체가 이 조회 하나다 — 깨울 때가 지난 것 + 기약 없이 오래 멈춘 것
CREATE INDEX IF NOT EXISTS stops_open_idx ON app.stops(team_id, wake_on)
  WHERE resolved_at IS NULL;
-- 한 대상에 열린 멈춤은 하나만 — 둘이면 「언제 깨우나」가 둘이 된다
CREATE UNIQUE INDEX IF NOT EXISTS stops_one_open_idx
  ON app.stops(team_id, target_type, target_id) WHERE resolved_at IS NULL;

INSERT INTO ref.enum_groups(enum_key, label) VALUES
  ('wake_kind',  '깨우는 방식'),
  ('wake_vague', '막연한 시점')
ON CONFLICT (enum_key) DO NOTHING;
INSERT INTO ref.enums(enum_key, code, label, sort_order, active) VALUES
  ('wake_kind', 'date',  '날짜로',         1, true),
  ('wake_kind', 'vague', '막연한 시점',     2, true),
  ('wake_kind', 'event', '어떤 일이 나면',  3, true),
  ('wake_kind', 'cond',  '조건이 맞으면',   4, true),
  ('wake_kind', 'none',  '기약 없음',       5, true),
  ('wake_vague', '이달 안', '이달 안', 1, true),
  ('wake_vague', '올해 안', '올해 안', 2, true),
  ('wake_vague', '상반기',  '상반기',  3, true),
  ('wake_vague', '하반기',  '하반기',  4, true),
  ('wake_vague', '연말',    '연말',    5, true),
  ('wake_vague', '내년 초', '내년 초', 6, true),
  ('wake_vague', '봄',      '봄',      7, true),
  ('wake_vague', '가을',    '가을',    8, true)
ON CONFLICT (enum_key, code) DO NOTHING;

-- 멈춤 사유 — 칸마다 목록이 다르다. 화면은 options(`stop_reason_${stage}`)로 집는다.
-- 단계가 이미 절반을 말해 주므로(stage=owner면 「닿지 않는다」가 자명) 사유는 칸마다 두셋이면 된다.
INSERT INTO ref.enum_groups(enum_key, label) VALUES
  ('stop_reason_owner',  '멈춤 사유 · 소유자 확보'),
  ('stop_reason_touch',  '멈춤 사유 · 접촉'),
  ('stop_reason_intent', '멈춤 사유 · 의사'),
  ('stop_reason_asset',  '멈춤 사유 · 자료'),
  ('stop_reason_match',  '멈춤 사유 · 살 사람 찾기'),
  ('stop_reason_find',   '멈춤 사유 · 살 물건 찾기'),
  ('stop_reason_deal',   '멈춤 사유 · 제안')
ON CONFLICT (enum_key) DO NOTHING;
INSERT INTO ref.enums(enum_key, code, label, sort_order, active) VALUES
  ('stop_reason_owner',  '연락처못캠', '연락처를 못 캠',      1, true),
  ('stop_reason_owner',  '담당못찾음', '법인 담당을 못 찾음',  2, true),
  ('stop_reason_touch',  '연락두절',   '연락두절',           1, true),
  ('stop_reason_touch',  '통화거부',   '통화를 거부함',       2, true),
  ('stop_reason_intent', '안판다',     '안 판다고 함',        1, true),
  ('stop_reason_intent', '나중에',     '나중에 팔 생각',      2, true),
  ('stop_reason_asset',  '수익률',     '수익률이 안 나옴',    1, true),
  ('stop_reason_asset',  '가격',       '가격이 안 맞음',      2, true),
  ('stop_reason_asset',  '물건자체',   '물건 자체가 어려움',   3, true),
  ('stop_reason_match',  '매수자없음', '맞는 매수자가 없음',   1, true),
  ('stop_reason_find',   '매물없음',   '맞는 매물이 없음',     1, true),
  ('stop_reason_find',   '자금',       '자금이 틀어짐',       2, true),
  ('stop_reason_deal',   '상대사정',   '상대 사정',          1, true),
  ('stop_reason_deal',   '선행조건',   '먼저 끝날 일이 있음',  2, true),
  ('stop_reason_deal',   '시점',       '때가 아님',          3, true)
ON CONFLICT (enum_key, code) DO NOTHING;

COMMIT;
