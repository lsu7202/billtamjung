-- 0142 매도 쪽에도 상태 칸을 없앤다 — 매수와 같은 이유 (2026-08-29)
--
-- 0141 에서 짝(매수)의 status 를 없앴는데 매물(매도)에는 그대로 남아 있었다.
-- 값도 같은 다섯이다: 후보 · 제안 · 계약 · 철회 · 계약파기. 방금 없앤 그 낱말들이다.
--
-- **화면은 이 값을 안 그린다.** 매물 줄의 낱말은 nego_rank 와 v_listing_stage 에서 나온다.
-- 그런데 조회 넷이 이걸로 거르고, 그중 하나가 **매도 재촉**(첫 전화·재통화)이다.
-- 계약 여부의 사실은 짝의 picked_at + 계약 일정 완료인데 재촉은 listings.status 를 봤다.
-- resync_listing 이 접촉 장부에서 이 값을 파생시키므로, 장부 줄을 지우면 상태가 되감기고
-- 두 값이 갈라진다. 0141 이 고친 것과 판박이다.
--
-- **옮기는 자리**
--   철회(안 판다)  → 보류. app.stops(listing · intent · '안판다').
--                    매수 쪽 거절을 보류로 옮긴 것과 정확히 대칭이다.
--   계약 · 계약파기 → 짝의 사실. max(app.nego_rank) >= 4 · proposals.dropped_at
--   후보 · 제안     → 사다리. v_listing_stage 가 이미 판정한다(intent='원함' 등)
--
-- **contacts.status 는 남는다.** 이건 「지금 상태」가 아니라 **그 줄이 말하는 사건**이다.
-- 「계약 체결」 문장이 캘린더 표를 세우고 짝에 picked_at 을 물리는 통로가 여기다.
-- 남는 낱말은 계약 · 계약파기 둘뿐이다.

BEGIN;

-- ── 1. 철회를 보류로 옮긴다 ────────────────────────────────────
-- 「안 판다고 함」은 죽은 게 아니라 지금 안 가는 것이다. 사유가 줄로 서고 풀 수 있어야 한다.
INSERT INTO app.stops(team_id, target_type, target_id, stage, reason, note, created_by, created_at)
SELECT l.team_id, 'listing', l.building_pk, 'intent', '안판다',
       '0142 이관 — 옛 매물 상태 「철회」', l.assignee_account_id, l.updated_at
  FROM app.listings l
 WHERE l.status = '철회'
   AND NOT EXISTS (SELECT 1 FROM app.stops s
                    WHERE s.team_id = l.team_id AND s.target_type='listing'
                      AND s.target_id = l.building_pk AND s.resolved_at IS NULL);

-- 계약파기로 서 있던 매물은 그 짝이 이미 죽어 있다(0141 dropped_at). 옮길 값이 없다.

-- ── 2. 상태 칸을 뗀다 ──────────────────────────────────────────
ALTER TABLE app.listings DROP COLUMN IF EXISTS status;

-- ── 3. 낱말집 ──────────────────────────────────────────────────
DELETE FROM ref.enums       WHERE enum_key = 'jindo';
DELETE FROM ref.enum_groups WHERE enum_key = 'jindo';

COMMENT ON COLUMN app.contacts.status IS
  '이 줄이 말하는 **사건**(계약·계약파기)이지 지금 상태가 아니다(0142).
   매물·짝의 상태는 v_listing_stage·app.nego_rank 가 사실에서 판다.';

COMMIT;
