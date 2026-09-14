-- 0062 · 「미지정」을 되살린다 — 0061을 되돌림
--
-- 0061에서 매물 진행상태 기본값을 '관심'으로 박았는데, 데이터 원칙(specs/04-data/data-overview.md)이
-- **null 표현 = 「미지정」 하나로 통일**이다. 업무 enum(긴급도·등급·소유자타입·협조도…)이 전부
-- 그 규칙을 따르는데 진행상태만 예외로 두면, 다음 사람이 「이 필드는 왜 다르지」를 매번 되짚는다.
--
-- 뜻도 다르다:
--   미지정 = 담아만 뒀고 **아직 아무 기록이 없다**   ← 기록되는 단계가 아니다
--   관심   = 사람이 첫 기록을 남겼다(연락했고 아직 팔지는 모름)
-- 담자마자 '관심'이 찍히면 「아직 안 본 것」과 「보고 관심 있다고 한 것」이 같은 칸이 된다.
--
-- 기록(app.contacts.status)에는 미지정을 넣지 않는다 — 기록한다는 것 자체가 미지정이 아니라는 뜻이라
-- 첫 기록은 언제나 '관심'부터다. 매수도 같다(담기만 하면 장부가 비고, 첫 줄이 '후보').

BEGIN;

ALTER TABLE app.listings ALTER COLUMN status DROP DEFAULT;

-- 0061이 NULL → '관심'으로 옮겨놓은 것들 되돌리기.
-- 되돌릴 대상 = **기록이 하나도 없는** 매물(= 사람이 관심을 표한 적 없는 것).
UPDATE app.listings l SET status = NULL
 WHERE l.status = '관심'
   AND NOT EXISTS (SELECT 1 FROM app.contacts c
                    WHERE c.team_id = l.team_id AND c.target_type = 'listing'
                      AND c.target_id = l.building_pk);

-- 화면 드롭다운의 첫 값으로 되살린다(다른 업무 enum과 같은 어법)
INSERT INTO ref.enums(enum_key, code, label, sort_order, active)
VALUES ('jindo', '미지정', '미지정', 0, true)
ON CONFLICT DO NOTHING;

COMMIT;
