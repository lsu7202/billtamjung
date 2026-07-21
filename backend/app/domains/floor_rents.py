"""층별 임대정보: 사적(팀)·자동저장. 내 매물 아니어도 입력 가능. specs S02 §3.5."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from ..core.db import pool
from ..core.deps import current_user, CurrentUser

router = APIRouter(prefix="/buildings/{building_pk}/floor-rents", tags=["floor-rents"])


class RentIn(BaseModel):
    floor: str
    unit_no: str
    use: str | None = None
    exclusive_area: float | None = None
    contract_area: float | None = None
    deposit: int = 0          # 원 정수
    rent: int = 0
    maintenance: int = 0
    is_vacant: bool = False


@router.get("")
async def list_rents(building_pk: str, user: CurrentUser = Depends(current_user)):
    rows = await pool().fetch(
        """SELECT id, floor, unit_no, use, exclusive_area, contract_area,
                  deposit, rent, maintenance, is_vacant
           FROM app.floor_rents
           WHERE building_pk=$1 AND team_id=$2 AND deleted_at IS NULL
           ORDER BY floor DESC, unit_no""",
        building_pk, user.team_id,
    )
    items = [dict(r) for r in rows]
    total = {
        "deposit": sum(r["deposit"] or 0 for r in items),
        "rent": sum(r["rent"] or 0 for r in items),
        "maintenance": sum(r["maintenance"] or 0 for r in items),
        "vacant_count": sum(1 for r in items if r["is_vacant"]),
    }
    return {"items": items, "total": total}


@router.put("")
async def upsert_rent(building_pk: str, body: RentIn, user: CurrentUser = Depends(current_user)):
    """(building_pk, team_id, 층, 호실) 매칭키 upsert. 공실=금액 0."""
    if body.is_vacant and (body.deposit or body.rent):
        raise HTTPException(422, "공실 호실은 보증금·임대료가 0이어야 합니다")
    await pool().execute(
        """INSERT INTO app.floor_rents
             (building_pk,team_id,floor,unit_no,use,exclusive_area,contract_area,
              deposit,rent,maintenance,is_vacant)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (building_pk,team_id,floor,unit_no)
           DO UPDATE SET use=EXCLUDED.use, exclusive_area=EXCLUDED.exclusive_area,
             contract_area=EXCLUDED.contract_area, deposit=EXCLUDED.deposit,
             rent=EXCLUDED.rent, maintenance=EXCLUDED.maintenance,
             is_vacant=EXCLUDED.is_vacant, deleted_at=NULL, updated_at=now()""",
        building_pk, user.team_id, body.floor, body.unit_no, body.use,
        body.exclusive_area, body.contract_area,
        body.deposit, body.rent, body.maintenance, body.is_vacant,
    )
    return {"ok": True}


@router.delete("/{rent_id}")
async def delete_rent(building_pk: str, rent_id: int, user: CurrentUser = Depends(current_user)):
    await pool().execute(
        """UPDATE app.floor_rents SET deleted_at=now()
           WHERE id=$1 AND building_pk=$2 AND team_id=$3""",
        rent_id, building_pk, user.team_id,
    )
    return {"ok": True}
