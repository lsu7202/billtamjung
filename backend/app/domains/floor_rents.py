"""층별 임대정보: 사적(팀)·자동저장. 내 매물 아니어도 입력 가능. specs S02 §3.5."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from ..core.db import pool, tx
from ..core.floor_label import normalize as _norm_floor, signed as _signed_floor
from ..core.deps import current_user, CurrentUser
from .mirror import listing_values_fold

router = APIRouter(prefix="/buildings/{building_pk}/floor-rents", tags=["floor-rents"])

# 층 파싱은 core/floor_label 하나만 쓴다(2026-08-29).
# 여기 있던 _signed_floor 는 「지하」 두 글자만 지하로 봤다. 대장 표기는 「지1층」·「지1」·「지층」이
# 훨씬 많아서(37만건) 지하가 지상으로 뒤집혀 읽혔고, 층 매칭이 통째로 어긋났다.
# 저장할 때는 이미 정규화를 거치는데(_norm_floor) 읽을 때만 옛 함수를 쓰고 있었다.


class RentIn(BaseModel):
    id: int | None = None     # 있으면 그 줄을 고친다(0160). 호실이 빈 줄은 여럿이라 (층, 호실)로는 못 찾는다
    floor: str
    unit_no: str = ""         # 모르면 빈칸 — 순번을 지어 넣지 않는다
    use: str | None = None
    contract_area: float | None = None     # ㎡ 저장(§5.3) — 프론트가 평↔㎡ 변환해 항상 ㎡로 전송
                                           # 면적은 이것 하나뿐(0035) — 전용면적은 우리 데이터에 없다
    deposit: int = 0          # 원 정수
    rent: int = 0
    maintenance: int = 0
    # 공실 칸은 없다(0180). 층별 줄은 **들어온 업체**뿐이고, 공실은 층마다 면적 하나다(VacancyIn)
    tenant_name: str | None = None   # 상호명(0155) — 모르면 null. 용도 대신 화면에 선다


class VacancyIn(BaseModel):
    """층의 공실면적(0180). 칸 수가 아니라 넓이다 — 30평을 한 칸으로 내놓든 셋으로 쪼개든 건물주 마음이다.
    `vacant_area` 가 None 이면 그 층 기록을 지운다(모름). 0 은 팀이 확인한 만실이다."""
    floor: str
    vacant_area: float | None = None   # ㎡ — 프론트가 평↔㎡ 변환해 항상 ㎡로 보낸다


async def team_floor_rows(building_pk: str, team_id: int) -> tuple[list[dict], list[str]]:
    """팀 층별 줄(없앤 층 제외)과 없앤 층 목록. /floor-rents 와 /floors 가 같이 쓴다(2026-09-17)."""
    rows = await pool().fetch(
        """SELECT id, floor, unit_no, use, contract_area,
                  deposit, rent, maintenance, tenant_name
           FROM app.floor_rents
           WHERE building_pk=$1 AND team_id=$2 AND deleted_at IS NULL
           -- 순서(2026-09-04): 1층부터 위로, 옥탑, 그 아래 지하. 예) 1층 2층 3층 옥탑1층 지하1층
           ORDER BY (CASE WHEN floor LIKE '%옥탑%' OR floor ~* '^\\s*(PH|R)' THEN 1000
                          WHEN floor LIKE '지하%' OR floor LIKE '지%' OR floor ~* '^\\s*B' THEN 2000 ELSE 0 END)
                    + COALESCE(NULLIF(regexp_replace(floor, '\\D', '', 'g'), '')::int, 0) ASC, unit_no""",
        building_pk, team_id,
    )
    hidden = [r["floor"] for r in await pool().fetch(
        "SELECT floor FROM app.floor_hidden WHERE building_pk=$1 AND team_id=$2",
        building_pk, team_id)]
    hidden_sf = {_signed_floor(f) for f in hidden}

    items = [dict(r) for r in rows if _signed_floor(r["floor"]) not in hidden_sf]
    return items, hidden


@router.get("", openapi_extra={"x-ai": "read"})   # AI 가 부를 수 있다 — 팀 층별 줄만. 층으로 묶인 것은 /floors
async def list_rents(building_pk: str, user: CurrentUser = Depends(current_user)):
    items, _hidden = await team_floor_rows(building_pk, user.team_id)
    # 합계는 팀 실측만(감사 2026-09-17). 전 층 추정 합(rent_full·deposit_full)·공실제외 합·상태 수는
    # 화면이 안 읽어 뺐다 — 추정 임대는 임대 탭 카드가 따로 낸다. hidden_floors 도 안 읽는다.
    total = {
        "deposit": sum(r["deposit"] or 0 for r in items),
        "rent": sum(r["rent"] or 0 for r in items),
        "maintenance": sum(r["maintenance"] or 0 for r in items),
    }
    return {"items": items, "total": total}



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
    await listing_values_fold(user.team_id, building_pk)     # 층이 사라지면 합계·수익률도 따라온다(0173)
    return {"ok": True}


@router.put("")
async def upsert_rent(building_pk: str, body: RentIn, user: CurrentUser = Depends(current_user)):
    """(building_pk, team_id, 층, 호실) 매칭키 upsert. 줄은 들어온 업체다 — 공실은 /vacancy 가 받는다.
    층 표기는 대장과 같은 규칙으로 정규화한다(0031) — '3F'로 치고 대장이 '3층'이면 다른 층이 돼
    추정이 안 빠지고 이중 계산된다."""
    body.floor = _norm_floor(body.floor)[0] or body.floor
    body.unit_no = (body.unit_no or "").strip()
    if body.id is not None:
        # 줄을 id 로 고친다(0160). 호실이 빈 줄이 한 층에 여럿이라 (층, 호실)로는 그 줄을 못 집는다
        rid = await pool().fetchval(
            """UPDATE app.floor_rents
                  SET floor=$3, unit_no=$4, use=$5, contract_area=$6, deposit=$7, rent=$8,
                      maintenance=$9, tenant_name=$10, deleted_at=NULL, updated_at=now()
                WHERE id=$11 AND building_pk=$1 AND team_id=$2
            RETURNING id""",
            building_pk, user.team_id, body.floor, body.unit_no, body.use, body.contract_area,
            body.deposit, body.rent, body.maintenance, body.tenant_name, body.id)
        if rid is not None:
            await listing_values_fold(user.team_id, building_pk)
            return {"ok": True, "id": rid}
    # 호실을 적은 줄은 (층, 호실)로 upsert — 같은 호실을 두 번 만들지 않는다. 빈 호실은 그냥 새 줄이다
    rid = await pool().fetchval(
        """INSERT INTO app.floor_rents
             (building_pk,team_id,floor,unit_no,use,contract_area,
              deposit,rent,maintenance,tenant_name)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (building_pk,team_id,floor,unit_no) WHERE unit_no <> ''
           DO UPDATE SET use=EXCLUDED.use,
             contract_area=EXCLUDED.contract_area, deposit=EXCLUDED.deposit,
             rent=EXCLUDED.rent, maintenance=EXCLUDED.maintenance,
             tenant_name=EXCLUDED.tenant_name,
             deleted_at=NULL, updated_at=now()
           RETURNING id""",
        building_pk, user.team_id, body.floor, body.unit_no, body.use,
        body.contract_area,
        body.deposit, body.rent, body.maintenance, body.tenant_name,
    )
    await listing_values_fold(user.team_id, building_pk)     # 층별 → 매물 줄 합계·수익률(0173)
    return {"ok": True, "id": rid}


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
        # 공실면적도 팀이 적은 값이다. 대장 구조로 되돌리면 같이 지운다
        await conn.execute(
            "DELETE FROM app.floor_vacancy WHERE building_pk=$1 AND team_id=$2",
            building_pk, user.team_id)
    await listing_values_fold(user.team_id, building_pk)
    return {"ok": True, "cleared": n}


@router.put("/vacancy")
async def set_vacancy(building_pk: str, body: VacancyIn, user: CurrentUser = Depends(current_user)):
    """층 하나의 공실면적. 비우면(None) 그 층 기록을 지운다 — 모름으로 돌아간다([[clear-means-null]]).
    층은 이름이 아니라 서명층수로 잇는다. 「3」·「3층」·「3F」가 한 층이어야 한다."""
    floor = _norm_floor(body.floor)[0] or body.floor
    fno = _signed_floor(floor)
    if fno is None:
        from fastapi import HTTPException
        raise HTTPException(422, f"층을 못 읽었습니다: {body.floor}")
    if body.vacant_area is None:
        await pool().execute(
            "DELETE FROM app.floor_vacancy WHERE team_id=$1 AND building_pk=$2 AND floor_no=$3",
            user.team_id, building_pk, fno)
    else:
        await pool().execute(
            """INSERT INTO app.floor_vacancy(team_id, building_pk, floor_no, floor, vacant_area, updated_by)
               VALUES($1,$2,$3,$4,$5,$6)
               ON CONFLICT (team_id, building_pk, floor_no)
               DO UPDATE SET vacant_area=EXCLUDED.vacant_area, floor=EXCLUDED.floor,
                             updated_by=EXCLUDED.updated_by, updated_at=now()""",
            user.team_id, building_pk, fno, floor, max(0.0, body.vacant_area), user.account_id)
    await listing_values_fold(user.team_id, building_pk)     # 매물 줄 공실면적(층 합)
    return {"ok": True}


@router.delete("/{rent_id}")
async def delete_rent(building_pk: str, rent_id: int, user: CurrentUser = Depends(current_user)):
    await pool().execute(
        """UPDATE app.floor_rents SET deleted_at=now()
           WHERE id=$1 AND building_pk=$2 AND team_id=$3""",
        rent_id, building_pk, user.team_id,
    )
    await listing_values_fold(user.team_id, building_pk)
    return {"ok": True}
