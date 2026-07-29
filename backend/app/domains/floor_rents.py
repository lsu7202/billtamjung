"""층별 임대정보: 사적(팀)·자동저장. 내 매물 아니어도 입력 가능. specs S02 §3.5."""
import re
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from ..core.db import pool
from ..core.deps import current_user, CurrentUser

router = APIRouter(prefix="/buildings/{building_pk}/floor-rents", tags=["floor-rents"])


def _signed_floor(fl: str | None) -> int | None:
    """'15층'→15, '지하1층'/'B1'→-1. 팀입력·대장 층 라벨 매칭용."""
    if not fl:
        return None
    s = str(fl)
    n = re.sub(r"\D", "", s)
    if "지하" in s or s.strip().upper().startswith("B"):
        return -int(n) if n else -1
    return int(n) if n else None


class RentIn(BaseModel):
    floor: str
    unit_no: str
    use: str | None = None
    exclusive_area: float | None = None    # ㎡ 실측 전용면적(유저 입력) — 대장 층별면적은 바닥면적이라 계약으로 프리필
    contract_area: float | None = None     # ㎡ 저장(§5.3) — 프론트가 평↔㎡ 변환해 항상 ㎡로 전송
    deposit: int = 0          # 원 정수
    rent: int = 0
    maintenance: int = 0
    is_vacant: bool | None = None    # 공실상태 3값: None=미지정(기본)·False=임대중·True=공실


@router.get("")
async def list_rents(building_pk: str, user: CurrentUser = Depends(current_user)):
    rows = await pool().fetch(
        """SELECT id, floor, unit_no, use, exclusive_area, contract_area,
                  deposit, rent, maintenance, is_vacant
           FROM app.floor_rents
           WHERE building_pk=$1 AND team_id=$2 AND deleted_at IS NULL
           ORDER BY (CASE WHEN floor LIKE '지하%' OR floor ~* '^\\s*B' THEN -1 ELSE 1 END)
                    * COALESCE(NULLIF(regexp_replace(floor, '\\D', '', 'g'), '')::int, 0) DESC, unit_no""",
        building_pk, user.team_id,
    )
    items = [dict(r) for r in rows]
    team_rent = sum(r["rent"] or 0 for r in items)
    team_deposit = sum(r["deposit"] or 0 for r in items)
    # 호실단위 하이브리드 총액: 표에 보이는 호실별로 오버레이 있으면 실제값, 없으면 마스터 추정.
    # 마스터 호실(seq) = 대장 층별개요. 팀이 한 층에 K개 입력하면 그 층 마스터 seq 앞 K개가 '대체'되고
    # 나머지 seq는 추정 유지 → 다호실 층에서 일부만 입력해도 나머지 호실이 총액에 남음(과소 방지).
    est_rows = await pool().fetch(
        """SELECT fo.floor, fre.rent_est, fre.deposit_est
           FROM master.floor_outline fo JOIN master.floor_rent_est fre USING (building_pk, seq)
           WHERE fo.building_pk=$1 AND fre.rent_est > 0 ORDER BY fo.seq""",
        building_pk,
    )
    team_cnt: dict[int | None, int] = {}
    for r in items:
        f = _signed_floor(r["floor"])
        team_cnt[f] = team_cnt.get(f, 0) + 1
    est_rent_full = est_dep_full = 0
    used: dict[int | None, int] = {}
    for r in est_rows:
        f = _signed_floor(r["floor"])
        if used.get(f, 0) < team_cnt.get(f, 0):
            used[f] = used.get(f, 0) + 1   # 이 마스터 호실은 팀 입력이 대체
            continue
        est_rent_full += r["rent_est"] or 0
        est_dep_full += r["deposit_est"] or 0
    total = {
        "deposit": team_deposit,
        "rent": team_rent,
        "maintenance": sum(r["maintenance"] or 0 for r in items),
        "rent_occupied": sum(r["rent"] or 0 for r in items if r["is_vacant"] is not True),   # 공실제외 수익률(F-14): 공실 행 제외
        "vacant_count": sum(1 for r in items if r["is_vacant"] is True),
        "status_count": sum(1 for r in items if r["is_vacant"] is not None),   # 총공실 3값: 0이면 미지정
        # 전층 하이브리드(건물 총임대료/보증금 = 팀 실제 + 미입력층 추정)
        "rent_full": team_rent + est_rent_full,
        "deposit_full": team_deposit + est_dep_full,
    }
    return {"items": items, "total": total}


@router.put("")
async def upsert_rent(building_pk: str, body: RentIn, user: CurrentUser = Depends(current_user)):
    """(building_pk, team_id, 층, 호실) 매칭키 upsert. 공실이어도 값 보존(만실 총계·공실제외는 플래그로 구분)."""
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
