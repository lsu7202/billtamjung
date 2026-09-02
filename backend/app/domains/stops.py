"""멈춤 — 사다리 어느 칸에서든 겹치는 공통 축. 정본 specs/03-features/S04b §2.3.

「실패」는 칸마다 생긴다: 연락처 못 캠 · 연락두절 · 안 판다 · 진행불가 · 매수자 없음 · 보류.
그런데 전부 같은 말이다 — **지금은 못 간다 + 무엇이 있으면 다시 간다.**
그래서 칸마다 필드를 두지 않고 하나로 합쳤다. 화면도 하나로 쓴다(사유 칩만 칸별로 달라진다).

**죽이는 것과 다르다.** 죽은 것(proposals.dropped_at)은 끝났고 보류는 살아 있는 채로 멈춘
것이다. 죽이면 영영 안 뜨고, 그냥 두면 매일 재촉이 뜬다. 예전엔 이 둘뿐이었다.
그래서 매수의 「거절」도 매도의 「철회」도 여기로 옮겼다(0141·0142) — 안 산다던 사람이,
안 판다던 사람이 반년 뒤 마음을 바꾸는 게 이 바닥이다.

**깨우기는 두지 않는다**(0140). 예전엔 「언제 다시 볼까」를 같이 물었는데
(날짜·막연한 시점·조건 다섯 갈래) 아무도 안 썼다 — 열린 보류 0건에 날짜가 든 건 1건뿐이었다.
날짜를 넣어도 그날 무슨 일이 일어나는지가 분명하지 않았다.
**다시 볼 일이 정해져 있으면 그건 일정이다.** 보류는 「지금은 안 본다」와 그 사유면 족하고,
깨우는 건 사람이 보류를 푸는 것으로 끝난다.

**대상 셋**: listing(매물 전체) · buyer(사람) · **proposal(매수자×매물 짝)**.
짝 보류가 「이 매수자는 이 매물을 안 산다」를 적는 자리다 — 그 일을 제안 거절이 대신하고
있었는데, 거절은 한 번 적고 끝인 반면 보류는 사유가 줄로 서고 풀 수 있다.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core.db import pool
from ..core.deps import current_user, CurrentUser

router = APIRouter(tags=["stops"])

TARGETS = ("listing", "buyer", "proposal")
# 사다리 칸 — 사유 목록을 고르는 키이기도 하다(ref.enums 'stop_reason_<stage>')
# asset 은 칸에서 빠졌다(0101) — 자료는 노출 창의 준비물 체크리스트
STAGES = ("owner", "touch", "intent", "info", "match", "find", "deal")

class StopIn(BaseModel):
    target_type: str
    target_id: str
    stage: str
    reason: str | None = None
    note: str | None = None


@router.post("/stops")
async def open_stop(body: StopIn, user: CurrentUser = Depends(current_user)):
    """멈춘다. 한 대상에 열린 멈춤은 하나뿐이라(0090 유니크) **다시 부르면 덮어쓴다** —
    같은 대상에 사유가 둘이면 어느 쪽이 지금 사실인지 알 수 없다."""
    if body.target_type not in TARGETS:
        raise HTTPException(422, f"대상은 {'/'.join(TARGETS)} 중 하나")
    if body.stage not in STAGES:
        raise HTTPException(422, f"단계는 {'/'.join(STAGES)} 중 하나")
    row = await pool().fetchrow(
        """INSERT INTO app.stops(team_id, target_type, target_id, stage, reason, note, created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (team_id, target_type, target_id) WHERE resolved_at IS NULL
           DO UPDATE SET stage=EXCLUDED.stage, reason=EXCLUDED.reason, note=EXCLUDED.note,
                         created_by=EXCLUDED.created_by, created_at=now()
           RETURNING id""",
        user.team_id, body.target_type, body.target_id, body.stage, body.reason,
        body.note, user.account_id)
    # 장부 한 줄 — 「소유자 찾기 실패 · 연락처못캠 · DM 회신 오면」.
    # 낱말은 칸의 언어로(2026-08-17): 소유자 찾기=실패 · 그 외=정지(각 칸 손볼 때 그 칸 말로).
    # 장부 줄은 남기지 않는다(2026-08-18) — 정지는 값(app.stops)이 이미 사실이고,
    # 값을 고칠 때마다 그림자가 쌓이면 「이게 상태인가」 하는 오해가 생긴다.
    return {"id": row["id"]}


@router.delete("/stops/{stop_id}")
async def resolve_stop(stop_id: int, user: CurrentUser = Depends(current_user)):
    """깨운다 — 지우지 않고 `resolved_at`을 찍는다.
    지우면 「왜 멈췄었나」가 사라져 같은 판단을 또 하게 된다(엑셀의 빨강 규칙과 같은 이유)."""
    row = await pool().fetchrow(
        """UPDATE app.stops SET resolved_at=now()
            WHERE id=$1 AND team_id=$2 AND resolved_at IS NULL
            RETURNING target_type, target_id, stage""",
        stop_id, user.team_id)
    if row is None:
        raise HTTPException(404, "열린 멈춤을 찾을 수 없습니다")
    return {"ok": True}


@router.get("/stops")
async def list_stops(user: CurrentUser = Depends(current_user), sleeping: bool = False):
    """열린 보류 전부. `sleeping=true`면 **오래 멈춘 것**만(30일 넘게).
    깨울 날짜가 없어졌으니(0140) 「잠든 것」의 기준은 멈춘 기간 하나다."""
    rows = await pool().fetch(
        """SELECT s.*, current_date - s.created_at::date AS held_days,
                  COALESCE(b.addr, pb.addr) AS addr,
                  o.name AS owner_name,
                  COALESCE(y.name, py.name) AS buyer_name,
                  p.building_pk AS proposal_pk, p.buyer_id AS proposal_buyer_id
             FROM app.stops s
             LEFT JOIN master.buildings b
                    ON s.target_type='listing' AND b.building_pk = s.target_id
             LEFT JOIN app.listings l
                    ON s.target_type='listing' AND l.team_id = s.team_id
                   AND l.building_pk = s.target_id
             LEFT JOIN app.owners o ON o.id = l.owner_id AND o.deleted_at IS NULL
             LEFT JOIN app.buyers y
                    ON s.target_type='buyer' AND y.id = s.target_id::bigint
                   AND y.deleted_at IS NULL
             -- 짝 보류(proposal)는 매수자 이름과 매물 주소를 둘 다 들고 서야 읽힌다
             LEFT JOIN app.proposals p
                    ON s.target_type='proposal' AND p.id = s.target_id::bigint
                   AND p.team_id = s.team_id
             LEFT JOIN master.buildings pb ON pb.building_pk = p.building_pk
             LEFT JOIN app.buyers py ON py.id = p.buyer_id AND py.deleted_at IS NULL
            WHERE s.team_id=$1 AND s.resolved_at IS NULL
              AND ($2 IS FALSE OR s.created_at < now() - interval '30 days')
            ORDER BY s.created_at""",
        user.team_id, sleeping)
    return [dict(r) for r in rows]
