"""임대 내역(내 매물) — 팀 호실 줄. 건물 상세의 층별 정보(floors.py, 대장·원장)와 나뉜다(2026-09-26 대표).

호실 = 업체 단위 한 줄. 상태는 저장하지 않는다 — app.unit_occupied(상호·원장 열쇠·임대료)로 판다.
층을 모르면 floor=null(층 미상). 매물 등록 때 원장 업체를 한 번 복사해 둔다(seed_from_ledger).
그 뒤로는 원장이 바뀌어도 따라가지 않는다 — 이 표는 중개사가 확인한 기록이다.

줄 하나 = 매물(listing_id) × 동(building_pk)의 층 하나(0255). 층은 동의 것이라 경로는 동 번호, 매물은 listing_id 로 받는다.
그 동이 매물의 지번 위 동이어야 쓴다."""
from fastapi import HTTPException
from .listing_core import need_listing
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from ..core.db import pool, tx
from ..core.floor_label import normalize as _norm_floor
from ..core.deps import current_user, CurrentUser
from .mirror import listing_values_fold
from .tenants import biz_for, norm_name, tenant_ledger

router = APIRouter(prefix="/buildings/{building_pk}/floor-rents", tags=["floor-rents"])

# 층 파싱은 core/floor_label 하나만 쓴다(2026-08-29).
# 여기 있던 _signed_floor 는 「지하」 두 글자만 지하로 봤다. 대장 표기는 「지1층」·「지1」·「지층」이
# 훨씬 많아서(37만건) 지하가 지상으로 뒤집혀 읽혔고, 층 매칭이 통째로 어긋났다.
# 저장할 때는 이미 정규화를 거치는데(_norm_floor) 읽을 때만 옛 함수를 쓰고 있었다.


class RentIn(BaseModel):
    id: int | None = None     # 있으면 그 줄을 고친다(0160). 호실이 빈 줄은 여럿이라 (층, 호실)로는 못 찾는다
    floor: str | None = None  # None = 층 미상(0185). 층 칩으로 옮기면 여기가 찬다
    unit_no: str = ""         # 모르면 빈칸 — 순번을 지어 넣지 않는다
    contract_area: float | None = None     # ㎡ 저장(§5.3) — 프론트가 평↔㎡ 변환해 항상 ㎡로 전송
    excl_area: float | None = None         # 전용면적 ㎡(0190). 보는 값 — 공실·평당가 셈은 계약면적
    cat_nodes: list[str] | None = None     # 업종 나무(0189) — 고르기 목록(/biz-cats)의 경로
    deposit: int | None = None     # 원 정수. None = 모름(0185 — 0 은 「안 받음」과 헷갈려 기본값에서 뺐다)
    rent: int | None = None
    maintenance: int | None = None
    # 상태 칸은 없다(0185). 상호가 있거나 임대료가 적혀 있으면 임대중, 둘 다 없으면 공실이다
    tenant_name: str | None = None   # 상호명(0155) — 모르면 null
    place_ref: str | None = None     # 원장에서 복사한 업체의 열쇠. 고칠 때 그대로 돌려보낸다
    vacant: bool = False             # 공실 체크(0208) — 체크 = 공실, 업체 있음 = 임대중, 둘 다 아님 = 모름


async def _dong_of_listing(listing_id: int, building_pk: str) -> None:
    """그 동이 매물의 지번 위 동인가 — 아니면 그 매물의 임대 줄로 적을 수 없다"""
    ok = await pool().fetchval(
        """SELECT 1 FROM master.buildings b JOIN app.listing_parcels lp ON lp.pnu = b.pnu
            WHERE lp.listing_id = $1 AND b.building_pk = $2""", listing_id, building_pk)
    if not ok:
        raise HTTPException(422, "이 매물의 땅 위 건물이 아닙니다")


async def team_floor_rows(building_pk: str, listing_id: int) -> list[dict]:
    """팀 층별 줄. 층 숨기기(floor_hidden)는 2026-10-07 에 뺐다 — 숨기는 화면이 없었다."""
    rows = await pool().fetch(
        """SELECT id, floor, unit_no, contract_area::float AS contract_area, excl_area::float AS excl_area,
                  deposit, rent, maintenance, tenant_name, place_ref, cat_nodes, vacant,
                  app.unit_occupied(tenant_name, place_ref, rent) AND NOT vacant AS occupied
           FROM app.floor_rents
           WHERE building_pk=$1 AND listing_id=$2 AND deleted_at IS NULL
           -- 순서(2026-09-04): 1층부터 위로, 옥탑, 그 아래 지하. 예) 1층 2층 3층 옥탑1층 지하1층
           ORDER BY (CASE WHEN floor LIKE '%옥탑%' OR floor ~* '^\\s*(PH|R)' THEN 1000
                          WHEN floor LIKE '지하%' OR floor LIKE '지%' OR floor ~* '^\\s*B' THEN 2000 ELSE 0 END)
                    + COALESCE(NULLIF(regexp_replace(floor, '\\D', '', 'g'), '')::int, 0) ASC, unit_no""",
        building_pk, listing_id,
    )
    return [dict(r) for r in rows]


@router.get("", openapi_extra={"x-ai": "read"})   # AI 가 부를 수 있다 — 우리 매물의 임대 내역
async def list_rents(building_pk: str, listing_id: int, user: CurrentUser = Depends(current_user)):
    """임대 내역 — 대장 층 뼈대 위에 팀 호실 줄을 층별로 묶는다.

    floors  : [{floor, units[]}]  1층부터 위로 · 옥탑 · 지하. 호실이 없는 대장 층도 선다(「+ 호실」 자리)
              층마다 붙던 바닥면적·공실면적·월 임대료·추정 월 임대료는 뺐다(2026-09-27 대표)
    unknown : 층 미상 호실(floor=null)
    items   : 호실 평평하게 · total: 돈 적힌 줄의 합과 공실면적(매물 줄에 접는 값과 같다)"""
    from .floors import _frank, _sfloor           # 층 순서·같은 층 판정은 층별 정보와 한 규칙
    await need_listing(user.team_id, listing_id)
    items = await team_floor_rows(building_pk, listing_id)
    label: dict[int, str] = {}
    for r in [*(await pool().fetch(
            "SELECT DISTINCT floor FROM master.floor_outline WHERE building_pk=$1 AND floor IS NOT NULL",
            building_pk)), *items]:
        sf = _sfloor(r["floor"])
        if sf is not None:
            label.setdefault(sf, r["floor"])
    floors = [{"floor": label[sf], "units": [r for r in items if _sfloor(r["floor"]) == sf]}
              for sf in sorted(label, key=lambda k: _frank(label[k]))]
    unknown = [r for r in items if r["floor"] is None]
    money = [r for r in items if any(r[k] for k in ("rent", "deposit", "maintenance"))]
    total = {
        "deposit": sum(r["deposit"] or 0 for r in money) if money else None,
        "rent": sum(r["rent"] or 0 for r in money) if money else None,
        "maintenance": sum(r["maintenance"] or 0 for r in money) if money else None,
        # 매물 줄과 같은 함수 — 적힌 공실 호실의 합(0186 · 매물의 모든 동)
        "vacant_area": await pool().fetchval("SELECT app.listing_vacancy($1)::float", listing_id),
    }
    return {"floors": floors, "unknown": unknown, "items": items, "total": total}


async def seed_from_ledger(team_id: int, listing_id: int) -> int:
    """매물 등록 때 **지금 있는 업체**를 호실 줄로 한 번 복사한다(0185 · 2026-09-27 크롤링으로).

    원천은 층별 정보와 같다 — 크롤링(master.biz)을 수집한 건물이면 그것, 아니면 원장(인허가·상가정보).
    이미 호실 줄이 하나라도 있으면(지운 줄 포함) 아무것도 안 한다 — 팀이 손댄 기록을 덮지 않는다.
    임대료·보증금·면적은 비운다. 영업장면적은 계약면적이 아니다(2026-09-25).
    업체는 지번의 동 목록 전체에 걸려 있어 동마다 복사하면 겹친다 — 매물 지번의 대표 동 하나에만 복사한다."""
    building_pk = await pool().fetchval(
        """SELECT r.rep_pk FROM app.listing_parcels lp JOIN master.parcel_rep r ON r.pnu = lp.pnu
            WHERE lp.listing_id = $1 AND lp.main""", listing_id)
    if building_pk is None:
        return 0                                  # 나대지 — 층이 없다
    # 대표 동에 줄이 하나라도 있으면(지운 줄 포함) 안 한다. 다른 동의 줄은 상관없다(초기화가 동마다다)
    if await pool().fetchval("SELECT 1 FROM app.floor_rents WHERE listing_id=$1 AND building_pk=$2 LIMIT 1",
                             listing_id, building_pk):
        return 0
    got = await biz_for(building_pk)
    rows = []
    for t in (got["items"] if got is not None else await tenant_ledger(building_pk)):
        key = norm_name(t["name"])
        if not key:
            continue
        fl = (_norm_floor(t["floor"])[0] or t["floor"]) if t.get("floor") else None
        rows.append((building_pk, listing_id, fl, t["name"], key, t.get("cat_nodes")))
    if rows:
        await pool().executemany(
            """INSERT INTO app.floor_rents(building_pk, listing_id, floor, unit_no, tenant_name, place_ref, cat_nodes)
               VALUES($1,$2,$3,'',$4,$5,$6)
               ON CONFLICT (team_id, building_pk, place_ref) WHERE place_ref IS NOT NULL DO NOTHING""", rows)
        await listing_values_fold(listing_id)
    return len(rows)









@router.put("")
async def upsert_rent(building_pk: str, listing_id: int, body: RentIn, user: CurrentUser = Depends(current_user)):
    """호실 한 줄 upsert. id 가 있으면 그 줄을, 없으면 새 줄(호수를 적었으면 (층, 호수)로 합친다).
    상호도 임대료도 없는 줄은 공실 호실이다(0185).
    층 표기는 대장과 같은 규칙으로 정규화한다(0031) — '3F'로 치고 대장이 '3층'이면 다른 층이 돼
    추정이 안 빠지고 이중 계산된다."""
    await need_listing(user.team_id, listing_id)   # 등록한 매물에만 적는다(0226)
    await _dong_of_listing(listing_id, building_pk)
    if body.floor is not None and body.floor.strip():
        body.floor = _norm_floor(body.floor)[0] or body.floor
    else:
        body.floor = None                                  # 층 미상
    body.unit_no = (body.unit_no or "").strip()
    if body.id is not None:
        # 줄을 id 로 고친다(0160). 호실이 빈 줄이 한 층에 여럿이라 (층, 호실)로는 그 줄을 못 집는다
        rid = await pool().fetchval(
            """UPDATE app.floor_rents
                  SET floor=$3, unit_no=$4, contract_area=$5, excl_area=$6, deposit=$7, rent=$8,
                      maintenance=$9, tenant_name=$10, cat_nodes=$12, vacant=$13, deleted_at=NULL, updated_at=now()
                WHERE id=$11 AND building_pk=$1 AND listing_id=$2
            RETURNING id""",
            building_pk, listing_id, body.floor, body.unit_no, body.contract_area, body.excl_area,
            body.deposit, body.rent, body.maintenance, body.tenant_name, body.id, body.cat_nodes or None, body.vacant)
        if rid is not None:
            await listing_values_fold(listing_id)
            return {"ok": True, "id": rid}
    # 호실을 적은 줄은 (층, 호실)로 upsert — 같은 호실을 두 번 만들지 않는다. 빈 호실은 그냥 새 줄이다
    rid = await pool().fetchval(
        """INSERT INTO app.floor_rents
             (building_pk,listing_id,floor,unit_no,contract_area,excl_area,
              deposit,rent,maintenance,tenant_name,cat_nodes,vacant)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (building_pk,team_id,floor,unit_no) WHERE unit_no <> ''
           DO UPDATE SET excl_area=EXCLUDED.excl_area, cat_nodes=EXCLUDED.cat_nodes,
             contract_area=EXCLUDED.contract_area, deposit=EXCLUDED.deposit,
             rent=EXCLUDED.rent, maintenance=EXCLUDED.maintenance,
             tenant_name=EXCLUDED.tenant_name, vacant=EXCLUDED.vacant,
             deleted_at=NULL, updated_at=now()
           RETURNING id""",
        building_pk, listing_id, body.floor, body.unit_no,
        body.contract_area, body.excl_area,
        body.deposit, body.rent, body.maintenance, body.tenant_name, body.cat_nodes or None, body.vacant,
    )
    await listing_values_fold(listing_id)     # 층별 → 매물 줄 합계·수익률(0173)
    return {"ok": True, "id": rid}




@router.post("/reset")
async def reset_rents(building_pk: str, listing_id: int, user: CurrentUser = Depends(current_user)):
    """초기화(10-02 대표) — 첫 상태로. **고른 동의** 팀 줄을 완전히 지우고, 대표 동이면 원장 업체를 다시 복사한다.
    DELETE "" 는 줄을 숨김(deleted_at)만 해서 seed_from_ledger 가 「이미 줄이 있다」고 보고 다시 복사하지 않는다."""
    await need_listing(user.team_id, listing_id)   # 등록한 매물에만 적는다(0226)
    await _dong_of_listing(listing_id, building_pk)
    async with tx() as conn:
        await conn.execute("DELETE FROM app.floor_rents WHERE listing_id=$1 AND building_pk=$2", listing_id, building_pk)
    n = await seed_from_ledger(user.team_id, listing_id)
    await listing_values_fold(listing_id)
    return {"ok": True, "seeded": n}


@router.delete("/{rent_id}")
async def delete_rent(building_pk: str, rent_id: int, listing_id: int, user: CurrentUser = Depends(current_user)):
    await need_listing(user.team_id, listing_id)   # 등록한 매물에만 적는다(0226)
    await pool().execute(
        "UPDATE app.floor_rents SET deleted_at=now() WHERE id=$1 AND building_pk=$2 AND listing_id=$3",
        rent_id, building_pk, listing_id,
    )
    await listing_values_fold(listing_id)
    return {"ok": True}
