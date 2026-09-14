"""팀 협업: 조회·팀명·초대(생성/재전송/취소/수락)·제외·탈퇴 + 담당 매물 대표 승계.
specs S0M-마이페이지 §3.2~3.6. 한 계정=활성 팀 1개(0023 one_active_membership).
베타: 초대는 실제 이메일/SMS 발송 없이 코드(token) 반환 — 대표가 직접 전달, 수락자가 코드 입력."""
import os
import secrets
import uuid
import datetime as dt
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel
from ..core import storage
from ..core.db import pool, tx
from ..core.deps import current_user, CurrentUser
from .auth import _issue  # 활성 멤버십 기준 access 재발급(+refresh 쿠키). 팀 이동 후 team_id 갱신

router = APIRouter(prefix="/team", tags=["team"])
INVITE_TTL_DAYS = 7


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class RenameIn(BaseModel):
    name: str


class InviteIn(BaseModel):
    channel: str = "email"   # email|phone
    target: str


class AcceptIn(BaseModel):
    token: str


# ── 승계/복귀 헬퍼 ────────────────────────────────────
async def _leave_team(conn, team_id: int, account_id: int) -> None:
    """account를 team에서 나가게 함. 팀원이면 담당 매물(전화·비밀메모 접근 포함)을 대표에게 승계."""
    role = await conn.fetchval(
        "SELECT role FROM app.team_members WHERE team_id=$1 AND account_id=$2 AND left_at IS NULL",
        team_id, account_id,
    )
    if role == "member":
        owner = await conn.fetchval(
            "SELECT account_id FROM app.team_members WHERE team_id=$1 AND role='owner' AND left_at IS NULL",
            team_id,
        )
        if owner:  # 고아 매물 방지: 담당 매물을 대표에게 자동 귀속(specs S0M §3.5)
            await conn.execute(
                "UPDATE app.listings SET assignee_account_id=$1, updated_at=now() "
                "WHERE team_id=$2 AND assignee_account_id=$3",
                owner, team_id, account_id,
            )
    await conn.execute(
        "UPDATE app.team_members SET left_at=now() WHERE team_id=$1 AND account_id=$2 AND left_at IS NULL",
        team_id, account_id,
    )


async def _return_home(conn, account_id: int) -> int:
    """나간 계정을 자신의 1인 팀(대표)으로 복귀. 없으면 생성. 항상 활성 멤버십 1개 유지."""
    home = await conn.fetchval(
        "SELECT id FROM app.teams WHERE owner_account_id=$1 ORDER BY id LIMIT 1", account_id
    )
    if home is None:
        name = await conn.fetchval(
            "SELECT COALESCE(office_name, name || ' 팀') FROM app.accounts WHERE id=$1", account_id
        )
        home = await conn.fetchval(
            "INSERT INTO app.teams(name,owner_account_id) VALUES($1,$2) RETURNING id", name, account_id
        )
    await conn.execute(
        """INSERT INTO app.team_members(team_id,account_id,role) VALUES($1,$2,'owner')
           ON CONFLICT (team_id,account_id)
           DO UPDATE SET left_at=NULL, role='owner', joined_at=now()""",
        home, account_id,
    )
    return home


# ── 조회 ─────────────────────────────────────────────
@router.get("")
async def get_team(user: CurrentUser = Depends(current_user)):
    """내 팀 정보 + 멤버 + (대표면)대기 초대."""
    t = await pool().fetchrow("SELECT id, name FROM app.teams WHERE id=$1", user.team_id)
    members = await pool().fetch(
        """SELECT a.id AS account_id, a.name, a.email, tm.role, tm.joined_at
           FROM app.team_members tm JOIN app.accounts a ON a.id=tm.account_id
           WHERE tm.team_id=$1 AND tm.left_at IS NULL AND a.deleted_at IS NULL
           ORDER BY (tm.role='owner') DESC, a.name""",
        user.team_id,
    )
    out = {
        "id": t["id"], "name": t["name"], "my_role": user.role,
        "member_count": len(members),
        "members": [
            {"account_id": m["account_id"], "name": m["name"], "email": m["email"],
             "role": m["role"], "is_me": m["account_id"] == user.account_id}
            for m in members
        ],
        "invites": [],
    }
    if user.role == "owner":
        inv = await pool().fetch(
            """SELECT id, channel::text AS channel, target, token, expires_at, created_at
               FROM app.team_invites WHERE team_id=$1 AND status='pending'
               ORDER BY created_at DESC""",
            user.team_id,
        )
        out["invites"] = [dict(r) for r in inv]
    return out


@router.patch("")
async def rename_team(body: RenameIn, user: CurrentUser = Depends(current_user)):
    if user.role != "owner":
        raise HTTPException(403, "대표만 팀 이름을 변경할 수 있습니다")
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "팀 이름을 입력하세요")
    await pool().execute("UPDATE app.teams SET name=$1 WHERE id=$2", name, user.team_id)
    return {"ok": True, "name": name}


class OfficeIn(BaseModel):
    """브리핑 표지·마무리에 들어가는 사무소 정보(0032). 받는 쪽이 보는 건 '어느 사무소가 준 자료인가'."""
    office_name: str | None = None
    agent_name: str | None = None
    agent_title: str | None = None
    phone: str | None = None
    fax: str | None = None
    email: str | None = None
    office_addr: str | None = None
    reg_no: str | None = None              # 개설등록번호(0128) — 계약서·확인설명서 하단 란
    fee_rate: float | None = None          # 중개보수 요율(%) 기본값(0128)


_OFFICE_COLS = ("office_name", "agent_name", "agent_title", "phone", "fax", "email", "office_addr", "reg_no")


@router.get("/office")
async def get_office(user: CurrentUser = Depends(current_user)):
    row = await pool().fetchrow(
        f"SELECT name, {', '.join(_OFFICE_COLS)}, fee_rate, logo_path FROM app.teams WHERE id=$1", user.team_id)
    d = dict(row) if row else {}
    d["has_logo"] = bool(d.pop("logo_path", None))
    if d.get("fee_rate") is not None:
        d["fee_rate"] = float(d["fee_rate"])
    return d


@router.patch("/office")
async def set_office(body: OfficeIn, user: CurrentUser = Depends(current_user)):
    if user.role != "owner":
        raise HTTPException(403, "대표만 사무소 정보를 수정할 수 있습니다")
    # PATCH 는 **보낸 칸만** 고친다(2026-08-28). 예전엔 body 전체를 그대로 UPDATE 해서,
    # 한 칸만 담아 보내면 나머지가 전부 NULL 로 지워졌다. 화면이 늘 폼 전체를 보내던 시절엔
    # 안 드러났는데, 줄 하나씩 고치는 어법으로 바꾸자마자 상호·등록번호·연락처가 날아갔다.
    vals = body.model_dump(exclude_unset=True)
    if not vals:
        return {"ok": True}
    sets, args = [], []
    for c in _OFFICE_COLS:
        if c in vals:
            args.append((vals[c] or "").strip() or None)
            sets.append(f"{c}=${len(args) + 1}")
    if "fee_rate" in vals:
        args.append(vals["fee_rate"])
        sets.append(f"fee_rate=${len(args) + 1}")
    await pool().execute(
        f"UPDATE app.teams SET {', '.join(sets)} WHERE id=$1", user.team_id, *args)
    return {"ok": True}


@router.post("/office/logo")
async def upload_logo(file: UploadFile = File(...), user: CurrentUser = Depends(current_user)):
    if user.role != "owner":
        raise HTTPException(403, "대표만 로고를 등록할 수 있습니다")
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(422, "이미지 파일만 올릴 수 있습니다")
    key = f"logos/team{user.team_id}_{uuid.uuid4().hex}{os.path.splitext(file.filename or '')[1][:8] or '.png'}"
    await storage.save(key, await file.read(), file.content_type or "image/png")
    await pool().execute("UPDATE app.teams SET logo_path=$1 WHERE id=$2", key, user.team_id)
    return {"ok": True}


@router.get("/office/logo")
async def get_logo(user: CurrentUser = Depends(current_user)):
    key = await pool().fetchval("SELECT logo_path FROM app.teams WHERE id=$1", user.team_id)
    data = await storage.load(key) if key else None
    if data is None:
        raise HTTPException(404, "등록된 로고가 없습니다")
    return Response(content=data, media_type="image/png", headers={"Cache-Control": "private, max-age=300"})


@router.delete("/office/logo")
async def del_logo(user: CurrentUser = Depends(current_user)):
    if user.role != "owner":
        raise HTTPException(403, "대표만 로고를 지울 수 있습니다")
    await pool().execute("UPDATE app.teams SET logo_path=NULL WHERE id=$1", user.team_id)
    return {"ok": True}


# ── 초대 ─────────────────────────────────────────────
def _invite_out(rid: int, token: str, target: str, exp: dt.datetime) -> dict:
    return {"id": rid, "token": token, "target": target, "expires_at": exp.isoformat()}


@router.post("/invites")
async def create_invite(body: InviteIn, user: CurrentUser = Depends(current_user)):
    if user.role != "owner":
        raise HTTPException(403, "대표만 팀원을 초대할 수 있습니다")
    if body.channel not in ("email", "phone"):
        raise HTTPException(422, "channel은 email|phone")
    target = body.target.strip()
    if not target:
        raise HTTPException(422, "초대 대상(이메일·전화)을 입력하세요")
    token = secrets.token_urlsafe(9)
    exp = _now() + dt.timedelta(days=INVITE_TTL_DAYS)
    rid = await pool().fetchval(
        """INSERT INTO app.team_invites(team_id,invited_by,channel,target,token,expires_at)
           VALUES($1,$2,$3::app.invite_channel,$4,$5,$6) RETURNING id""",
        user.team_id, user.account_id, body.channel, target, token, exp,
    )
    # 베타: 발송 스텁 — 코드 반환(대표가 전달). 정식: 이메일/SMS 발송으로 교체.
    return _invite_out(rid, token, target, exp)


@router.post("/invites/{invite_id}/resend")
async def resend_invite(invite_id: int, user: CurrentUser = Depends(current_user)):
    if user.role != "owner":
        raise HTTPException(403, "대표만 가능합니다")
    token = secrets.token_urlsafe(9)
    exp = _now() + dt.timedelta(days=INVITE_TTL_DAYS)
    row = await pool().fetchrow(
        """UPDATE app.team_invites SET token=$1, expires_at=$2, status='pending', created_at=now()
           WHERE id=$3 AND team_id=$4 AND status='pending' RETURNING id, target""",
        token, exp, invite_id, user.team_id,
    )
    if not row:
        raise HTTPException(404, "대기 중인 초대가 아닙니다")
    return _invite_out(row["id"], token, row["target"], exp)


@router.delete("/invites/{invite_id}")
async def cancel_invite(invite_id: int, user: CurrentUser = Depends(current_user)):
    if user.role != "owner":
        raise HTTPException(403, "대표만 가능합니다")
    await pool().execute(
        "UPDATE app.team_invites SET status='cancelled' WHERE id=$1 AND team_id=$2 AND status='pending'",
        invite_id, user.team_id,
    )
    return {"ok": True}


@router.post("/invites/accept")
async def accept_invite(body: AcceptIn, resp: Response, user: CurrentUser = Depends(current_user)):
    """초대 코드로 팀 합류. 현재 팀에서 나가고(담당 매물 승계) 새 팀에 팀원으로 합류 → 토큰 재발급."""
    async with tx() as conn:
        inv = await conn.fetchrow(
            "SELECT id, team_id, status, expires_at FROM app.team_invites WHERE token=$1 FOR UPDATE",
            body.token.strip(),
        )
        if not inv or inv["status"] != "pending":
            raise HTTPException(404, "유효하지 않은 초대입니다")
        if inv["expires_at"] and inv["expires_at"] < _now():
            await conn.execute("UPDATE app.team_invites SET status='expired' WHERE id=$1", inv["id"])
            raise HTTPException(410, "만료된 초대입니다")
        if inv["team_id"] == user.team_id:
            raise HTTPException(409, "이미 이 팀의 멤버입니다")
        if user.role == "owner":  # 팀원 있는 대표는 이동 불가(팀 고아화 방지)
            others = await conn.fetchval(
                "SELECT count(*) FROM app.team_members "
                "WHERE team_id=$1 AND left_at IS NULL AND account_id<>$2",
                user.team_id, user.account_id,
            )
            if others:
                raise HTTPException(409, "팀원이 있는 대표는 다른 팀으로 이동할 수 없습니다")
        await _leave_team(conn, user.team_id, user.account_id)
        await conn.execute(
            """INSERT INTO app.team_members(team_id,account_id,role) VALUES($1,$2,'member')
               ON CONFLICT (team_id,account_id)
               DO UPDATE SET left_at=NULL, role='member', joined_at=now()""",
            inv["team_id"], user.account_id,
        )
        await conn.execute(
            "UPDATE app.team_invites SET status='accepted', accepted_by=$1, accepted_at=now() WHERE id=$2",
            user.account_id, inv["id"],
        )
    acc = await pool().fetchrow("SELECT id, tier FROM app.accounts WHERE id=$1", user.account_id)
    return await _issue(resp, dict(acc))


# ── 제외 · 탈퇴 ───────────────────────────────────────
@router.delete("/members/{account_id}")
async def remove_member(account_id: int, user: CurrentUser = Depends(current_user)):
    if user.role != "owner":
        raise HTTPException(403, "대표만 팀원을 제외할 수 있습니다")
    if account_id == user.account_id:
        raise HTTPException(422, "대표는 자신을 제외할 수 없습니다")
    async with tx() as conn:
        m = await conn.fetchval(
            "SELECT role FROM app.team_members WHERE team_id=$1 AND account_id=$2 AND left_at IS NULL",
            user.team_id, account_id,
        )
        if not m:
            raise HTTPException(404, "팀 멤버가 아닙니다")
        if m == "owner":
            raise HTTPException(422, "대표는 제외할 수 없습니다")
        await _leave_team(conn, user.team_id, account_id)   # 담당 매물 대표 승계 + left_at
        await _return_home(conn, account_id)                # 본인 1인 팀으로 복귀
    return {"ok": True}


@router.post("/leave")
async def leave_team(resp: Response, user: CurrentUser = Depends(current_user)):
    if user.role == "owner":
        raise HTTPException(403, "대표는 팀을 탈퇴할 수 없습니다")
    async with tx() as conn:
        await _leave_team(conn, user.team_id, user.account_id)
        await _return_home(conn, user.account_id)
    acc = await pool().fetchrow("SELECT id, tier FROM app.accounts WHERE id=$1", user.account_id)
    return await _issue(resp, dict(acc))
