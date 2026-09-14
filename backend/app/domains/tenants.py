"""층별 임대정보에 붙는 **업체 원장** — LOCALDATA 인허가 + 소상공인 상가정보(2026-09-06, 항목 L).

## 왜
팀이 상호명을 손으로 치기 전에도 「이 건물 3층에 무엇이 있나」는 원장이 이미 안다.
LOCALDATA 는 상호명·**면적·전화**를 주고(층 80% · 개업일은 안 보인다 — 2026-09-06 대표 「의미 없음」), 소상공인은 인허가 대상이 아닌
업종(컨설팅·디자인)을 층까지 준다(층 68%). 둘을 이름으로 합쳐 층별 임대정보에 세운다.

## 어떻게 붙이나
- LOCALDATA 는 pnu 가 없다 → **좌표가 이 건물 필지 안**에 드는 것(98.6% 가 좌표 있음)
- 소상공인은 건물관리번호 앞 19자리 = **pnu** 로
- 같은 상호가 두 원장에 있거나 한 원장에 여러 줄(인허가 종류마다 한 줄)이면 **이름으로 접는다** —
  「(주)」·괄호·띄어쓰기·끝의 「점」을 지우고 견준다

## 카카오는 여기 없다
카카오 로컬은 약관이 저장을 막는다. 화면이 열릴 때 따로 받아(`/places`) **화면에서** 이름으로 붙인다.
층을 모르는 업체는 버리지 않는다 — 목록 맨 아래 「층 미상」으로 모인다(화면 몫).
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends

from ..core.db import pool
from ..core.deps import CurrentUser, current_user

router = APIRouter(prefix="/buildings/{building_pk}/tenants", tags=["tenants"])

_STRIP = re.compile(r"\([^)]*\)|㈜|\(주\)|주식회사|유한회사|\s+")


def norm_name(s: str | None) -> str:
    """이름 견줌용. 「(주)더원」·「더원 삼성점」·「더원」이 하나다."""
    t = _STRIP.sub("", s or "").lower()
    return re.sub(r"점$", "", t) if len(t) > 2 else t


def _phone(p: str | None) -> str | None:
    """LOCALDATA 전화는 「34540022」·「025418815」·「07074252189」 꼴이 섞여 있다. 자리 수로 줄을 긋는다."""
    d = re.sub(r"\D", "", p or "")
    if len(d) == 8:                       # 서울 국번만 — 02 가 빠진 것
        return f"02-{d[:4]}-{d[4:]}"
    if d.startswith("02") and len(d) in (9, 10):
        return f"02-{d[2:-4]}-{d[-4:]}"
    if len(d) in (10, 11) and d[:2] in ("01", "07", "05", "03", "04", "06"):
        return f"{d[:3]}-{d[3:-4]}-{d[-4:]}"
    return None if len(d) < 8 else d


def _floor(n: int | None, base: bool) -> str | None:
    if n is None:
        return None
    return f"지하{n}층" if base else f"{n}층"


@router.get("", openapi_extra={"x-ai": "read"})   # AI 가 부를 수 있다(10-AI §3-3)
async def building_tenants(building_pk: str, _: CurrentUser = Depends(current_user)):
    rows = await pool().fetch(
        """WITH pc AS (SELECT p.pnu, p.geom FROM master.building_parcels bp
                        JOIN master.parcels p ON p.pnu = bp.pnu
                       WHERE bp.building_pk = $1)
           SELECT 'localdata' AS src, l.name, l.floor_no, l.is_base, l.area::float AS area,
                  l.open_on, NULLIF(NULLIF(btrim(l.biz1), ''), '-') AS biz, l.phone
             FROM master.localdata_permit l, pc
            WHERE l.state = '영업' AND l.geom && pc.geom AND ST_Contains(pc.geom, l.geom)
           UNION ALL
           SELECT 'sbiz', s.name, s.floor_no, s.is_base, NULL, NULL, COALESCE(c.cat, s.cat2), NULL
             FROM master.sbiz_store s JOIN pc ON pc.pnu = s.pnu
             LEFT JOIN ref.biz_category c ON c.source = 'sbiz' AND c.key = s.cat2""",
        building_pk)

    merged: dict[str, dict] = {}
    for r in rows:
        k = norm_name(r["name"])
        if not k:
            continue
        m = merged.get(k)
        if m is None:
            m = merged[k] = {"name": r["name"], "floor": None, "area": None, "open_on": None,
                             "biz": None, "phone": None, "src": set()}
        m["src"].add(r["src"])
        # 이름은 원장 표기 중 짧은 것(「(주)」가 붙은 쪽보다 간판에 가깝다)
        if r["name"] and len(r["name"]) < len(m["name"]):
            m["name"] = r["name"]
        if m["floor"] is None and r["floor_no"] is not None:
            m["floor"] = _floor(r["floor_no"], r["is_base"])
        if r["area"] and (m["area"] is None or r["area"] > m["area"]):
            m["area"] = r["area"]
        if r["open_on"] and (m["open_on"] is None or r["open_on"] > m["open_on"]):
            m["open_on"] = r["open_on"]
        # 업종은 소상공인의 일곱 갈래가 먼저(짧고 한 벌), 없으면 LOCALDATA 업태 그대로
        if r["src"] == "sbiz" and r["biz"]:
            m["biz"] = r["biz"]
        elif m["biz"] is None and r["biz"]:
            m["biz"] = r["biz"]
        if m["phone"] is None:
            m["phone"] = _phone(r["phone"])

    # 접두로 한 번 더 접는다 — 「더라운드 삼성점」(LOCALDATA) 과 「더라운드」(소상공인) 는
    #   같은 가게다. 짧은 이름이 세 글자 이상이고 긴 이름의 머리일 때만. 층은 짧은 쪽에 없으면 긴 쪽 것을 쓴다
    keys = sorted(merged, key=len)
    for k in sorted(merged, key=len, reverse=True):
        base = next((b for b in keys if b != k and len(b) >= 3 and k.startswith(b)), None)
        if base is None or base not in merged or k not in merged:
            continue
        a, b = merged[base], merged.pop(k)
        for f in ("floor", "area", "open_on", "biz", "phone"):
            if a[f] is None:
                a[f] = b[f]
        a["src"] |= b["src"]

    items = [{
        "name": m["name"], "floor": m["floor"], "area": m["area"],
        "biz": m["biz"], "phone": m["phone"],
    } for m in merged.values()]
    # 층 있는 것부터, 층 안에서는 이름순. 층 미상은 뒤로
    items.sort(key=lambda x: (x["floor"] is None, x["floor"] or "", x["name"]))
    return {"items": items, "raw": len(rows)}
