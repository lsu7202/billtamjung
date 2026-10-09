"""부가 도메인: enum 사전 · 저장검색. 위키 · 업종 목록 · 필드 사전 라우트는 2026-10-07 에 뺐다(부르는 곳 없음)."""
import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from ..core.db import pool
from ..core.deps import any_user, CurrentUser, viewer

router = APIRouter(tags=["extras"])


# 프로세스 전역 캐시였다가 TTL로 바꿨다(2026-08-10) — 영원 캐시는 마이그레이션으로 enum을
# 추가할 때마다 서버 재시작 전까지 옛 목록을 준다(0049 buyer_age가 이렇게 안 보였다).
# ref.enums는 수백 행이라 1분 캐시면 충분히 싸다.
_enum_cache: tuple[float, dict] | None = None
_ENUM_TTL = 60.0


@router.get("/enums", openapi_extra={"x-ai": "read"})   # AI 가 부를 수 있다(10-AI §3-3)
async def enums(_: CurrentUser = Depends(viewer)):
    """전 enum 그룹 {enum_key: [{code,label,tier}]} — 드롭다운·코드↔라벨 매핑(레지스트리)."""
    import time
    global _enum_cache
    now = time.monotonic()
    if _enum_cache is None or now - _enum_cache[0] > _ENUM_TTL:
        rows = await pool().fetch(
            "SELECT enum_key, code, label, tier FROM ref.enums WHERE active ORDER BY enum_key, sort_order"
        )
        out: dict[str, list] = {}
        for r in rows:
            out.setdefault(r["enum_key"], []).append(
                {"code": r["code"], "label": r["label"], "tier": r["tier"]}
            )
        _enum_cache = (now, out)
    return _enum_cache[1]


# ── 저장한 검색조건(폴리곤 포함) ─────────────────────
class SavedSearchIn(BaseModel):
    name: str
    conditions: dict      # 화면 값 + request(= /search/pins 몸통). 조건 알림은 09-30 폐지(0203)
    buyer_id: int | None = None   # 붙일 고객(S09 · 0214). 비우면 내 조건


# 저장한 조건 = 내 조건(고객 없음) + 우리 팀 고객에 붙은 조건(팀 전체가 본다, 0214)
_MINE_OR_TEAM = "((s.account_id=$1 AND s.buyer_id IS NULL) OR (s.buyer_id IS NOT NULL AND s.team_id=$2))"


@router.post("/saved-searches")
async def save_search(body: SavedSearchIn, user: CurrentUser = Depends(any_user)):
    if not body.name.strip() or not body.conditions:
        raise HTTPException(422, "이름과 조건이 필요합니다")
    if body.buyer_id is not None and (user.team_id is None or not await pool().fetchval(
            "SELECT 1 FROM app.buyers WHERE id=$1 AND team_id=$2 AND deleted_at IS NULL", body.buyer_id, user.team_id)):
        raise HTTPException(404, "고객을 찾을 수 없습니다")
    sid = await pool().fetchval(
        """INSERT INTO app.saved_searches(account_id,name,conditions_json,team_id,buyer_id)
           VALUES($1,$2,$3,$4,$5) RETURNING id""",
        user.account_id, body.name.strip(), json.dumps(body.conditions),
        user.team_id if body.buyer_id is not None else None, body.buyer_id,
    )
    return {"id": sid}


@router.get("/saved-searches")
async def list_searches(user: CurrentUser = Depends(any_user)):
    """내 조건 + 우리 팀 고객에 붙은 조건 — 고객 이름이 같이 선다(「김사장 · 강남 꼬마빌딩」)"""
    rows = await pool().fetch(
        f"""SELECT s.id, s.name, s.conditions_json, s.created_at, s.buyer_id, b.name AS buyer_name
              FROM app.saved_searches s LEFT JOIN app.buyers b ON b.id = s.buyer_id AND b.deleted_at IS NULL
             WHERE {_MINE_OR_TEAM} AND s.closed_at IS NULL
               AND (s.buyer_id IS NULL OR b.id IS NOT NULL)
             ORDER BY (s.buyer_id IS NULL) DESC, s.created_at DESC""",
        user.account_id, user.team_id,
    )
    return [
        {**dict(r), "conditions_json": json.loads(r["conditions_json"])} for r in rows
    ]


class SavedSearchPatch(BaseModel):
    """부분 수정 — 이름만 바꾸거나(rename) 조건만 덮어쓴다(현재 조건으로 갱신)."""
    name: str | None = None
    conditions: dict | None = None


@router.patch("/saved-searches/{sid}")
async def update_search(sid: int, body: SavedSearchPatch, user: CurrentUser = Depends(any_user)):
    if body.name is None and body.conditions is None:
        raise HTTPException(422, "바꿀 항목이 없습니다")
    if body.name is not None and not body.name.strip():
        raise HTTPException(422, "이름은 비울 수 없습니다")
    # COALESCE로 넘어온 것만 갱신 — 이름만 바꿀 때 조건이 날아가면 안 된다
    n = await pool().execute(
        f"""UPDATE app.saved_searches s
              SET name = COALESCE($4, name),
                  conditions_json = COALESCE($5, conditions_json)
            WHERE s.id=$3 AND {_MINE_OR_TEAM}""",
        user.account_id, user.team_id, sid,
        body.name.strip() if body.name is not None else None,
        json.dumps(body.conditions) if body.conditions is not None else None,
    )
    if n.endswith(" 0"):
        raise HTTPException(404, "저장된 조건을 찾을 수 없습니다")
    return {"ok": True}


@router.delete("/saved-searches/{sid}")
async def delete_search(sid: int, user: CurrentUser = Depends(any_user)):
    await pool().execute(
        f"DELETE FROM app.saved_searches s WHERE s.id=$3 AND {_MINE_OR_TEAM}", user.account_id, user.team_id, sid
    )
    return {"ok": True}
