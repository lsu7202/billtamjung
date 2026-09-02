-- 0046 · 매물 진행상태 어휘 통일 — '리드' 정식 추가 + 오염값 정규화
--
-- 왜: listings.status의 값공간이 세 겹이었다(2026-08-10 감사).
--   ① 업무탭 정본 = jindo enum(미지정·준비중·진행중·철회·가격제시·매각)
--   ② 시드·QA가 발명한 오염 = 접수·협의중·조사중 (enum 밖 — 업무탭 segmented가 모른다)
--   ③ 영업 매도 탭이 발명한 = 리드
-- 어휘가 갈라지면 같은 행을 읽어도 화면마다 다른 말을 한다. enum 하나로 통일한다.
--
-- '리드'는 정식 개념으로 승격 — "아직 확보 전, 담아두고 전화 도는 건물".
-- 오늘의 「담기」·매도 흐름의 첫 열·업무탭 진행상태 segmented가 전부 이 한 값을 본다.

BEGIN;

INSERT INTO ref.enums(enum_key, code, label, sort_order, active)
VALUES ('jindo', '리드', '리드', 7, true)     -- 미지정(5)과 준비중(10) 사이
ON CONFLICT (enum_key, code) DO NOTHING;

-- 오염값 정규화 — 가장 가까운 정본 어휘로. (접수·조사중=아직 준비 단계 · 협의중=가격 얘기 중)
UPDATE app.listings SET status = '준비중'   WHERE status IN ('접수', '조사중');
UPDATE app.listings SET status = '가격제시' WHERE status = '협의중';

COMMIT;
