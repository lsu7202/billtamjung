"""estimate — 우리가 계산한 추정을 **이름과 오차를 붙여** 낸다. 정본 10-AI §16

## 왜 따로 있나

적정가·임대추정은 사실이 아니라 **우리가 가중치를 고른 주장**이다. 그래서 화면용 API 를 지나는
길에서는 전부 걷어낸다(`_CLAIM_KEYS`). 걷어내기만 하면 「임대료 얼마 나올까」에 답할 수 없으니,
**물었을 때만 열리는 문**을 하나 둔다. 여기로 나온 값은 늘 이름·규칙·오차를 달고 나간다.

대장 층별개요를 그대로 주던 시절엔 모델이 그 표에 추정임대료를 섞어 사실처럼 그렸다
(2026-09-09 대표). 값이 어디서 왔는지가 값 옆에 붙어 있어야 그 일이 안 생긴다.
"""
from __future__ import annotations

import httpx

from ..floors import order, sfloor
from ..shape import won
from . import Ctx, tool

# 백테스트 중앙오차(MdAPE). 산식을 고치면 이 수도 같이 고친다 — 화면 배지와 같은 근거다
RENT_MDAPE = 29


def band(v: float | None, fmt) -> str | None:
    """**점이 아니라 구간을 낸다**(§16-3). 오차가 29%인데 점을 주면 그 안에서 결론이 난다 —
    「1,648만인데 옆 건물이 1,400만이니 비싸다」. 구간을 주면 그 결론이 안 나온다."""
    if not v:
        return None
    lo, hi = v * (1 - RENT_MDAPE / 100), v * (1 + RENT_MDAPE / 100)
    return f"{fmt(lo)} ~ {fmt(hi)}"


def _man(v: float) -> str:
    return f"{round(v / 10000):,}만"


@tool("estimate",
      "빌탐정이 계산한 추정을 낸다. 사용자가 「임대료 얼마 나올까」처럼 값을 물을 때 쓴다. "
      "값은 구간으로 오고 confidence 는 추정이다.",
      {"type": "object",
       "properties": {"building_pk": {"type": "string"},
                      "kind": {"type": "string", "enum": ["임대"], "description": "지금은 임대만"}},
       "required": ["building_pk"]})
async def estimate(ctx: Ctx, *, building_pk: str, kind: str = "임대") -> dict:
    from ...main import app
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://ai", timeout=30.0) as c:
        r = await c.get(f"/buildings/{building_pk}/floor-outline",
                        headers={"Authorization": f"Bearer {ctx.token}"})
    if r.status_code >= 400:
        return {"error": f"{r.status_code} · 추정을 읽지 못했다"}
    try:
        fl = r.json() or []
    except ValueError:
        return {"error": "JSON 이 아니다"}

    rows, rent_sum, dep_sum = [], 0, 0
    for o in sorted(fl, key=lambda x: order(sfloor(x.get("floor")))):
        m, dep = o.get("rent_est"), o.get("deposit_est")
        if not m:
            continue
        rent_sum += m
        dep_sum += dep or 0
        rows.append({"층": o.get("floor"), "추정 월세": band(m, _man),
                     "추정 보증금": band(dep, lambda x: won(x) or "")})
    if not rows:
        return {"kind": "estimate", "data": {"결과": "이 건물은 추정 대상이 아니다"},
                "grade": "추정", "source": "빌탐정 임대추정 v4"}

    data = {"층별": rows, "건물 합 월세": band(rent_sum, _man),
            "건물 합 보증금": band(dep_sum, lambda x: won(x) or ""),
            "말하는 법": "「빌탐정 임대추정」 이름을 붙이고 구간으로 말한다. "
                     "이 값으로 싸다·비싸다를 판정하는 자리는 사람이다"}
    sid = ctx.remember("estimate", {
        "raw": data, "grade": "추정", "source": "빌탐정 임대추정 v4",
        "note": f"공시지가·면적·층·상권으로 계산. 중앙오차 약 {RENT_MDAPE}%",
        "grids": {"table": {"head": ["층", "추정 월세", "추정 보증금"],
                            "rows": [[r.get(h) for h in ("층", "추정 월세", "추정 보증금")] for r in rows]}},
        "path": f"/buildings/{building_pk} 임대추정"})
    return {"id": sid, "grade": "추정", "source": "빌탐정 임대추정 v4",
            "note": f"중앙오차 약 {RENT_MDAPE}%. 실제 계약과 다를 수 있다",
            "data": data, "show": f'ui(name="table", props={{"source": "{sid}"}})'}
