"""베타 설문 — 익명 제출 허용(로그인 없이도 응답 가능). 결과 조회는 관리자만.

공개 페이지 /survey 에서 POST /survey 로 제출. 어뷰징은 per-IP 레이트리밋(core.ratelimit)에 의존.
"""
import csv
import io
import json
from fastapi import APIRouter, Depends, HTTPException, Request, Response
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


@router.get("/responses.csv")
async def responses_csv(user: CurrentUser = Depends(current_user), survey_key: str = "beta1-close"):
    """응답 CSV — 관리자 전용. 표로 열어야 세고 비교할 수 있다(설문은 세는 게 전부다).

    문항 키를 열로 편다. 복수선택은 「보기1 | 보기2」로 한 칸에 담는다 — 보기마다 열을 쪼개면
    사람이 못 읽고, 세는 건 어차피 스프레드시트가 한다.
    """
    is_admin = await pool().fetchval("SELECT is_admin FROM app.accounts WHERE id=$1", user.account_id)
    if not is_admin:
        raise HTTPException(403, "권한이 없습니다")
    rows = await pool().fetch(
        """SELECT r.id, a.email, r.answers, r.contact, r.created_at
             FROM app.survey_responses r LEFT JOIN app.accounts a ON a.id = r.account_id
            WHERE r.survey_key = $1 ORDER BY r.created_at""", survey_key)

    parsed = [(r, json.loads(r["answers"]) if isinstance(r["answers"], str) else (r["answers"] or {}))
              for r in rows]
    keys: list[str] = []
    for _r, ans in parsed:
        for k in ans:
            if k not in keys:
                keys.append(k)

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "제출시각", "계정", "연락처", *keys])
    for r, ans in parsed:
        def cell(k):
            v = ans.get(k)
            if isinstance(v, list):
                return " | ".join(str(x) for x in v)
            return "" if v is None else str(v)
        w.writerow([r["id"], r["created_at"].strftime("%Y-%m-%d %H:%M"), r["email"] or "익명",
                    r["contact"] or "", *[cell(k) for k in keys]])
    # 엑셀이 UTF-8을 알아보게 BOM을 붙인다 — 안 붙이면 한글이 깨져서 온다
    return Response("\ufeff" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{survey_key}.csv"'})


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
