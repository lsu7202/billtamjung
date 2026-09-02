-- 0091 · 매물 사다리 단계를 **파생**한다 (S04b §2.1)
--
-- 사람이 단계를 찍지 않는다. 각 칸의 「끝났다 =」가 규칙이고, **빈 칸이 곧 할 일**이다.
-- 상태는 늘 장부의 파생값이라는 원칙(04-data/프로필-커밋.md)과 같다.
--
-- 뷰로 두는 이유: 목록·상세·대시보드가 **같은 계산**을 봐야 한다. 파이썬에 두면
-- 세 군데가 각자 구현하고, 그러면 「목록에선 정보 단계인데 상세에선 자료 단계」가 난다.
--
-- 「확인중」은 **통과**로 본다(S04b §3.4) — 물어봤는데 소유자도 모르는 것이라
-- 더 물어볼 게 없다. 통과 못 하는 건 「미지정」(아직 안 물어봤다)뿐이다.
--
-- 「4 정보」 판정에서 **임대내역은 뺀다**(S04b §3.3) — 광고·현장에서 얻는 값이라
-- 접촉 전에도 차 있다(현장 실측: 임대내역 3,065 > 연락처 2,206). 넣으면
-- 「접촉도 안 했는데 정보 단계 진행 중」이 된다.

BEGIN;

-- CREATE OR REPLACE 는 **컬럼 이름을 못 바꾼다**(s6_expose→s6_match에서 걸렸다).
-- 뷰는 데이터가 없으니 떨어뜨리고 다시 세우는 게 안전하다.
DROP VIEW IF EXISTS app.v_listing_stage;
CREATE VIEW app.v_listing_stage AS
WITH base AS (
  SELECT
    l.building_pk, l.team_id,
    -- ① 소유자 확보 — 이름과 전화가 있다
    (l.owner_id IS NOT NULL AND o.phone IS NOT NULL AND o.phone <> '')        AS s1_owner,
    -- ② 접촉 — 한 번이라도 **말이 됐다**.
    --    증거는 구조화된 것만: 통화됨 칩, 또는 물어봐야만 아는 값(의사·급함·명도·용도변경·멸실)이
    --    하나라도 찍혀 있음 — 그 값을 안다는 건 물어봤다는 뜻이다.
    --    커밋 유무는 증거에서 **뺀다**(2026-08-17) — 지주작업 메모(「구글링 실패」)도 커밋이라,
    --    넣으면 통화 한 번 안 한 매물이 접촉 통과로 잘못 선다.
    --    (부재·전원꺼짐은 시도이지 접촉이 아니다 — 「말이 됐다」가 기준이다.)
    (COALESCE(l.call_result, '') = '통화됨'
     OR (l.intent  IS NOT NULL AND l.intent  <> '미지정')
     OR (l.urgency IS NOT NULL AND l.urgency <> '미지정')
     OR COALESCE(l.meongdo,    '미지정') <> '미지정'
     OR COALESCE(l.use_change, '미지정') <> '미지정'
     OR COALESCE(l.myeolsil,   '미지정') <> '미지정')                          AS s2_touch,
    -- ③ 의사 확인 — 팔 생각을 안다
    -- 원함만 통과(2026-08-18) — 원치않음은 거절이다: 칸을 넘기지 않고 정지(빨강)로 선다
    (l.intent = '원함')                                                        AS s3_intent,
    -- ④ 정보 — 물어봐야 아는 셋의 **답을 안다**(2026-08-18). 확인중은 물어봤다는
    -- 사실(접촉 증거·s2)이지 답이 아니다 — 확인중이면 이 칸은 아직 진행(노랑)이다.
    (COALESCE(l.meongdo,    '미지정') NOT IN ('미지정','확인중')
     AND COALESCE(l.use_change, '미지정') NOT IN ('미지정','확인중')
     AND COALESCE(l.myeolsil,   '미지정') NOT IN ('미지정','확인중'))         AS s4_info,
    -- ⑤ 자료 — 사진과 보고서가 있다.
    --    photos 는 팀에 붙어 있지만 reports 는 **계정**에 붙어 있어(account_id) 팀으로 이어야 한다.
    --    안 이으면 다른 팀이 만든 보고서로 우리 자료 단계가 통과된다.
    (EXISTS (SELECT 1 FROM app.photos p
              WHERE p.building_pk = l.building_pk AND p.team_id = l.team_id
                AND p.deleted_at IS NULL)
     AND EXISTS (SELECT 1 FROM app.reports r
                  JOIN app.team_members tm ON tm.account_id = r.account_id
                  WHERE r.building_pk = l.building_pk AND tm.team_id = l.team_id
                    AND r.status = 'done'))                                    AS s5_asset,
    -- ⑤ 매칭 — **살 사람과 붙었다**: 제안이 하나라도 섰다(2026-08-18).
    -- 광고·공동중개(노출)는 매칭의 수단이지 단계가 아니다 — 체크리스트로 따로 관리.
    (EXISTS (
        SELECT 1 FROM app.proposals pr
         WHERE pr.team_id = l.team_id AND pr.building_pk = l.building_pk))     AS s6_match,
    -- 정보 칸의 채움 수 — 「답을 아는」 칸만 센다(확인중은 0)
    (CASE WHEN COALESCE(l.meongdo,   '미지정') NOT IN ('미지정','확인중') THEN 1 ELSE 0 END
   + CASE WHEN COALESCE(l.use_change,'미지정') NOT IN ('미지정','확인중') THEN 1 ELSE 0 END
   + CASE WHEN COALESCE(l.myeolsil,  '미지정') NOT IN ('미지정','확인중') THEN 1 ELSE 0 END)  AS info_filled
  FROM app.listings l
  LEFT JOIN app.owners o ON o.id = l.owner_id AND o.deleted_at IS NULL
)
SELECT building_pk, team_id,
       s1_owner, s2_touch, s3_intent, s4_info, s5_asset, s6_match, info_filled,
       -- **지금 단계** = 처음 못 넘은 칸. 단조 증가라 하나로 정해진다.
       -- 자료(asset)는 칸이 아니라 노출 창의 준비물 체크리스트다(0101) —
       -- s5_asset 플래그는 표시용으로만 남고 단계 사슬·passed 에서 빠진다.
       CASE WHEN NOT s1_owner  THEN 'owner'
            WHEN NOT s2_touch  THEN 'touch'
            WHEN NOT s3_intent THEN 'intent'
            WHEN NOT s4_info   THEN 'info'
            WHEN NOT s6_match  THEN 'match'
            ELSE 'done' END                                     AS stage,
       -- 몇 칸 넘었나 / 다섯 칸
       (s1_owner::int + s2_touch::int + s3_intent::int
      + s4_info::int + s6_match::int)                           AS passed
  FROM base;

COMMENT ON VIEW app.v_listing_stage IS
  '매물 사다리 단계 — 필드에서 파생(S04b §2.1). stage = 처음 못 넘은 칸.';

COMMIT;
