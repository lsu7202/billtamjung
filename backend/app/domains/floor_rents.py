"""층별 임대정보: 사적(팀)·자동저장. 내 매물 아니어도 입력 가능. specs S02 §3.5."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from ..core.db import pool, tx
from ..core.floor_label import normalize as _norm_floor, signed as _signed_floor
from ..core.deps import current_user, CurrentUser

router = APIRouter(prefix="/buildings/{building_pk}/floor-rents", tags=["floor-rents"])

# 층 파싱은 core/floor_label 하나만 쓴다(2026-08-29).
# 여기 있던 _signed_floor 는 「지하」 두 글자만 지하로 봤다. 대장 표기는 「지1층」·「지1」·「지층」이
# 훨씬 많아서(37만건) 지하가 지상으로 뒤집혀 읽혔고, 층 매칭이 통째로 어긋났다.
# 저장할 때는 이미 정규화를 거치는데(_norm_floor) 읽을 때만 옛 함수를 쓰고 있었다.


class RentIn(BaseModel):
    floor: str
    unit_no: str
    use: str | None = None
    contract_area: float | None = None     # ㎡ 저장(§5.3) — 프론트가 평↔㎡ 변환해 항상 ㎡로 전송
                                           # 면적은 이것 하나뿐(0035) — 전용면적은 우리 데이터에 없다
    deposit: int = 0          # 원 정수
    rent: int = 0
    maintenance: int = 0
    is_vacant: bool | None = None    # 공실상태 3값: None=미지정(기본)·False=임대중·True=공실
    tenant_name: str | None = None   # 상호명(0155) — 모르면 null. 용도 대신 화면에 선다


@router.get("")
async def list_rents(building_pk: str, user: CurrentUser = Depends(current_user)):
    rows = await pool().fetch(
        """SELECT id, floor, unit_no, use, contract_area,
                  deposit, rent, maintenance, is_vacant, tenant_name
           FROM app.floor_rents
           WHERE building_pk=$1 AND team_id=$2 AND deleted_at IS NULL
           -- 순서(2026-09-04): 1층부터 위로, 옥탑, 그 아래 지하. 예) 1층 2층 3층 옥탑1층 지하1층
           ORDER BY (CASE WHEN floor LIKE '%옥탑%' OR floor ~* '^\\s*(PH|R)' THEN 1000
                          WHEN floor LIKE '지하%' OR floor LIKE '지%' OR floor ~* '^\\s*B' THEN 2000 ELSE 0 END)
                    + COALESCE(NULLIF(regexp_replace(floor, '\\D', '', 'g'), '')::int, 0) ASC, unit_no""",
        building_pk, user.team_id,
    )
    hidden = [r["floor"] for r in await pool().fetch(
        "SELECT floor FROM app.floor_hidden WHERE building_pk=$1 AND team_id=$2",
        building_pk, user.team_id)]
    hidden_sf = {_signed_floor(f) for f in hidden}

    items = [dict(r) for r in rows if _signed_floor(r["floor"]) not in hidden_sf]
    team_rent = sum(r["rent"] or 0 for r in items)
    team_deposit = sum(r["deposit"] or 0 for r in items)
    # 총액의 마스터 추정 = '팀이 손대지 않은 층'만. 층 단위로 대체한다(0029).
    # 예전엔 층 안에서 앞 K개만 대체해서, 2호실을 하나로 합쳐 입력하면 나머지 1호실 추정이 총액에 남았다.
    est_rows = await pool().fetch(
        """SELECT fo.floor, fre.rent_est, fre.deposit_est
           FROM master.floor_outline fo JOIN master.floor_rent_est fre USING (building_pk, seq)
           WHERE fo.building_pk=$1 AND fre.rent_est > 0 ORDER BY fo.seq""",
        building_pk,
    )
    # **추정은 팀 입력에 흔들리지 않는다**(2026-09-04). 예전엔 팀이 값을 넣은 층을 추정에서
    # 빼고 실측으로 갈아 끼웠는데(하이브리드), 그러면 한 층을 고칠 때마다 「추정 총액」이 같이
    # 움직여서 무엇이 추정이고 무엇이 실측인지 화면에서 구분이 안 됐다.
    # 이제 둘은 서로 다른 자리다: rent/deposit = 팀 실측 · rent_full/deposit_full = 전 층 추정.
    # 없앤 층(floor_hidden)만 뺀다 — 그 층이 없다는 것은 추정에도 사실이다.
    est_rent_full = est_dep_full = 0
    for r in est_rows:
        f = _signed_floor(r["floor"])
        if f in hidden_sf:
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
        # 전 층 추정 — 팀 입력과 섞지 않는다. 이름 그대로 「추정」이다.
        "rent_full": est_rent_full,
        "deposit_full": est_dep_full,
        "rent_occupied_full": est_rent_full,
    }
    return {"items": items, "total": total, "hidden_floors": hidden}


class HiddenIn(BaseModel):
    floor: str
    hidden: bool = True


@router.post("/hidden")
async def set_hidden(building_pk: str, body: HiddenIn, user: CurrentUser = Depends(current_user)):
    """층 없애기/되살리기. 없앨 때 그 층의 팀 입력도 함께 정리한다(빈 층으로 남기지 않음)."""
    body.floor = _norm_floor(body.floor)[0] or body.floor
    if body.hidden:
        async with tx() as conn:
            await conn.execute(
                """UPDATE app.floor_rents SET deleted_at=now()
                   WHERE building_pk=$1 AND team_id=$2 AND floor=$3 AND deleted_at IS NULL""",
                building_pk, user.team_id, body.floor)
            await conn.execute(
                """INSERT INTO app.floor_hidden(building_pk, team_id, floor) VALUES($1,$2,$3)
                   ON CONFLICT DO NOTHING""",
                building_pk, user.team_id, body.floor)
    else:
        await pool().execute(
            "DELETE FROM app.floor_hidden WHERE building_pk=$1 AND team_id=$2 AND floor=$3",
            building_pk, user.team_id, body.floor)
    return {"ok": True}


@router.put("")
async def upsert_rent(building_pk: str, body: RentIn, user: CurrentUser = Depends(current_user)):
    """(building_pk, team_id, 층, 호실) 매칭키 upsert. 공실이어도 값 보존(만실 총계·공실제외는 플래그로 구분).
    층 표기는 대장과 같은 규칙으로 정규화한다(0031) — '3F'로 치고 대장이 '3층'이면 다른 층이 돼
    추정이 안 빠지고 이중 계산된다."""
    body.floor = _norm_floor(body.floor)[0] or body.floor
    await pool().execute(
        """INSERT INTO app.floor_rents
             (building_pk,team_id,floor,unit_no,use,contract_area,
              deposit,rent,maintenance,is_vacant,tenant_name)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (building_pk,team_id,floor,unit_no)
           DO UPDATE SET use=EXCLUDED.use,
             contract_area=EXCLUDED.contract_area, deposit=EXCLUDED.deposit,
             rent=EXCLUDED.rent, maintenance=EXCLUDED.maintenance,
             is_vacant=EXCLUDED.is_vacant, tenant_name=EXCLUDED.tenant_name,
             deleted_at=NULL, updated_at=now()""",
        building_pk, user.team_id, body.floor, body.unit_no, body.use,
        body.contract_area,
        body.deposit, body.rent, body.maintenance, body.is_vacant, body.tenant_name,
    )
    return {"ok": True}


@router.delete("")
async def revert_all(building_pk: str, user: CurrentUser = Depends(current_user)):
    """대장 구조로 되돌리기 — 팀이 넣은 행과 없앤 층 표시를 한 번에 지운다(2026-09-04).
    화면이 행마다 DELETE 를 부르면 없앤 층이 남아 「되돌렸는데 그대로」로 보였다."""
    async with tx() as conn:
        n = await conn.execute(
            """UPDATE app.floor_rents SET deleted_at=now()
               WHERE building_pk=$1 AND team_id=$2 AND deleted_at IS NULL""",
            building_pk, user.team_id)
        await conn.execute(
            "DELETE FROM app.floor_hidden WHERE building_pk=$1 AND team_id=$2",
            building_pk, user.team_id)
    return {"ok": True, "cleared": n}


@router.delete("/{rent_id}")
async def delete_rent(building_pk: str, rent_id: int, user: CurrentUser = Depends(current_user)):
    await pool().execute(
        """UPDATE app.floor_rents SET deleted_at=now()
           WHERE id=$1 AND building_pk=$2 AND team_id=$3""",
        rent_id, building_pk, user.team_id,
    )
    return {"ok": True}
