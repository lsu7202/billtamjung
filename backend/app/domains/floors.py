"""층별 정보(건물 상세) — 대장과 업체 원장만 층으로 묶어 **하나로** 준다(2026-09-17 · 2026-09-26 나눔).

팀 값(호실·임대료·공실)은 여기 없다. 그건 매물의 임대 내역(floor_rents.py)에만 있다 — 누구나 보는
건물 상세와 우리 팀이 확인한 기록을 섞지 않는다. 모델도 같은 경계로 받는다(모르는 건물의 임대는 추정만).

  층 뼈대   = 건축물대장 층별개요(master.floor_outline)          … floor · floor_area · use
  전유부    = 건축물대장 전유부(master.building_unit)             … 전용·공용면적. 집합 27%만. 참조
  업체      = 인허가 원장 + 상가정보(tenants.tenant_ledger)        … name · floor · area
  링크      = 카카오(places.places_for) — 저장 안 함, 이름으로 붙임 … url

**대장 전유부는 참조다.** 등기 단위라 실제 칸막이와 다르고, 중개사가 말하는 호실은 업체 단위다.

응답:
  floors  : [{floor, floor_area, uses[], rooms[], ledger:[업체]}]  1층부터 위로 · 옥탑 · 지하
  unknown : 층을 모르는 업체
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends

from ..core.db import pool
from ..core.deps import CurrentUser, current_user
from .places import places_for
from .tenants import history_rows, norm_name, past_floors, tenancy_history, tenant_ledger

router = APIRouter(prefix="/buildings/{building_pk}/floors", tags=["floors"])


def _sfloor(fl: str | None) -> int | None:
    """같은 층인지 가르는 값. 옥탑은 900+, 지하는 음수. 화면(FloorRows.sfloor)과 같은 규칙."""
    if not fl:
        return None
    t = fl.strip()
    digits = re.sub(r"\D", "", t)
    n = int(digits) if digits else None
    if re.match(r"^(옥탑|옥상|PH|RF?)", t, re.I):
        return 900 + (n if n is not None else 1)
    if re.search(r"지하|^\s*B", t, re.I):
        return -1 if n is None else -n
    return n


def _frank(fl: str | None) -> int:
    """화면 순서 — 1층부터 위로, 옥탑, 맨 아래 지하."""
    t = (fl or "").strip()
    n = int(re.sub(r"[^0-9]", "", t) or 0)
    if re.match(r"^(옥탑|옥상|PH|RF?)", t, re.I):
        return 1000 + n
    if re.match(r"^(지하|지|B)", t, re.I):
        return 2000 + n
    return n


# 대장 호실(전유부) — 집합건물만 있다(서울 건물의 27%). **참조로만 쓴다.**
# 대장 호실은 등기 단위고 실제 칸막이와 다를 수 있어서, 팀이 적는 줄과 맞추지 않는다.
#
# 전유부는 건물이 아니라 **필지**에 붙는다(대장이 부모 PK 를 안 준다). 모르면 안 붙인다:
#   · 한 필지에 건물이 둘 이상 — 어느 건물 것인지 모른다. 호실 있는 필지 11.5만 중 9,219(8%)
#   · 건물은 하나인데 전유부에 동이 둘 이상 — 같은 층끼리 다른 동 호실이 합쳐진다. 266(0.25%)
# 0035 때 「층번호 결측·다중동 섞임」으로 폐기했던 자리다. 층은 0146 이 전유부(0309)에서 가져와
# 결측이 0이 됐고, 다중동은 여기 두 조건이 막는다(2026-09-25 실측).
_UNIT_SQL = """
SELECT u.floor AS sfloor, u.excl_area::float AS excl_area, u.common_area::float AS common_area
  FROM master.building_parcels bp
  JOIN master.building_unit u ON u.pnu = bp.pnu
 WHERE bp.building_pk = $1 AND u.excl_area IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM master.building_parcels b2
                    WHERE b2.pnu = bp.pnu AND b2.building_pk <> $1)
   AND (SELECT count(DISTINCT COALESCE(NULLIF(u2.dong, ''), '-'))
          FROM master.building_unit u2 WHERE u2.pnu = bp.pnu) = 1
 ORDER BY u.floor, u.ho
"""


def _same(a: str, b: str) -> bool:
    return a == b or (len(a) >= 3 and len(b) >= 3 and (a.startswith(b) or b.startswith(a)))


@router.get("", openapi_extra={"x-ai": "read"})   # AI 가 부를 수 있다 — 화면과 같은 답
async def building_floors(building_pk: str, _: CurrentUser = Depends(current_user)):
    # 용도를 같이 뽑는다. 버리고 있던 값이라 업체가 없는 층이 통째로 침묵했다(2026-09-25).
    outline = await pool().fetch(
        "SELECT floor, sum(floor_area)::float AS floor_area,"
        "       array_agg(DISTINCT use) FILTER (WHERE use IS NOT NULL) AS uses"
        "  FROM master.floor_outline WHERE building_pk=$1 AND floor IS NOT NULL GROUP BY floor",
        building_pk)
    ledger_units = await pool().fetch(_UNIT_SQL, building_pk)
    ledger = await tenant_ledger(building_pk)
    try:
        places = (await places_for(building_pk)).get("items", [])
    except Exception:   # noqa: BLE001 — 카카오가 없거나 막히면 전화·링크만 빠진다
        places = []

    # 카카오는 이름으로 붙여 **링크만** 가져온다. 업종·전화는 화면이 안 그린다(2026-09-19).
    # 못 붙은 것은 층 미상 업체로 더한다 — 소프트웨어 회사처럼 인허가가 없는 업종은
    # LOCALDATA 에 아예 없어서 카카오만 안다(실측 여섯 채에서 66곳). 저장하지 않는다(약관).
    for p in places:
        k = norm_name(p.get("name"))
        hit = next((t for t in ledger if _same(norm_name(t["name"]), k)), None)
        if hit:
            hit["url"] = hit.get("url") or p.get("url")
        else:
            ledger.append({"name": p.get("name"), "floor": None, "area": None, "url": p.get("url")})

    # 층을 모르는 업체에 **층을 빌려 준다**(2026-09-25 대표). 카카오에 있으면 지금 있는 업체이고,
    # 그 층은 인허가(폐업한 줄 포함)에서 가져와도 된다. 영업 중인 인허가·상가정보의 층은 이미
    # 원장 합치기에서 붙었으니, 여기서 느는 것은 **폐업 기록의 층**이다(스무 채 표본 786곳 중 6곳).
    # 크롤링으로 층별 목록이 바뀌면 이 길이 층을 채우는 뼈대가 된다.
    hist, appr = await history_rows(building_pk)
    borrow = past_floors(hist, appr)
    for t in ledger:
        if not t.get("floor"):
            k = norm_name(t["name"])
            t["floor"] = next((f for n, f in borrow.items() if _same(n, k)), None) if k else None

    # 층 뼈대: 대장 · 원장이 아는 층의 합집합. 이름은 대장 > 원장 순으로 쓴다
    label: dict[int, str] = {}
    for src in (ledger, [dict(o) for o in outline]):
        for r in src:
            sf = _sfloor(r.get("floor"))
            if sf is not None and r.get("floor"):
                label[sf] = r["floor"]
    area: dict[int, float] = {}
    uses: dict[int, list[str]] = {}
    for o in outline:
        sf = _sfloor(o["floor"])
        if sf is not None:
            area[sf] = area.get(sf, 0) + (o["floor_area"] or 0)
            for u in o["uses"] or []:
                if u not in uses.setdefault(sf, []):
                    uses[sf].append(u)
    rooms: dict[int, list[dict]] = {}
    for r in ledger_units:
        rooms.setdefault(r["sfloor"], []).append(
            {"excl_area": r["excl_area"], "common_area": r["common_area"]})
    # 대장 호실만 있는 층도 층 뼈대에 세운다 — 층별개요에 안 잡히는 층이 있을 수 있다
    for sf in rooms:
        if sf not in label:
            label[sf] = f"옥탑{sf - 900}층" if sf >= 900 else (f"지하{-sf}층" if sf < 0 else f"{sf}층")

    floors = []
    for sf in sorted(label, key=lambda k: _frank(label[k])):
        floors.append({"floor": label[sf], "floor_area": area.get(sf) or None,
                       "uses": uses.get(sf) or [],           # 대장 층별개요 용도
                       "rooms": rooms.get(sf) or [],         # 대장 전유부 — 참조
                       "ledger": [t for t in ledger if t.get("floor") and _sfloor(t["floor"]) == sf]})
    unknown = [t for t in ledger if not t.get("floor")]
    return {"floors": floors, "unknown": unknown}


@router.get("/history", openapi_extra={"x-ai": "read"})
async def building_history(building_pk: str, user: CurrentUser = Depends(current_user)):
    """입주 이력 — 이 건물에 누가 언제 들어왔다 나갔나(LOCALDATA). 임대료는 없다."""
    return await tenancy_history(building_pk)
