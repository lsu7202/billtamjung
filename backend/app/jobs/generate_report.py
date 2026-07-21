"""보고서 비동기 생성 잡. specs R · 01-상세설계 §3.2.

플로우: 데이터 조립(master+overlay+층별임대) → 가치점수(F-16, 레지스트리 파라미터)
→ python-pptx 생성 → 저장(베타 로컬 / 프로덕션 GCS) → 성공 트랜잭션 안에서 크레딧 차감.
실패 → status=failed + 사유, 크레딧 미차감.

엔트리 2개: run_generate(로컬 BackgroundTasks) · POST /jobs/generate-report(Cloud Tasks).
"""
import json
import os
import datetime as dt
from fastapi import APIRouter
from pydantic import BaseModel
from ..core.db import tx, pool
from ..core.config import settings
from . import value_score

router = APIRouter(prefix="/jobs", tags=["worker"])

REPORT_DIR = os.environ.get("BT_REPORT_DIR", "/tmp/bt-reports")


async def _load_formula_params() -> tuple[int, dict[str, float]]:
    rows = await pool().fetch(
        """SELECT p.set_version, p.formula_id, p.param_key, p.value_num
           FROM ref.formula_params p
           JOIN ref.formula_sets s ON s.set_version = p.set_version AND s.active
           WHERE p.value_num IS NOT NULL"""
    )
    params = {r["param_key"]: float(r["value_num"]) for r in rows}
    version = rows[0]["set_version"] if rows else 1
    return version, params


async def _assemble(building_pk: str, team_id: int) -> dict:
    """master + 팀 오버레이 병합 + 층별임대 합계."""
    merged = await pool().fetchval("SELECT app.building_view($1,$2)", building_pk, team_id)
    b = json.loads(merged) if isinstance(merged, str) else (merged or {})
    rents = await pool().fetch(
        """SELECT deposit, rent, maintenance, is_vacant FROM app.floor_rents
           WHERE building_pk=$1 AND team_id=$2 AND deleted_at IS NULL""",
        building_pk, team_id,
    )
    b["total_deposit"] = sum(r["deposit"] or 0 for r in rents)
    b["total_rent"] = sum(r["rent"] or 0 for r in rents)
    b["vacant_count"] = sum(1 for r in rents if r["is_vacant"])
    # 가치점수 입력(있는 것만 — 결측=0점)
    b["use_zone"] = b.get("use_zone") or b.get("uqa")
    if b.get("approval_ymd"):
        try:
            y = dt.date.fromisoformat(str(b["approval_ymd"])[:10])
            b["age_years"] = (dt.date.today() - y).days / 365.25
        except ValueError:
            pass
    return b


def _make_pptx(path: str, kind: str, b: dict, vs: dict | None) -> int:
    """python-pptx로 보고서 생성. 반환=슬라이드 수. R_example 서식은 정식 단계에서 이식."""
    from pptx import Presentation
    from pptx.util import Inches, Pt

    prs = Presentation()
    blank = prs.slide_layouts[6]

    def slide(title: str, lines: list[str]):
        s = prs.slides.add_slide(blank)
        tb = s.shapes.add_textbox(Inches(0.6), Inches(0.4), Inches(9), Inches(1))
        tb.text_frame.text = title
        tb.text_frame.paragraphs[0].runs[0].font.size = Pt(28)
        body = s.shapes.add_textbox(Inches(0.6), Inches(1.6), Inches(9), Inches(5))
        tf = body.text_frame
        for i, ln in enumerate(lines):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            p.text = ln
            p.font.size = Pt(14)

    addr = b.get("addr", "")
    if kind == "briefing":  # 7슬라이드(R §4)
        slide("빌탐정 브리핑 자료", [addr])
        slide("매물 기본정보", [
            f"대지면적 {b.get('land_area','—')}㎡ · 연면적 {b.get('total_area','—')}㎡",
            f"층수 지상{b.get('floors_above','—')}/지하{b.get('floors_below','—')} · 용적률 {b.get('far','—')}%",
        ])
        slide("위치 · 지도", ["(Static Map — 프로덕션 연동)"])
        slide("로드뷰 / 사진", ["(Panorama — 프로덕션 연동)"])
        slide("임대 내역", [
            f"총보증금 {b['total_deposit']:,}원 · 총임대료 {b['total_rent']:,}원 · 공실 {b['vacant_count']}건",
        ])
        slide("추가 사진", ["—"])
        slide("마무리", ["빌탐정 BILLTAMJUNG"])
    else:  # analysis 8슬라이드(R §5)
        assert vs is not None
        slide("매물분석보고서", [addr, f"가치점수 {vs['score']} · {vs['grade']}등급"])
        slide("매물 기본정보", [
            f"대지 {b.get('land_area','—')}㎡ · 연면적 {b.get('total_area','—')}㎡ · 용적률 {b.get('far','—')}%",
        ])
        slide("분석 흐름", ["STEP1 가치점수 → STEP2 매매사례 → STEP3 주변임대 → STEP4 수익률"])
        slide("STEP1 가치점수", [
            f"총점 {vs['score']} / 100 · {vs['grade']}등급",
            *[f"{k}: {v}" for k, v in vs["items"].items()],
        ])
        slide("STEP2 매매사례 시세분석", ["(comps 연동 — S03 curation)"])
        slide("STEP3 주변임대시세", [f"총임대료 {b['total_rent']:,}원"])
        slide("STEP4 적정매매가·예상수익률", ["(F-17 — comps 축적 후)"])
        slide("최종 요약", ["빌탐정 BILLTAMJUNG"])

    prs.save(path)
    return len(prs.slides.__iter__.__self__._sldIdLst)  # noqa: SLF001


async def run_generate(report_id: int, team_id: int) -> dict:
    """잡 본체. 성공=크레딧 차감+완료 / 실패=failed+미차감."""
    os.makedirs(REPORT_DIR, exist_ok=True)
    try:
        async with tx() as conn:
            rep = await conn.fetchrow("SELECT * FROM app.reports WHERE id=$1", report_id)
            if not rep:
                return {"ok": False, "reason": "not found"}
            await conn.execute("UPDATE app.reports SET status='generating' WHERE id=$1", report_id)

        fs_version, params = await _load_formula_params()
        b = await _assemble(rep["building_pk"], team_id)
        vs = value_score.compute(b, params) if rep["kind"] == "analysis" else None

        path = os.path.join(REPORT_DIR, f"report_{report_id}.pptx")
        _make_pptx(path, rep["kind"], b, vs)

        cost = settings.cost_analysis if rep["kind"] == "analysis" else settings.cost_briefing
        async with tx() as conn:  # 성공 트랜잭션: 차감+완료+워터마크 원자
            await conn.execute("SELECT app.deduct_credit($1,$2,$3)", rep["account_id"], cost, report_id)
            await conn.execute(
                """UPDATE app.reports SET status='done', completed_at=now(),
                     credits_spent=$2, file_path=$3, formula_set_version=$4,
                     master_version=(SELECT version FROM master.master_version),
                     source_watermark=COALESCE(app.building_watermark($5,$6), now())
                   WHERE id=$1""",
                report_id, cost, path, fs_version, rep["building_pk"], team_id,
            )
        return {"ok": True, "file": path, "credits": cost}
    except Exception as e:  # 실패: 미차감
        async with tx() as conn:
            await conn.execute(
                "UPDATE app.reports SET status='failed', failed_reason=$2 WHERE id=$1",
                report_id, str(e)[:500],
            )
        return {"ok": False, "reason": str(e)}


class GenerateIn(BaseModel):
    report_id: int
    team_id: int


@router.post("/generate-report")
async def generate_report(body: GenerateIn):
    """Cloud Tasks 진입점(프로덕션)."""
    return await run_generate(body.report_id, body.team_id)
