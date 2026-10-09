"""구해요 · 관심 정도(S06, 0202, 대표 09-30).

구해요 = 고객이 땅(지번 · 나대지 포함)에 남기는 「이런 곳 구해요」(10-08 지번 열쇠 · 0253). 목록은 누구나 같은 것을 본다(이름 · 연락처 없이).
  · 고객이 남긴다(건물 하나 · 한마디). 한 고객이 한 건물에 열린 구해요는 하나
  · 중개사가 제안을 보낸다(팀당 하나). 5개가 차면 마감, 30일이 지나면 목록에서 빠진다
  · 고객이 제안을 고르면 그 팀에 매수 문의가 생기고, 그때 이름 · 전화가 넘어간다
가격 칸은 어디에도 두지 않는다 — 호가창이 생기지 않게.

관심 정도 = 광고마다 저장한 계정 수(app.saves) + 오늘(KST) 연 계정 수(app.ad_views). 누구나 본다(0205).
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core.db import pool, tx
from ..core.deps import any_user, current_user, CurrentUser, viewer
from . import search as search_mod

router = APIRouter(tags=["seeks"])

TODAY = "(now() AT TIME ZONE 'Asia/Seoul')::date"
_OPEN = f"s.state <> '닫힘' AND s.expires_on >= {TODAY}"


def _customer(user: CurrentUser) -> None:
    if user.kind != "고객":
        raise HTTPException(403, "고객만 남길 수 있습니다")


# ── 관심 정도 — 광고(매물) 단위(0205, 10-01) ─────────────────
class ViewIn(BaseModel):
    ad_id: int


@router.post("/views")
async def add_view(body: ViewIn, user: CurrentUser = Depends(viewer)):
    """광고를 열었다 — 계정마다 하루 한 번만 센다."""
    if not user.account_id:          # 손님은 세지 않는다 — 계정이 없다
        return {"ok": True}
    await pool().execute(
        "INSERT INTO app.ad_views(ad_id, account_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        body.ad_id, user.account_id)
    return {"ok": True}


@router.get("/interest")
async def interest(ads: str, user: CurrentUser = Depends(viewer)):
    """광고마다 저장한 사람 수 · 오늘 본 사람 수. ads 는 쉼표로 이은 광고 번호(최대 200)."""
    ids = [int(x) for x in ads.split(",") if x.strip().isdigit()][:200]
    if not ids:
        return []
    rows = await pool().fetch(
        f"""SELECT k AS ad_id,
                  (SELECT count(*) FROM app.saves s WHERE s.ad_id = k) AS saves,
                  (SELECT count(*) FROM app.ad_views v WHERE v.ad_id = k AND v.viewed_on = {TODAY}) AS today
             FROM unnest($1::bigint[]) k""", ids)
    return [dict(r) for r in rows]


async def _rows(pnus: list[str], user: CurrentUser):
    """열린 구해요 줄(익명) — 예산 · 목적만. mine = 내 것, our = 우리 팀 제안 상태."""
    return await pool().fetch(
        f"""SELECT s.id, s.pnu, s.note, s.state, s.cap, s.created_at,
                  (s.expires_on - {TODAY}) AS days_left,
                  (SELECT count(*) FROM app.seek_proposals p WHERE p.seek_id = s.id) AS n_prop,
                  (s.account_id = $2) AS mine,
                  (SELECT p.state FROM app.seek_proposals p WHERE p.seek_id = s.id AND p.team_id = $3) AS our,
                  cp.budget_min, cp.budget_max, cp.goal   -- 예산 · 목표만(나머지 배경은 고른 사무소만 문의로 본다)
             FROM app.seeks s
             LEFT JOIN app.customer_profile cp ON cp.account_id = s.account_id
            WHERE {_OPEN} AND s.pnu = ANY($1::text[])
            ORDER BY s.created_at DESC""", pnus, user.account_id, user.team_id)


@router.get("/seeks/parcel/{pnu}")
async def seeks_of(pnu: str, user: CurrentUser = Depends(viewer)):
    """지번 하나의 열린 구해요 — 상세 판. 조건과 상관없이 고른 지번의 것을 다 낸다."""
    return [dict(r) for r in await _rows([pnu], user)]


# ── 구해요 목록(누구나) ───────────────────────────────────────
@router.post("/seeks/search")
async def search_seeks(body: search_mod.SearchIn, user: CurrentUser = Depends(viewer)):
    """조건(검색 요청 몸통 그대로)에 맞는 건물의 열린 구해요. 이름 · 연락처는 안 낸다.
    예산 · 목적은 남긴 사람의 고객 프로필에서 읽는다. mine = 내 것, our = 우리 팀 제안 상태."""
    open_pnus = await pool().fetch(f"SELECT DISTINCT s.pnu FROM app.seeks s WHERE {_OPEN}")
    pnus = [r["pnu"] for r in open_pnus]
    if not pnus:
        return []
    await search_mod.load_guards()
    await search_mod.resolve_biz(body)
    body.tab, body.chip, body.bbox, body.mine_only = "all", "", None, False
    base, args, outer_sql = search_mod._build_base(body, user)
    args.append(pnus)
    k = len(args)
    bld = await pool().fetch(
        base + f"""SELECT pnu, building_pk, addr, lng, lat, sale_est, land_area, total_area
                   FROM classified WHERE lng IS NOT NULL AND pnu = ANY(${k}::text[]) {outer_sql}""", *args)
    info = {r["pnu"]: dict(r) for r in bld}
    if not info:
        return []
    rows = await _rows(list(info), user)
    return [{**dict(r), **{k2: v for k2, v in info[r["pnu"]].items() if k2 != "pnu"}} for r in rows]


# ── 고객 ─────────────────────────────────────────────────────
class SeekIn(BaseModel):
    pnu: str
    note: str | None = None


@router.post("/seeks", status_code=201)
async def add_seek(body: SeekIn, user: CurrentUser = Depends(any_user)):
    _customer(user)
    note = (body.note or "").strip() or None
    if note and len(note) > 200:
        raise HTTPException(422, "한마디는 200자까지")
    # 30일이 지나 목록에서 빠진 옛 구해요는 닫고 새로 연다
    await pool().execute(
        f"UPDATE app.seeks s SET state='닫힘', closed_at=now() WHERE account_id=$1 AND pnu=$2 "
        f"AND state <> '닫힘' AND expires_on < {TODAY}", user.account_id, body.pnu)
    sid = await pool().fetchval(
        """INSERT INTO app.seeks(account_id, pnu, note) VALUES($1,$2,$3)
           ON CONFLICT (account_id, pnu) WHERE state <> '닫힘' DO NOTHING RETURNING id""",
        user.account_id, body.pnu, note)
    if sid is None:
        raise HTTPException(409, "이 땅에 이미 남긴 구해요가 있습니다")
    return {"id": sid}


@router.get("/seeks/mine")
async def my_seeks(user: CurrentUser = Depends(any_user)):
    """내 구해요(최근 순)와 받은 제안. 제안에는 사무소 · 중개사 이름과 제안한 매물 주소가 붙는다."""
    rows = await pool().fetch(
        f"""SELECT s.id, s.pnu, s.note, s.state, s.cap, s.created_at, s.expires_on,
                  (s.expires_on - {TODAY}) AS days_left, COALESCE(app.parcel_addr(s.pnu), '') AS addr,
                  COALESCE((SELECT json_agg(json_build_object(
                      'id', p.id, 'state', p.state, 'message', p.message, 'created_at', p.created_at,
                      'office_name', COALESCE(t.office_name, t.name), 'agent_name', a.name,
                      'listing_id', p.listing_id, 'listing_addr', app.parcel_addr(lp.pnu)) ORDER BY p.created_at)
                    FROM app.seek_proposals p
                    JOIN app.teams t ON t.id = p.team_id
                    JOIN app.accounts a ON a.id = p.account_id
                    LEFT JOIN app.listing_parcels lp ON lp.listing_id = p.listing_id AND lp.main
                   WHERE p.seek_id = s.id), '[]'::json) AS proposals
             FROM app.seeks s
            WHERE s.account_id = $1 ORDER BY (s.state = '닫힘'), s.created_at DESC LIMIT 100""", user.account_id)
    import json
    return [{**dict(r), "proposals": json.loads(r["proposals"]) if isinstance(r["proposals"], str) else r["proposals"]}
            for r in rows]


@router.post("/seeks/{sid}/extend")
async def extend_seek(sid: int, user: CurrentUser = Depends(any_user)):
    n = await pool().execute(
        f"UPDATE app.seeks SET expires_on = {TODAY} + 30 WHERE id=$1 AND account_id=$2 AND state <> '닫힘'",
        sid, user.account_id)
    if n.endswith(" 0"):
        raise HTTPException(404, "열린 구해요가 아닙니다")
    return {"ok": True}


@router.delete("/seeks/{sid}")
async def close_seek(sid: int, user: CurrentUser = Depends(any_user)):
    await pool().execute(
        "UPDATE app.seeks SET state='닫힘', closed_at=now() WHERE id=$1 AND account_id=$2 AND state <> '닫힘'",
        sid, user.account_id)
    return {"ok": True}


class PickIn(BaseModel):
    name: str
    phone: str
    consent: bool


async def _my_proposal(pid: int, user: CurrentUser):
    p = await pool().fetchrow(
        """SELECT p.id, p.state, p.team_id, p.listing_id, s.id AS seek_id, s.note, s.state AS seek_state, s.pnu
             FROM app.seek_proposals p JOIN app.seeks s ON s.id = p.seek_id
            WHERE p.id = $1 AND s.account_id = $2""", pid, user.account_id)
    if not p:
        raise HTTPException(404, "제안이 없습니다")
    if p["seek_state"] == "닫힘":
        raise HTTPException(409, "닫은 구해요입니다")
    return p


@router.post("/proposals/{pid}/pick")
async def pick_proposal(pid: int, body: PickIn, user: CurrentUser = Depends(any_user)):
    """제안을 고른다 — 그 팀에 매수 문의가 생기고 이름 · 전화가 넘어간다. 여러 제안을 골라도 된다."""
    if not body.consent:
        raise HTTPException(422, "개인정보 제공에 동의해야 고를 수 있습니다")
    if not body.name.strip() or not body.phone.strip():
        raise HTTPException(422, "이름과 전화를 적으세요")
    p = await _my_proposal(pid, user)
    if p["state"] == "채택":
        raise HTTPException(409, "이미 고른 제안입니다")
    text = f"[구해요] {p['note']}" if p["note"] else "[구해요]"
    async with tx() as con:
        from .inquiries import profile_snapshot, wants_snapshot     # 문의 순간 고객 배경 · 조건 사본(S09)
        snap = await profile_snapshot(con, user.account_id)
        wants = await wants_snapshot(con, user.account_id)
        iid = await con.fetchval(
            """INSERT INTO app.inquiries(team_id, account_id, kind, body, name, phone, consent_at, seek_id,
                                         listing_id, profile_snap, wants_snap)
               VALUES($1,$2,'매수 문의',$3,$4,$5,now(),$6,$7,$8::jsonb,$9::jsonb) RETURNING id""",
            p["team_id"], user.account_id, text[:200], body.name.strip(), body.phone.strip(), p["seek_id"],
            p["listing_id"], snap, wants)
        await con.execute("UPDATE app.seek_proposals SET state='채택' WHERE id=$1", pid)
    return {"inquiry_id": iid}


@router.post("/proposals/{pid}/reject")
async def reject_proposal(pid: int, user: CurrentUser = Depends(any_user)):
    p = await _my_proposal(pid, user)
    if p["state"] != "보냄":
        raise HTTPException(409, "이미 고른 제안은 거절할 수 없습니다")
    await pool().execute("UPDATE app.seek_proposals SET state='거절' WHERE id=$1", pid)
    return {"ok": True}


# ── 중개사 ───────────────────────────────────────────────────
class ProposalIn(BaseModel):
    listing_id: int | None = None
    message: str | None = None


@router.post("/seeks/{sid}/proposals", status_code=201)
async def send_proposal(sid: int, body: ProposalIn, user: CurrentUser = Depends(current_user)):
    """제안 보내기 — 팀당 하나. 제안 수가 cap 에 닿으면 마감(목록엔 남되 더 못 받는다)."""
    msg = (body.message or "").strip() or None
    if msg and len(msg) > 300:
        raise HTTPException(422, "한마디는 300자까지")
    if body.listing_id:
        ok = await pool().fetchval("SELECT 1 FROM app.listings WHERE team_id=$1 AND id=$2",
                                   user.team_id, body.listing_id)
        if not ok:
            raise HTTPException(422, "매물관리에 담긴 매물이 아닙니다")
    async with tx() as con:
        s = await con.fetchrow(
            f"SELECT s.id, s.state, s.cap FROM app.seeks s WHERE s.id=$1 AND {_OPEN} FOR UPDATE", sid)
        if not s:
            raise HTTPException(404, "열린 구해요가 아닙니다")
        if s["state"] == "마감":
            raise HTTPException(409, "제안을 다 받은 구해요입니다")
        pid = await con.fetchval(
            """INSERT INTO app.seek_proposals(seek_id, team_id, account_id, listing_id, message)
               VALUES($1,$2,$3,$4,$5) ON CONFLICT (seek_id, team_id) DO NOTHING RETURNING id""",
            sid, user.team_id, user.account_id, body.listing_id, msg)
        if pid is None:
            raise HTTPException(409, "우리 사무소는 이미 제안했습니다")
        n = await con.fetchval("SELECT count(*) FROM app.seek_proposals WHERE seek_id=$1", sid)
        if n >= s["cap"]:
            await con.execute("UPDATE app.seeks SET state='마감' WHERE id=$1", sid)
    return {"id": pid}
