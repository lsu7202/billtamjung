"""검색: 주소 자동완성 + 영역(폴리곤) 검색. specs S01 §3.1a·§3.6c."""
import json
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from ..core.db import pool
from ..core.deps import current_user, CurrentUser

router = APIRouter(prefix="/search", tags=["search"])


class Suggestion(BaseModel):
    building_pk: str
    addr: str


@router.get("/suggest", response_model=list[Suggestion])
async def suggest(q: str = Query(min_length=1), _: CurrentUser = Depends(current_user)):
    """통합뷰 주소 인덱스 접두검색(외부 지오코딩 미사용). 상위 7건."""
    norm = q.replace(" ", "")
    rows = await pool().fetch(
        """SELECT building_pk, addr FROM master.buildings
           WHERE jibun_norm LIKE $1 || '%' OR jibun_norm LIKE '%' || $1 || '%'
           ORDER BY (jibun_norm LIKE $1 || '%') DESC, addr
           LIMIT 7""",
        norm,
    )
    return [Suggestion(building_pk=r["building_pk"], addr=r["addr"]) for r in rows]


class PolygonSearchIn(BaseModel):
    polygon: dict | None = None   # GeoJSON Polygon
    # 속성 필터는 향후 확장(면적·가격 등) — 레지스트리 searchable 기반
    limit: int = 200


class BuildingHit(BaseModel):
    building_pk: str
    addr: str


@router.post("", response_model=list[BuildingHit])
async def search(body: PolygonSearchIn, _: CurrentUser = Depends(current_user)):
    """polygon 있으면 ST_Within 영역검색. 무크레딧."""
    if body.polygon:
        rows = await pool().fetch(
            "SELECT building_pk, addr FROM app.search_polygon($1::jsonb) LIMIT $2",
            json.dumps(body.polygon), body.limit,
        )
    else:
        rows = await pool().fetch(
            "SELECT building_pk, addr FROM master.buildings LIMIT $1", body.limit
        )
    return [BuildingHit(building_pk=r["building_pk"], addr=r["addr"]) for r in rows]
