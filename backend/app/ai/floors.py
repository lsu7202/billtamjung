"""층별임대정보 — 화면과 같은 조립. 정본 10-AI §12-4

## 왜 서버가 조립하나

대장 층별개요(`/floor-outline`)를 그대로 주면 모델은 그것을 「층별 임대」라고 그린다. 실제로
대장 용도에 **우리 임대추정을 붙인 표**가 사용자에게 갔다(2026-09-09 대표 지적). 대장에는 금액이
없으니 모델이 채울 수 있는 금액은 우리 추정뿐이었고, 그게 사실인 척 표 안에 앉았다.

건물 상세의 층별임대정보(`FloorRows.tsx`)는 세 자료를 이 차례로 겹친 것이다. 같은 규칙을 여기 옮긴다:

    ① 팀이 적은 줄이 있는 층   그 층은 팀 것이 전부다 — 층 단위 인수(0029)
    ② 팀 줄이 없는 층          업체 원장이 아는 업체마다 한 줄(상호·업종·면적)
    ③ 업체도 모르는 층          층만 세운다. 면적·용도는 그 줄에 안 넣는다

**용도는 업체 업종이다.** 대장 용도 칸은 화면에서 뺐다(2026-09-09 대표). 층 총면적은 대장이 알지만
호실 줄이 아니라 층에 붙는다 — 그 호실이 층 전부인지 모르는 채 면적을 넣으면 지어낸 값이 된다.
"""
from __future__ import annotations

import re
from typing import Any

import httpx


def sfloor(fl: str | None) -> int | None:
    """층 이름 하나를 견줄 수 있는 수로. `FloorRows.tsx` 의 sfloor 와 같은 규칙."""
    if not fl:
        return None
    s = fl.strip()
    d = re.sub(r"\D", "", s)
    n = int(d) if d else None
    if re.match(r"^(옥탑|옥상|PH|RF?)", s, re.I):
        return 900 + (n if n is not None else 1)
    if "지하" in s or re.match(r"^\s*B", s, re.I):
        return -(n if n is not None else 1)
    return n


def order(sf: int | None) -> tuple[int, int]:
    """화면 차례 — 1층부터 위로, 그다음 옥탑, 맨 아래 지하(2026-09-04)."""
    if sf is None:
        return (3, 0)
    if sf >= 900:
        return (1, sf)
    if sf > 0:
        return (0, sf)
    return (2, -sf)


def nname(s: str | None) -> str:
    """상호 견주기 — 띄어쓰기·괄호를 지운다."""
    return re.sub(r"[\s()（）·.,\-]", "", (s or "")).lower()


async def compose(token: str, pk: str, rents: dict) -> dict:
    """팀 줄 + 업체 원장 + 대장 층 = 화면이 그리는 그 목록.

    부르는 쪽이 이미 `/floor-rents` 를 받았으므로 나머지 둘만 더 읽는다(같은 프로세스 안이라 싸다).
    """
    from ..main import app

    async def get(path: str) -> Any:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                     base_url="http://ai", timeout=30.0) as c:
            r = await c.get(path, headers={"Authorization": f"Bearer {token}"})
        if r.status_code >= 400:
            return None
        try:
            return r.json()
        except ValueError:
            return None

    outline = await get(f"/buildings/{pk}/floor-outline") or []
    ten = ((await get(f"/buildings/{pk}/tenants")) or {}).get("items") or []
    items = rents.get("items") or []

    # **없는 건물과 빈 건물을 가른다.** 이 세 길은 모르는 pk 에도 200 과 빈 목록을 준다.
    # 모델이 pk 를 지어내면(2026-09-09 하이쿠, 대화 #124) 그게 「아직 안 적은 건물」로 보였고,
    # 모델은 층 넷에 업체가 있는 건물을 두고 「임대 정보가 없습니다」라고 자신 있게 답했다.
    if not (items or outline or ten) and await get(f"/buildings/{pk}") is None:
        return {"_error": f"{pk} 는 없는 건물이다. /search/suggest 로 pk 를 먼저 확정한다"}

    team_floors = {sfloor(i.get("floor")) for i in items if i.get("floor")}
    biz = {nname(t.get("name")): t.get("biz") for t in ten if t.get("name")}

    rows: list[dict] = []
    for i in items:                                   # ① 팀이 적은 줄
        rows.append({"_sf": sfloor(i.get("floor")), "층": i.get("floor"),
                     "호": i.get("unit_no") or None, "상호": i.get("tenant_name"),
                     "업종": biz.get(nname(i.get("tenant_name"))),
                     "면적": i.get("contract_area"),
                     "보증금": i.get("deposit") or None, "월세": i.get("rent") or None,
                     "관리비": i.get("maintenance") or None,
                     "공실": bool(i.get("is_vacant")) or None, "적은이": "팀"})

    # 팀 줄이 없는 층 — 대장이 아는 층과 원장만 아는 층을 모은다
    rest: dict[int | None, str] = {}
    for o in outline:
        sf = sfloor(o.get("floor"))
        if o.get("floor") and sf not in team_floors:
            rest.setdefault(sf, o.get("floor"))
    for t in ten:
        sf = sfloor(t.get("floor"))
        if t.get("floor") and sf is not None and sf not in team_floors:
            rest.setdefault(sf, t.get("floor"))

    for sf, label in rest.items():
        on = [t for t in ten if t.get("floor") and sfloor(t.get("floor")) == sf]
        if on:                                        # ② 업체마다 한 줄
            for t in on:
                rows.append({"_sf": sf, "층": label, "상호": t.get("name"),
                             "업종": t.get("biz"), "면적": t.get("area"), "적은이": "업체 원장"})
        else:                                         # ③ 층만 세운다
            rows.append({"_sf": sf, "층": label, "적은이": "대장"})

    rows.sort(key=lambda r: order(r.get("_sf")))
    for r in rows:
        r.pop("_sf", None)

    # 층 총면적은 대장이 안다. 호실 줄이 아니라 층에 붙는다
    area: dict[str, float] = {}
    for o in outline:
        if o.get("floor") and o.get("floor_area"):
            area[o["floor"]] = round(area.get(o["floor"], 0) + float(o["floor_area"]), 1)

    # 층을 모르는 업체 — 팀이 어느 층에든 그 이름으로 줄을 세웠으면 뺀다
    named = {nname(i.get("tenant_name")) for i in items if i.get("tenant_name")}
    unknown = [t.get("name") for t in ten
               if not t.get("floor") and nname(t.get("name")) not in named and t.get("name")]

    return {"rows": rows, "층면적": area, "층 모르는 업체": unknown,
            "팀 입력": len(items), "total": rents.get("total") or {}}
