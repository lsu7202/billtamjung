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

import datetime as dt
import re

import asyncpg

from ..core.db import pool

_STRIP = re.compile(r"\([^)]*\)|㈜|\(주\)|주식회사|유한회사|\s+")


def norm_name(s: str | None) -> str:
    """이름 견줌용. 「(주)더원」·「더원 삼성점」·「더원」이 하나다."""
    t = _STRIP.sub("", s or "").lower()
    return re.sub(r"점$", "", t) if len(t) > 2 else t


def _floor(n: int | None, base: bool) -> str | None:
    if n is None:
        return None
    # 인허가는 지하를 **음수**로 적는다(-1). 그대로 쓰면 「지하-1층」이 된다(2026-09-25)
    return f"지하{abs(n)}층" if base or n < 0 else f"{n}층"


async def tenant_ledger(building_pk: str) -> list[dict]:
    """업체 원장(인허가+상가정보)을 이름으로 접은 목록. GET /buildings/{pk}/floors 가 쓴다(2026-09-17).
    예전 /tenants 라우트는 여기로 흡수됐다 — 화면은 넷을 따로 받아 합치지 않는다."""
    rows = await pool().fetch(
        """WITH pc AS (SELECT p.pnu, p.geom FROM master.building_parcels bp
                        JOIN master.parcels p ON p.pnu = bp.pnu
                       WHERE bp.building_pk = $1)
           SELECT 'localdata' AS src, l.name, l.floor_no, l.is_base, l.area::float AS area, l.open_on
             FROM master.localdata_permit l, pc
            WHERE l.state = '영업' AND l.geom && pc.geom AND ST_Contains(pc.geom, l.geom)
           UNION ALL
           SELECT 'sbiz', s.name, s.floor_no, s.is_base, NULL, NULL
             FROM master.sbiz_store s JOIN pc ON pc.pnu = s.pnu""",
        building_pk)

    merged: dict[str, dict] = {}
    for r in rows:
        k = norm_name(r["name"])
        if not k:
            continue
        m = merged.get(k)
        if m is None:
            m = merged[k] = {"name": r["name"], "floor": None, "area": None,
                             "open_on": None, "src": set()}
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

    # 접두로 한 번 더 접는다 — 「더라운드 삼성점」(LOCALDATA) 과 「더라운드」(소상공인) 는
    #   같은 가게다. 짧은 이름이 세 글자 이상이고 긴 이름의 머리일 때만. 층은 짧은 쪽에 없으면 긴 쪽 것을 쓴다
    keys = sorted(merged, key=len)
    for k in sorted(merged, key=len, reverse=True):
        base = next((b for b in keys if b != k and len(b) >= 3 and k.startswith(b)), None)
        if base is None or base not in merged or k not in merged:
            continue
        a, b = merged[base], merged.pop(k)
        for f in ("floor", "area", "open_on"):
            if a[f] is None:
                a[f] = b[f]
        a["src"] |= b["src"]

    # 업종·전화는 안 낸다(2026-09-19). 업종은 **찾을 때** 쓰는 값이지 볼 때 쓰는 값이 아니고,
    # 상호가 있으면 사용자는 그게 뭐 하는 곳인지 안다. 게다가 세 원천이 서로 다른 말을 한다 —
    # 우마쿠라는 LOCALDATA 「한식」·우리 8갈래 「먹자」·카카오 「일식집」이고 고를 근거가 없다.
    # 찾는 쪽은 검색 필터 biz 가 카카오 키워드로 따로 한다.
    items = [{
        "name": m["name"], "floor": m["floor"], "area": m["area"],
    } for m in merged.values()]
    # 층 있는 것부터, 층 안에서는 이름순. 층 미상은 뒤로
    items.sort(key=lambda x: (x["floor"] is None, x["floor"] or "", x["name"]))
    return items


# ── 입주 이력(2026-09-25 대표) ─────────────────────────────────────────────────
#
# LOCALDATA 는 **과거가 강하고 현재가 약한** 원천이다. 「영업」은 폐업 신고를 안 하면 그대로 남지만
# (직권말소·취소로 뒤늦게 지운 것만 16.7만 건), 개업일·폐업일은 신고 기록이라 지나간 일은 정리돼 있다.
# 그래서 층별 임대정보(지금)가 아니라 **이력**으로 쓴다. 임대료는 없다 — 누가 언제 들어왔다 나갔나다.
#
# 거르는 것:
#   · 건물 **사용승인 전에 닫은** 업체 — 같은 필지의 옛 건물 업체다(연지동 「금수 다방」 1981~1993)
#   · 통신판매업 — 층이 0%이고 주소만 올린 것이 섞인다(159평에 347곳). 줄로 안 세우고 수만 센다
#   · 이름 없는 신고(CCTV·과속방지턱 등 *_info) — 업체가 아니다
_HIST_SQL = """
WITH pc AS (SELECT p.geom FROM master.building_parcels bp
              JOIN master.parcels p ON p.pnu = bp.pnu WHERE bp.building_pk = $1)
SELECT l.name, l.kind, NULLIF(trim(l.biz2), '') AS biz, l.floor_no, l.is_base, l.area::float AS area,
       l.state, l.open_on, l.close_on, l.phone
  FROM master.localdata_permit l, pc
 WHERE l.geom && pc.geom AND ST_Contains(pc.geom, l.geom) AND l.name IS NOT NULL
"""
_NO_DATE = dt.date(1901, 1, 1)      # 원장에 1900-01-01 이 「모름」으로 박혀 있다
_ECOMMERCE = "ecommerce_businesses"


async def history_rows(building_pk: str) -> tuple[list[dict], dt.date | None]:
    """이 건물 필지 안의 인허가 전부(폐업 포함)와 사용승인일. 입주 이력과 층 빌려오기가 같이 쓴다."""
    appr = await pool().fetchval(
        "SELECT approval_ymd FROM master.buildings WHERE building_pk=$1", building_pk)
    return [dict(r) for r in await pool().fetch(_HIST_SQL, building_pk)], appr


def _before_building(r: dict, appr: dt.date | None) -> bool:
    return bool(appr and r["close_on"] and r["close_on"] < appr)


def past_floors(rows: list[dict], appr: dt.date | None) -> dict[str, str]:
    """이름 → 층. 층을 모르는 업체에 **층을 빌려 줄** 표다(2026-09-25 대표).
    카카오·네이버에 있으면 지금 있는 업체이고, 그 층은 인허가(폐업한 줄 포함)에서 가져와도 된다.
    같은 이름이 여러 층이면 가장 최근에 연 줄의 층을 쓴다(건물 안에서 옮겼을 수 있다)."""
    best: dict[str, tuple[dt.date, str]] = {}
    for r in rows:
        if r["floor_no"] is None or r["kind"] == _ECOMMERCE or _before_building(r, appr):
            continue
        k = norm_name(r["name"])
        if not k:
            continue
        o = r["open_on"] or _NO_DATE
        if k not in best or o > best[k][0]:
            best[k] = (o, _floor(r["floor_no"], r["is_base"]))
    return {k: v[1] for k, v in best.items()}


def _digits(s: str | None) -> str:
    d = re.sub(r"\D", "", s or "")
    return d if len(d) >= 7 else ""


async def biz_for(building_pk: str) -> dict | None:
    """그 건물에 **지금 있는** 업체 — 카카오 장소 크롤링(master.biz, 스펙 11 §8-1).

    그 건물을 한 번도 수집하지 않았으면 None(모른다) — 부르는 쪽이 원장(인허가·상가정보)으로 대신한다.
    수집했는데 업체가 없으면 빈 목록이다(단독주택 등). 건물은 필지로 붙였다(building_pks, 검색과 같은 규칙).
    화면을 열 때마다 카카오에 묻던 places_for 를 대신한다 — 링크는 저장하지 않는다(§7)."""
    try:
        rows = await pool().fetch(
            """SELECT name, floor, phone, last_seen FROM master.biz
                WHERE $1 = ANY(building_pks) AND gone_on IS NULL
                ORDER BY floor NULLS LAST, name""", building_pk)
        seen = await pool().fetchval(
            "SELECT max(crawl_day) FROM master.place_crawl_log WHERE $1 = ANY(pks)", building_pk)
    except asyncpg.exceptions.UndefinedTableError:    # 적재 전 환경 — 모른다
        return None
    if not rows and seen is None:
        return None
    return {"items": [{"name": r["name"], "floor": r["floor"], "area": None, "phone": r["phone"]} for r in rows],
            "checked_on": max((r["last_seen"] for r in rows), default=seen)}


async def tenancy_history(building_pk: str) -> dict:
    """입주 이력 — 층별로 묶고, 층 안에서는 최근에 연 순서. 같은 업체의 인허가 여러 줄
    (일반음식점 + 휴게음식점 등)은 기간이 겹치면 하나로 접는다. 다시 연 것은 따로 선다.

    **지금 있는지는 크롤링으로만 본다**(2026-09-25 대표 · 2026-09-27 카카오 실시간 → master.biz).
    인허가 「영업」은 폐업 신고를 안 하면 남는 신고 상태라, 그것만으로 「지금 있음」을 말하지 않는다.
    크롤링 업체와 이름이나 전화로 맞으면 `now=True`, 아니면 `now=False` — 폐업일도 없으니 **끝을 모르는**
    줄이다(연지동 (주)파라메딕). 그 건물을 수집한 적이 없으면 전부 `now=False`(모름)."""
    rows, appr = await history_rows(building_pk)
    kk = ((await biz_for(building_pk)) or {}).get("items", [])
    # 카카오 이름엔 동네 이름이 지점명처럼 붙는다 — 「미스터**연지동**순두부」 = 인허가 「미스터순두부」.
    # 건물이 있는 동(·가) 이름을 양쪽에서 빼고 한 번 더 견준다. 네이버를 붙일 때도 같은 규칙을 쓴다
    addr = await pool().fetchval("SELECT addr FROM master.buildings WHERE building_pk=$1", building_pk) or ""
    dongs = [d for d in re.findall(r"(\S+?(?:동|가))(?:\d|\s|$)", addr) if len(d) >= 2]

    def strip_dong(n: str) -> str:
        for d in dongs:
            n = n.replace(norm_name(d), "")
        return n

    k_names = [norm_name(p.get("name")) for p in kk]
    k_names += [strip_dong(n) for n in k_names if strip_dong(n) != n]
    k_phones = {_digits(p.get("phone")) for p in kk} - {""}
    ecommerce = 0
    stints: list[dict] = []
    for r in sorted(rows, key=lambda x: x["open_on"] or _NO_DATE):
        if _before_building(r, appr):
            continue
        if r["kind"] == _ECOMMERCE:
            ecommerce += r["state"] == "영업"
            continue
        k = norm_name(r["name"])
        if not k:
            continue
        o = r["open_on"] if r["open_on"] and r["open_on"] >= _NO_DATE else None
        c = r["close_on"]
        live = r["state"] in ("영업", "휴업")
        # 같은 이름 · 기간이 겹치면 한 업체다(끝이 안 보이면 이어진 것으로 본다)
        prev = next((x for x in reversed(stints) if _same_name(x["k"], k)
                     and (x["live"] or x["close_on"] is None or o is None or o <= x["close_on"])), None)
        if prev:
            prev["live"] = prev["live"] or live
            prev["close_on"] = None if prev["live"] else max(filter(None, [prev["close_on"], c]), default=None)
            prev["floor"] = prev["floor"] or _floor(r["floor_no"], r["is_base"])
            prev["area"] = max(filter(None, [prev["area"], r["area"]]), default=None)
            prev["biz"] = prev["biz"] or r["biz"]
            prev["state"] = "영업" if prev["live"] else prev["state"]
        else:
            prev = {"k": k, "name": r["name"], "biz": r["biz"],
                    "floor": _floor(r["floor_no"], r["is_base"]), "area": r["area"],
                    "open_on": o, "close_on": None if live else c,
                    "state": r["state"], "live": live, "phones": set()}
            stints.append(prev)
        # 전화를 모은다 — 이름이 달라도 전화가 같으면 카카오의 그 업체다
        if (ph := _digits(r["phone"])):
            prev["phones"].add(ph)
    # 층별(1층부터 위로 · 지하 · 층 미상) → 층 안에서는 최근에 연 순서
    def fkey(x: dict):
        f = x["floor"]
        if f is None:
            return (2, 0)
        n = int(re.sub(r"\D", "", f) or 0)
        return (1, n) if f.startswith("지하") else (0, n)
    stints.sort(key=lambda x: (fkey(x), -(x["open_on"] or _NO_DATE).toordinal()))
    # 지금 영업 중인데 층이 없으면 **상가정보의 층**을 빌린다 — 같은 업체의 현재 층이다.
    # 폐업한 줄에는 안 빌린다. 상가정보는 지금 판이라 과거의 층을 말하지 않는다
    sb = await pool().fetch(
        """SELECT s.name, s.floor_no, s.is_base FROM master.sbiz_store s
             JOIN master.building_parcels bp ON bp.pnu = s.pnu
            WHERE bp.building_pk = $1 AND s.floor_no IS NOT NULL""", building_pk)
    sbf = [(norm_name(r["name"]), _floor(r["floor_no"], r["is_base"])) for r in sb]
    for x in stints:
        if x["live"] and not x["floor"]:
            x["floor"] = next((f for n, f in sbf if n and _same_name(n, x["k"])), None)
    # 지금 있나 — 신고상 영업인 줄만 카카오에 물어본다. 폐업한 줄은 묻지 않는다(끝난 일이다)
    for x in stints:
        x["now"] = bool(x["live"] and (
            any(n and (_same_name(n, x["k"]) or _same_name(n, strip_dong(x["k"]))) for n in k_names)
            or (x["phones"] & k_phones)))
    stints.sort(key=lambda x: (fkey(x), -(x["open_on"] or _NO_DATE).toordinal()))
    items = [{kk: v for kk, v in x.items() if kk not in ("k", "live", "phones")} for x in stints]
    return {"items": items, "ecommerce": ecommerce}


def _same_name(a: str, b: str) -> bool:
    return a == b or (len(a) >= 3 and len(b) >= 3 and (a.startswith(b) or b.startswith(a)))
