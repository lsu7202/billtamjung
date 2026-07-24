"""시세 시계열 팀 오버레이 — 공시지가(총)·실거래·광고. 마스터 점 불변 + 팀 오버레이 override/추가.
값 y=원(카드 표시단위). 광고는 마스터 없음(오버레이 전용). specs S02 §3.7."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from ..core.db import pool
from ..core.deps import current_user, CurrentUser

router = APIRouter(prefix="/buildings/{building_pk}/series", tags=["series"])

KINDS = ("gongsi", "real", "ad")


def _merge(master: list[dict], overlay: list[dict]) -> list[dict]:
    """x 매칭 시 오버레이가 마스터 override. ov=True면 팀 오버레이(수정·삭제 가능)."""
    m = {p["x"]: {"x": p["x"], "y": p["y"], "ov": False} for p in master}
    for o in overlay:
        m[o["x"]] = {"x": o["x"], "y": int(o["y"]), "ov": True}
    return sorted(m.values(), key=lambda p: p["x"])


@router.get("")
async def get_series(building_pk: str, user: CurrentUser = Depends(current_user)):
    b = await pool().fetchrow(
        "SELECT pnu, COALESCE(parcel_area, land_area) AS area FROM master.buildings WHERE building_pk=$1", building_pk)
    if b is None:
        raise HTTPException(404, "건물을 찾을 수 없습니다")
    area = float(b["area"]) if b["area"] else 0.0

    # 마스터: 실거래(원) · 총공시지가(원/㎡×면적)
    real_m = [{"x": f"{r['contract_ym'][:4]}/{r['contract_ym'][4:]}", "y": r["price"]}
              for r in await pool().fetch(
                  "SELECT contract_ym, price FROM master.sales_history WHERE building_pk=$1 ORDER BY contract_ym", building_pk)]
    gongsi_m = []
    if b["pnu"] and area:
        gongsi_m = [{"x": str(g["year"]), "y": int(g["price"] * area)}
                    for g in await pool().fetch(
                        "SELECT year, price FROM master.gongsi_series WHERE pnu=$1 ORDER BY year", b["pnu"])]

    # 팀 오버레이
    ov = {k: [] for k in KINDS}
    for r in await pool().fetch(
            "SELECT kind, x, y FROM app.series_points WHERE team_id=$1 AND building_pk=$2", user.team_id, building_pk):
        ov[r["kind"]].append({"x": r["x"], "y": r["y"]})

    return {
        "gongsi": _merge(gongsi_m, ov["gongsi"]),
        "real": _merge(real_m, ov["real"]),
        "ad": _merge([], ov["ad"]),
    }


class PointIn(BaseModel):
    kind: str
    x: str
    y: int


@router.put("")
async def upsert_point(building_pk: str, body: PointIn, user: CurrentUser = Depends(current_user)):
    if body.kind not in KINDS:
        raise HTTPException(422, "kind는 gongsi|real|ad")
    if not body.x.strip():
        raise HTTPException(422, "시점(x) 필수")
    await pool().execute(
        """INSERT INTO app.series_points(team_id, building_pk, kind, x, y, updated_by)
           VALUES($1,$2,$3,$4,$5,$6)
           ON CONFLICT (team_id, building_pk, kind, x)
           DO UPDATE SET y=EXCLUDED.y, updated_by=EXCLUDED.updated_by, updated_at=now()""",
        user.team_id, building_pk, body.kind, body.x.strip(), body.y, user.account_id)
    return {"ok": True}


@router.delete("")
async def delete_point(building_pk: str, kind: str, x: str, user: CurrentUser = Depends(current_user)):
    """x에 '/'(예: 2026/07)가 있어 path param 대신 쿼리 파라미터(?kind=&x=) 사용."""
    await pool().execute(
        "DELETE FROM app.series_points WHERE team_id=$1 AND building_pk=$2 AND kind=$3 AND x=$4",
        user.team_id, building_pk, kind, x)
    return {"ok": True}
