"""매물 읽기 도우미 — 수익률 · 임대료(0226). 지번마다 보이는 매물 묶음은 parcels.listings_of(지번 열쇠 · 0255).

매물 하나에 매매가 하나다. 누가 무엇을 보나 · 건물 안 순번(rank)은 DB 함수 app.listings_now 가 정한다 —
여기선 그 줄을 건물마다 순번대로 모으고, 수익률(임대료와 짝)만 붙인다.
"""
from decimal import Decimal

from ..core.db import pool
from ..core.deps import CurrentUser


def is_broker(user: CurrentUser) -> bool:
    return user.kind == "중개사" and user.team_id is not None


def _num(v):
    return float(v) if isinstance(v, Decimal) else v


def roi(rent_month, price) -> float | None:
    """수익률 = 월임대 × 12 ÷ 매매가 × 100. 월임대는 내 매물의 건물 전체 실제 값(총월임대 · 만실 월임대)만.
    임대시세는 층 하나의 광고라 분자로 쓰지 않는다 · 추정임대는 없다(0239)."""
    if not rent_month or not price or float(rent_month) <= 0 or float(price) <= 0:
        return None
    return round(float(rent_month) * 12 / float(price) * 100, 2)


async def rents_for(user: CurrentUser, pnu: str) -> list[dict]:
    """임대료 — 실제 값만(내 매물 임대 · 네이버 임대시세). 추정임대는 없다(0239).
      내매물 · 건물 전체   매물 줄의 총보증금 · 총월임대 · 총관리비(층별을 다 채웠으면 그 합)
      내매물 · 층          팀이 적은 호실 줄(업체 단위). 돈이 적힌 줄만
      네이버매물 · 층      최근 수집일의 공간(층 · 면적)마다 가장 싼 광고 하나(0212)
    임대시세는 층 하나의 광고라 건물 전체로 늘리지 않는다 — 늘리면 추정을 실제처럼 만드는 셈이다."""
    out: list[dict] = []
    if user.team_id is not None:
        lv = await pool().fetchrow(
            "SELECT id, total_deposit, total_rent, total_mgmt, vacant_area"
            "  FROM app.office_listings WHERE pnu = $1 AND team_id = $2", pnu, user.team_id)
        if lv and (lv["total_rent"] or lv["total_deposit"]):
            out.append({"source": "내매물", "scope": "건물 전체", "deposit": lv["total_deposit"],
                        "rent": lv["total_rent"], "mgmt": lv["total_mgmt"], "vacant_area": _num(lv["vacant_area"])})
        for r in await pool().fetch(
                """SELECT floor, unit_no, tenant_name, contract_area, deposit, rent, maintenance
                     FROM app.floor_rents
                    WHERE listing_id = $1 AND deleted_at IS NULL AND (rent > 0 OR deposit > 0)
                    ORDER BY app.floor_signed(floor) NULLS LAST, unit_no NULLS LAST""", lv["id"] if lv else None):
            area = _num(r["contract_area"])
            out.append({"source": "내매물", "scope": r["floor"], "unit_no": r["unit_no"], "tenant": r["tenant_name"],
                        "area": area, "deposit": r["deposit"], "rent": r["rent"], "mgmt": r["maintenance"],
                        "ppm": round(r["rent"] / area) if r["rent"] and area else None})
    if is_broker(user):
        for r in await pool().fetch(
                """SELECT floor, contract_area, deposit, rent, observed_on, n_ads FROM master.market_rent
                    WHERE building_pk IN (SELECT building_pk FROM master.buildings WHERE pnu = $1)
                      AND observed_on = (SELECT max(observed_on) FROM master.market_rent)
                    ORDER BY CASE WHEN floor LIKE '지하%' THEN 1000 + substring(floor FROM '\\d+')::int
                                  ELSE substring(floor FROM '\\d+')::int END NULLS LAST, area_key""", pnu):
            area = _num(r["contract_area"])
            out.append({"source": "네이버매물", "scope": r["floor"] or "층 모름", "area": area,
                        "deposit": r["deposit"], "rent": r["rent"], "on_date": r["observed_on"], "n_ads": r["n_ads"],
                        "ppm": round(r["rent"] / area) if r["rent"] and area else None})
    return out
