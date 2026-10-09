"""고객 쪽(S05 §5 · §6) — 프로필 · 저장 · 신고. 전부 누구나(any_user).

저장은 **광고(매물) 단위**다(0205, 10-01). 한 건물에 광고가 여럿일 수 있다.
광고 없는 건물 저장과 「저장한 건물에 새 광고」 알림은 없앴다 — 「이 건물이 나오면」은 구해요가 맡는다.
알림(/alerts)도 출처가 다 사라져 걷었다(구해요 제안 알림을 만들 때 다시 세운다).
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core.db import pool
from ..core.deps import any_user, CurrentUser, viewer

router = APIRouter(tags=["customer"])

_LIVE = "a.state = '노출' AND a.expires_on >= current_date"


# ── 프로필(§5-1) ──────────────────────────────────────────────
# 칸 이름 · 값은 중개사의 고객 기록(app.buyers)과 같다(0214 · 0218) — 문의에서 「고객으로 등록」할 때 그대로 옮겨진다
GOALS = ("시세차익", "수익률", "실사용")
BUILD = ("있음", "없음", "모름")
TIMING = ("3개월 안", "6개월 안", "1년 안", "미정")
EXPERIENCE = ("처음", "보유 경험")
# 고객이 스스로 매기던 의사는 뺐다(0213 — 긴급도는 중개사가). 이해도도 뺐다(0218 — 매입 경험이 더 직관적)
FIELDS = "goal, build_intent, regions, budget_min, budget_max, budget_any, equity_won, timing, experience, is_corp, note"


class ProfileIn(BaseModel):
    goal: list[str] = []
    build_intent: str | None = None
    regions: list[str] = []
    budget_min: int | None = None
    budget_max: int | None = None
    budget_any: bool | None = None    # 희망매매가 상관없음 — 빈칸(모름)과 다르다
    equity_won: int | None = None     # 시드
    timing: str | None = None
    experience: str | None = None
    is_corp: bool | None = None
    note: str | None = None


@router.get("/customer/profile")
async def get_profile(user: CurrentUser = Depends(any_user)):
    r = await pool().fetchrow(f"SELECT {FIELDS} FROM app.customer_profile WHERE account_id=$1", user.account_id)
    return dict(r) if r else {k: ([] if k in ("goal", "regions") else None) for k in FIELDS.split(", ")}


@router.put("/customer/profile")
async def put_profile(body: ProfileIn, user: CurrentUser = Depends(any_user)):
    """모든 칸은 고객이 직접 적는다. 모르면 비운다(null). 받은 문의엔 문의 순간 사본이 따로 있어 여기를 고쳐도 안 바뀐다."""
    if any(g not in GOALS for g in body.goal):
        raise HTTPException(422, "목표는 시세차익 · 수익률 · 실사용")
    if body.build_intent not in (None, *BUILD):
        raise HTTPException(422, "건축의사는 있음 · 없음 · 모름")
    if body.timing not in (None, *TIMING):
        raise HTTPException(422, "시기는 3개월 안 · 6개월 안 · 1년 안 · 미정")
    if body.experience not in (None, *EXPERIENCE):
        raise HTTPException(422, "매입 경험은 처음 · 보유 경험")
    any_ = bool(body.budget_any)
    await pool().execute(
        f"""INSERT INTO app.customer_profile(account_id, {FIELDS}, updated_at)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
            ON CONFLICT (account_id) DO UPDATE SET goal=$2, build_intent=$3, regions=$4, budget_min=$5, budget_max=$6,
              budget_any=$7, equity_won=$8, timing=$9, experience=$10, is_corp=$11, note=$12, updated_at=now()""",
        user.account_id, body.goal or None, body.build_intent, body.regions or None,
        None if any_ else body.budget_min, None if any_ else body.budget_max, body.budget_any or None,
        body.equity_won, body.timing, body.experience, body.is_corp, (body.note or "").strip() or None)
    return {"ok": True}


# ── 관심 저장(§5-2) ───────────────────────────────────────────
class SaveIn(BaseModel):
    ad_id: int


# 고객 마이페이지 「매물」 탭(S09 · 10-04) — 최근 본 · 관심 · 구해요가 한 표다. 줄 칸을 같은 이름으로 맞춘다
_AD_ROW = """lp.pnu, COALESCE(app.parcel_addr(lp.pnu), '') AS addr, a.title AS ad_title, a.state AS ad_state,
             (a.state = '노출' AND a.expires_on < current_date) AS ad_expired,
             -- 광고 가격 = 그 매물의 매매가(0226). 가격 비공개면 안 낸다
             CASE WHEN a.price_open THEN la.price END AS ad_price,
             b.land_area, r.total_area,
             COALESCE(t.office_name, t.name) AS office_name,
             (SELECT ap.photo_id FROM app.ad_photos ap WHERE ap.ad_id = a.id ORDER BY ap.sort LIMIT 1) AS photo_id"""


@router.get("/saves")
async def list_saves(user: CurrentUser = Depends(viewer)):
    """저장한 광고 — 최근 저장이 위. 광고가 내려가면 ad_state 로 보인다."""
    rows = await pool().fetch(
        f"""SELECT s.id, s.ad_id, s.memo, s.created_at, {_AD_ROW},
                  (SELECT count(*) FROM app.ads x JOIN app.listing_parcels xp ON xp.listing_id = x.listing_id AND xp.main
                    WHERE xp.pnu = lp.pnu
                     AND x.state = '노출' AND x.expires_on >= current_date) AS live_ads
             FROM app.saves s
             LEFT JOIN app.ads a ON a.id = s.ad_id
             LEFT JOIN app.listings la ON la.id = a.listing_id
             LEFT JOIN app.listing_parcels lp ON lp.listing_id = la.id AND lp.main
             LEFT JOIN master.parcel_rep r ON r.pnu = lp.pnu
             LEFT JOIN master.buildings b ON b.building_pk = r.rep_pk
             LEFT JOIN app.teams t ON t.id = la.team_id
            WHERE s.account_id = $1 ORDER BY s.created_at DESC""", user.account_id)
    return [dict(r) for r in rows]


@router.get("/customer/recent")
async def recent_views(user: CurrentUser = Depends(viewer)):
    """최근 본 매물 — 30일 안에 연 광고(계정마다 하루 한 번 남는 ad_views). 최근 연 날이 위"""
    if not user.account_id:
        return []
    rows = await pool().fetch(
        f"""SELECT v.ad_id, max(v.viewed_on) AS viewed_on, {_AD_ROW}
              FROM app.ad_views v JOIN app.ads a ON a.id = v.ad_id
              JOIN app.listings la ON la.id = a.listing_id
              LEFT JOIN app.listing_parcels lp ON lp.listing_id = la.id AND lp.main
              LEFT JOIN master.parcel_rep r ON r.pnu = lp.pnu
              LEFT JOIN master.buildings b ON b.building_pk = r.rep_pk
              LEFT JOIN app.teams t ON t.id = la.team_id
             WHERE v.account_id = $1 AND v.viewed_on >= current_date - 30
             GROUP BY v.ad_id, a.id, la.id, lp.pnu, b.land_area, r.total_area, t.office_name, t.name
             ORDER BY max(v.viewed_on) DESC, v.ad_id DESC LIMIT 200""", user.account_id)
    return [dict(r) for r in rows]


@router.get("/saves/ad/{ad_id}")
async def saves_of(ad_id: int, user: CurrentUser = Depends(viewer)):
    """이 광고를 저장했나 — 별의 켜짐."""
    rows = await pool().fetch("SELECT id FROM app.saves WHERE account_id=$1 AND ad_id=$2", user.account_id, ad_id)
    return [dict(r) for r in rows]


@router.post("/saves", status_code=201)
async def add_save(body: SaveIn, user: CurrentUser = Depends(any_user)):
    if not await pool().fetchval("SELECT 1 FROM app.ads WHERE id=$1", body.ad_id):
        raise HTTPException(404, "광고가 없습니다")
    sid = await pool().fetchval(
        """INSERT INTO app.saves(account_id, ad_id) VALUES($1,$2)
           ON CONFLICT (account_id, ad_id) DO NOTHING RETURNING id""",
        user.account_id, body.ad_id)
    return {"id": sid}






@router.delete("/saves/{sid}")
async def del_save(sid: int, user: CurrentUser = Depends(any_user)):
    await pool().execute("DELETE FROM app.saves WHERE id=$1 AND account_id=$2", sid, user.account_id)
    return {"ok": True}


# ── 신고(§6) ─────────────────────────────────────────────────
class ReportIn(BaseModel):
    reason: str               # 거래완료 · 표시정보 다름
    body: str | None = None   # 표시정보 다름이면 무엇이 다른지(필수)


@router.post("/ads/{ad_id}/report", status_code=201)
async def report_ad(ad_id: int, body: ReportIn, user: CurrentUser = Depends(any_user)):
    """들어오면 광고 review 가 검수중이 된다. 한 계정이 한 광고에 확인중인 신고는 하나."""
    if body.reason not in ("거래완료", "표시정보 다름"):
        raise HTTPException(422, "사유는 거래완료 · 표시정보 다름")
    text = (body.body or "").strip()
    if body.reason == "표시정보 다름" and not text:
        raise HTTPException(422, "무엇이 다른지 적으세요")
    ad = await pool().fetchrow(
        """SELECT l.team_id FROM app.ads a JOIN app.listings l ON l.id = a.listing_id
            WHERE a.id=$1 AND a.state IN ('노출','거래완료')""", ad_id)
    if not ad:
        raise HTTPException(404, "광고가 없습니다")
    if user.team_id is not None and ad["team_id"] == user.team_id:
        raise HTTPException(409, "우리 팀 광고는 신고할 수 없습니다")
    rid = await pool().fetchval(
        """INSERT INTO app.ad_reports(ad_id, account_id, reason, body, status) VALUES($1,$2,$3,$4,'확인중')
           ON CONFLICT (ad_id, account_id) WHERE status = '확인중' DO NOTHING RETURNING id""",
        ad_id, user.account_id, body.reason, text or None)
    if rid is None:
        raise HTTPException(409, "이미 신고한 광고입니다")
    await pool().execute("UPDATE app.ads SET review='검수중', updated_at=now() WHERE id=$1", ad_id)
    return {"id": rid}
