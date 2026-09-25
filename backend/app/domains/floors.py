"""층별 임대정보 — 넷을 서버가 층으로 묶어 **하나로** 준다(2026-09-17).

예전엔 화면이 대장 층별개요 · 업체 원장 · 카카오 · 팀 층별임대를 따로 받아 493줄짜리 컴포넌트 안에서
층 이름을 맞추고(「3F」=「3층」) 상호를 이름으로 붙이고 층 미상을 골라냈다. 모델은 넷을 따로 받아
자기 식으로 합치니 화면과 다른 답이 났다. 같은 합치기는 한 곳에만 있어야 한다 — 여기다.

  층 뼈대   = 건축물대장 층별개요(master.floor_outline)          … floor · floor_area · use
  호실      = 건축물대장 전유부(master.building_unit)             … 전용·공용면적. 집합 27%만
  업체      = 인허가 원장 + 상가정보(tenants.tenant_ledger)        … name · floor · area
  링크      = 카카오(places.places_for) — 저장 안 함, 이름으로 붙임 … url
  금액      = 팀 층별임대(app.floor_rents)                       … 상호 · 계약면적 · 보증금 · 임대료 · 관리비
  공실      = 팀 층별 공실면적(app.floor_vacancy, 0180)            … 층마다 ㎡ 하나. 줄 없음=모름 · 0=만실

**대장 호실은 참조다.** 등기 단위라 실제 칸막이와 다를 수 있고(두 호실을 터서 쓰면 대장은 둘),
업체를 호실에 이을 자료도 없다(인허가엔 호 칸이 없고 상가정보는 55.4만 줄 전부 비었다).
그래서 팀 줄과 맞추지 않고 층 옆에 나란히 둔다 — 맞추려 하면 그게 조용한 오답이 된다.

응답:
  floors  : [{floor, floor_area, uses[], rooms[], vacant_area, units:[팀 줄 + url], ledger:[원장 업체]}]  1층부터 위로 · 옥탑 · 지하
  unknown : 층을 모르는 원장 업체(팀 줄과 이름이 안 맞는 것)
  items   : 팀 줄 평평하게(합계·되돌리기가 읽는다)
  total   : {deposit, rent, maintenance, vacant_area}   공실면적은 층 값의 합 · 한 층도 안 적었으면 null
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends

from ..core.db import pool
from ..core.deps import CurrentUser, current_user
from ..core.floor_label import signed as _fl_signed
from .floor_rents import team_floor_rows
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
async def building_floors(building_pk: str, user: CurrentUser = Depends(current_user)):
    items, _hidden = await team_floor_rows(building_pk, user.team_id)
    # 용도를 같이 뽑는다. 버리고 있던 값이라 업체가 없는 층이 통째로 침묵했다(2026-09-25).
    outline = await pool().fetch(
        "SELECT floor, sum(floor_area)::float AS floor_area,"
        "       array_agg(DISTINCT use) FILTER (WHERE use IS NOT NULL) AS uses"
        "  FROM master.floor_outline WHERE building_pk=$1 AND floor IS NOT NULL GROUP BY floor",
        building_pk)
    ledger_units = await pool().fetch(_UNIT_SQL, building_pk)
    # 공실면적 — 층 이름이 아니라 core/floor_label.signed 로 잇는다(저장할 때와 같은 열쇠).
    # 여기 _sfloor 는 옥탑을 900+ 로 세고 저쪽은 1000+ 라, 옥탑 층을 이 값으로 찾으면 빗나간다.
    vacancy = {r["floor_no"]: float(r["vacant_area"]) for r in await pool().fetch(
        "SELECT floor_no, vacant_area FROM app.floor_vacancy WHERE building_pk=$1 AND team_id=$2",
        building_pk, user.team_id)}
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

    def ledger_hit(name: str | None) -> dict | None:
        if not name:
            return None
        k = norm_name(name)
        return next((t for t in ledger if _same(norm_name(t["name"]), k)), None)

    # 층 뼈대: 팀 줄 · 대장 · 원장이 아는 층의 합집합. 이름은 팀 줄 > 대장 > 원장 순으로 쓴다
    label: dict[int, str] = {}
    for src in (ledger, [dict(o) for o in outline], items):
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
        units = []
        for r in items:
            if _sfloor(r["floor"]) != sf:
                continue
            u = dict(r)
            lg = ledger_hit(r.get("tenant_name"))
            u["url"] = lg.get("url") if lg else None
            units.append(u)
        rest = [t for t in ledger if t.get("floor") and _sfloor(t["floor"]) == sf
                and not any(_same(norm_name(u.get("tenant_name")), norm_name(t["name"])) for u in units if u.get("tenant_name"))]
        floors.append({"floor": label[sf], "floor_area": area.get(sf) or None,
                       "uses": uses.get(sf) or [],           # 대장 층별개요 용도
                       "rooms": rooms.get(sf) or [],         # 대장 호실 — 참조. 팀 줄과 안 맞춘다
                       "vacant_area": vacancy.get(_fl_signed(label[sf])),   # 팀. None=모름 · 0=만실
                       "units": units, "ledger": rest})

    unknown = [t for t in ledger if not t.get("floor")
               and not any(_same(norm_name(r.get("tenant_name")), norm_name(t["name"])) for r in items if r.get("tenant_name"))]
    total = {
        "deposit": sum(r["deposit"] or 0 for r in items),
        "rent": sum(r["rent"] or 0 for r in items),
        "maintenance": sum(r["maintenance"] or 0 for r in items),
        # 층 값의 합. 한 층도 안 적었으면 None — 0 으로 메우면 「만실」로 읽힌다
        "vacant_area": sum(vacancy.values()) if vacancy else None,
    }
    return {"floors": floors, "unknown": unknown, "items": items, "total": total}


@router.get("/history", openapi_extra={"x-ai": "read"})
async def building_history(building_pk: str, user: CurrentUser = Depends(current_user)):
    """입주 이력 — 이 건물에 누가 언제 들어왔다 나갔나(LOCALDATA). 임대료는 없다."""
    return await tenancy_history(building_pk)
