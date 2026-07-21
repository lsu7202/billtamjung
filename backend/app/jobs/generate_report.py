"""보고서 비동기 생성 잡(스텁). Cloud Tasks → POST /jobs/generate-report. specs R.

실제: master+overlay+S03 curation 조립 → 가치점수(F-16)·적정매매가(F-17) 산출
→ python-pptx로 PPT 생성 → GCS 업로드 → 성공 트랜잭션 안에서 크레딧 차감.
"""
from fastapi import APIRouter
from pydantic import BaseModel
from ..core.db import tx
from ..core.config import settings

router = APIRouter(prefix="/jobs", tags=["worker"])


class GenerateIn(BaseModel):
    report_id: int


@router.post("/generate-report")
async def generate_report(body: GenerateIn):
    async with tx() as conn:
        rep = await conn.fetchrow(
            "SELECT id, account_id, kind FROM app.reports WHERE id=$1", body.report_id
        )
        if not rep:
            return {"ok": False, "reason": "report not found"}
        await conn.execute(
            "UPDATE app.reports SET status='generating' WHERE id=$1", body.report_id
        )
        # TODO: 데이터 조립 → 가치점수/적정매매가 → python-pptx → GCS 업로드
        cost = settings.cost_analysis if rep["kind"] == "analysis" else settings.cost_briefing
        # 성공 시점 차감(트랜잭션 안 · 소멸 임박 버킷부터)
        await conn.execute("SELECT app.deduct_credit($1, $2, $3)", rep["account_id"], cost, rep["id"])
        await conn.execute(
            """UPDATE app.reports
               SET status='done', completed_at=now(), credits_spent=$2,
                   master_version=(SELECT version FROM master.master_version),
                   source_watermark=now()
               WHERE id=$1""",
            body.report_id, cost,
        )
    return {"ok": True, "report_id": body.report_id, "credits_spent": cost}
