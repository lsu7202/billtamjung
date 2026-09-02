-- 자료는 칸이 아니라 **체크리스트**다(2026-08-18) — 제안 사다리의 서류가 계약·잔금 창의
-- 구획이듯, 자료(사진·리포트·브리핑자료)는 노출 창의 「준비물」 구획으로 들어간다.
-- 레일은 5칸(소유자·접촉·의사·정보·노출). 자료 칸의 정지 사유는 노출 칸으로 병합.
BEGIN;

-- 진행불가류 사유를 노출 칸 목록으로(수익률·가격·물건자체 + 기존 매수자없음)
INSERT INTO ref.enums(enum_key, code, label, sort_order)
SELECT 'stop_reason_match', code, label, sort_order + 100
  FROM ref.enums WHERE enum_key = 'stop_reason_asset' AND active
ON CONFLICT (enum_key, code) DO UPDATE SET active = true;
UPDATE ref.enums SET active = false WHERE enum_key = 'stop_reason_asset';

-- 열린 asset 정지는 match 로(현재 0건 — 방어적)
UPDATE app.stops SET stage='match' WHERE stage='asset' AND resolved_at IS NULL;

INSERT INTO app.schema_migrations(version) VALUES ('0101_asset_to_checklist.sql')
ON CONFLICT DO NOTHING;
COMMIT;
