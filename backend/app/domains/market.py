"""주변시세(S03): 반경 내 전 팀 임대 comps + 매각 comps. 원본 나열·이상치 플래그.
specs S03 · 01-상세설계 §3.3. '저장은 사적, 조회는 공용'(F-01 B안).
"""
import statistics
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from ..core.db import pool
from ..core.deps import current_user, CurrentUser

router = APIRouter(prefix="/market", tags=["market"])


class NearbyIn(BaseModel):
    center_lat: float
    center_lng: float
    radius_m: int = 500
    floor_from: int = -1     # 지하1
    floor_to: int = 5        # 지상5


def _flag_outliers(items: list[dict], key: str) -> None:
    """IQR 1.5 기준 이상치 플래그(기본 체크해제용). 데이터 3건 미만이면 스킵."""
    vals = [i[key] for i in items if i.get(key)]
    if len(vals) < 3:
        return
    q1, q3 = statistics.quantiles(vals, n=4)[0], statistics.quantiles(vals, n=4)[2]
    iqr = q3 - q1
    lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    for i in items:
        if i.get(key) and not (lo <= i[key] <= hi):
            i["is_outlier"] = True


@router.post("/nearby")
async def nearby(body: NearbyIn, _: CurrentUser = Depends(current_user)):
    # 임대 comps: 반경 내 전 팀 floor_rents (병합·다수결 없음, 원본 그대로)
    rent_rows = await pool().fetch(
        """SELECT fr.floor, fr.unit_no, fr.contract_area, fr.exclusive_area,
                  fr.deposit, fr.rent, fr.maintenance, b.addr, b.building_pk
           FROM app.floor_rents fr
           JOIN master.buildings b ON b.building_pk = fr.building_pk
           WHERE fr.deleted_at IS NULL AND NOT fr.is_vacant
             AND ST_DWithin(b.geom::geography,
                            ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, $3)
           ORDER BY fr.rent DESC""",
        body.center_lng, body.center_lat, body.radius_m,
    )
    rents = []
    for r in rent_rows:
        d = dict(r)
        d["is_outlier"] = False
        if d["contract_area"]:
            d["per_deposit"] = round((d["deposit"] or 0) / float(d["contract_area"]))
            d["per_rent"] = round((d["rent"] or 0) / float(d["contract_area"]))
        rents.append(d)
    _flag_outliers(rents, "per_rent")

    # 층별 평균(체크 로직은 프론트 curation, 여기선 비이상치 기준 초기값)
    by_floor: dict[str, list[dict]] = {}
    for r in rents:
        if not r["is_outlier"] and r.get("per_rent"):
            by_floor.setdefault(r["floor"], []).append(r)
    floor_avg = [
        {
            "floor": f,
            "per_deposit_avg": round(sum(x["per_deposit"] for x in xs) / len(xs)),
            "per_rent_avg": round(sum(x["per_rent"] for x in xs) / len(xs)),
            "count": len(xs),
        }
        for f, xs in sorted(by_floor.items())
    ]

    return {"rents": rents, "floor_avg": floor_avg,
            "radius_m": body.radius_m, "count": len(rents)}
