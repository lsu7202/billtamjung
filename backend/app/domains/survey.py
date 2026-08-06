"""베타 설문 — 익명 제출 허용(로그인 없이도 응답 가능). 결과 조회는 관리자만.

공개 페이지 /survey 에서 POST /survey 로 제출. 어뷰징은 per-IP 레이트리밋(core.ratelimit)에 의존.
"""
import json
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from ..core.db import pool
from ..core.deps import current_user, CurrentUser
from ..core import security

router = APIRouter(prefix="/survey", tags=["survey"])


class SurveyIn(BaseModel):
    survey_key: str = "beta-2026-08"
    answers: dict                       # {문항키: 값} — 프론트 폼 구조 그대로
    contact: str | None = None


@router.post("", status_code=201)
async def submit(body: SurveyIn, request: Request):
    """설문 제출 — 인증 불필요. Authorization 헤더가 있으면 계정을 연결한다."""
    if not body.answers:
        raise HTTPException(422, "응답이 비어 있습니다")
    account_id = None
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        try:
            account_id = int(security.decode(auth[7:])["sub"])
        except Exception:
            account_id = None          # 만료·위조 토큰이어도 응답 자체는 받는다
    rid = await pool().fetchval(
        """INSERT INTO app.survey_responses(account_id, survey_key, answers, contact, user_agent)
           VALUES($1, $2, $3::jsonb, $4, $5) RETURNING id""",
        account_id, body.survey_key, json.dumps(body.answers, ensure_ascii=False),
        (body.contact or "").strip() or None,
        (request.headers.get("user-agent") or "")[:300],
    )
    return {"id": rid, "ok": True}


@router.get("/responses")
async def responses(user: CurrentUser = Depends(current_user), survey_key: str = "beta-2026-08"):
    """응답 목록 — 관리자 전용."""
    is_admin = await pool().fetchval("SELECT is_admin FROM app.accounts WHERE id=$1", user.account_id)
    if not is_admin:
        raise HTTPException(403, "권한이 없습니다")
    rows = await pool().fetch(
        """SELECT r.id, r.account_id, a.email, r.answers, r.contact, r.created_at
           FROM app.survey_responses r LEFT JOIN app.accounts a ON a.id = r.account_id
           WHERE r.survey_key = $1 ORDER BY r.created_at DESC""", survey_key)
    return [dict(r) for r in rows]
