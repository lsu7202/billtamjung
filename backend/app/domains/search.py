"""검색: 주소 자동완성 + 3열 목록(광고/내매물/일반) + 영역(폴리곤) 검색.
specs S01 §3.1a(자동완성)·§3.4(3열·열별 페이징)·§3.5(표시값)·§3.6c(영역).
"""
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


_regions_cache: dict = {}   # master_version 키 캐시(적재 시에만 변함)


@router.get("/regions")
async def regions(_: CurrentUser = Depends(current_user)):
    """구·법정동 목록(3단 캐스케이드용). master 버전별 인메모리 캐시."""
    ver = await pool().fetchval("SELECT version FROM master.master_version")
    if ver in _regions_cache:
        return _regions_cache[ver]
    rows = await pool().fetch(
        """SELECT sgg_code, bjd_code,
                  split_part(addr,' ',2) AS gu, split_part(addr,' ',3) AS dong,
                  count(*) AS cnt
           FROM master.buildings
           WHERE sgg_code IS NOT NULL AND bjd_code IS NOT NULL
           GROUP BY 1,2,3,4 ORDER BY 3,4"""
    )
    out: dict[str, dict] = {}
    for r in rows:
        gu = out.setdefault(r["gu"], {"sgg_code": r["sgg_code"], "dongs": []})
        gu["dongs"].append({"bjd_code": r["bjd_code"], "dong": r["dong"], "count": r["cnt"]})
    _regions_cache.clear()
    _regions_cache[ver] = out
    return out


class Filters(BaseModel):
    """S01b 속성 필터(베타 핵심 부분집합). None=미적용."""
    bjd_code: str | None = None       # 법정동(prefix 매칭: 구=5자리, 동=10자리)
    use_zone: str | None = None       # 용도지역
    main_use: str | None = None       # 주용도 코드
    land_area_min: float | None = None
    land_area_max: float | None = None
    total_area_min: float | None = None
    total_area_max: float | None = None
    floors_above_min: int | None = None
    floors_above_max: int | None = None
    station_dist_max: int | None = None


class SearchIn(BaseModel):
    polygon: dict | None = None       # GeoJSON — 있으면 지역범위 대체(§3.6c)
    filters: Filters = Filters()
    sort: str = "price"               # price|roi|addr
    fav_only: bool = False            # 즐겨찾기 빠른 필터(§3.2a)
    page_ad: int = 1                  # 열별 독립 페이징(§3.4)
    page_mine: int = 1
    page_normal: int = 1
    per_page: int = 20


def _filter_sql(f: Filters, args: list) -> str:
    """속성 필터 → WHERE 절. args에 파라미터 추가."""
    conds = []
    def add(cond: str, val):
        args.append(val)
        conds.append(cond.format(i=len(args)))
    if f.bjd_code:
        add("b.bjd_code LIKE ${i} || '%'", f.bjd_code)
    if f.use_zone:
        add("b.use_zone = ${i}", f.use_zone)
    if f.main_use:
        add("b.main_use = ${i}", f.main_use)
    if f.land_area_min is not None:
        add("b.land_area >= ${i}", f.land_area_min)
    if f.land_area_max is not None:
        add("b.land_area <= ${i}", f.land_area_max)
    if f.total_area_min is not None:
        add("b.total_area >= ${i}", f.total_area_min)
    if f.total_area_max is not None:
        add("b.total_area <= ${i}", f.total_area_max)
    if f.floors_above_min is not None:
        add("b.floors_above >= ${i}", f.floors_above_min)
    if f.floors_above_max is not None:
        add("b.floors_above <= ${i}", f.floors_above_max)
    if f.station_dist_max is not None:
        add("b.station_dist <= ${i}", f.station_dist_max)
    return (" AND " + " AND ".join(conds)) if conds else ""


@router.post("")
async def search(body: SearchIn, user: CurrentUser = Depends(current_user)):
    """3열 목록(광고/내매물/일반) + 열별 독립 페이징. 무크레딧.

    분류(§3.4·상태 종속): 광고 = 최신 광고가 존재 · 내매물 = 팀 담당자 지정 · 일반 = 나머지.
    매매가(§3.5): 광고=광고가 / 내매물=광고가|최근매각 / 일반=추정 매각가(없으면 NULL→후순위).
    """
    args: list = [user.team_id]
    poly_sql = ""
    if body.polygon:
        args.append(json.dumps(body.polygon))
        poly_sql = f" AND ST_Within(b.geom, ST_MakeValid(ST_GeomFromGeoJSON(${len(args)}::text)))"
    filt_sql = _filter_sql(body.filters, args)
    order = {"price": "price DESC NULLS LAST", "roi": "price ASC NULLS LAST", "addr": "addr"}.get(body.sort, "price DESC NULLS LAST")
    args.append(user.account_id)   # 즐겨찾기 조인용
    acct_i = len(args)
    fav_join = f"LEFT JOIN app.favorites fv ON fv.building_pk=b.building_pk AND fv.account_id=${acct_i}"
    fav_where = "AND fv.building_pk IS NOT NULL" if body.fav_only else ""

    base = f"""
      WITH latest_ad AS (
        SELECT DISTINCT ON (building_pk) building_pk, price
        FROM app.ad_prices WHERE deleted_at IS NULL
        ORDER BY building_pk, observed_on DESC
      ),
      classified AS (
        SELECT b.building_pk, b.addr, b.land_area, b.total_area,
               b.floors_above, b.floors_below, b.use_zone,
               ST_X(b.geom) AS lng, ST_Y(b.geom) AS lat,
               b.last_sale_price, b.last_sale_ym,
               la.price AS ad_price,
               l.assignee_account_id,
               (fv.building_pk IS NOT NULL) AS is_fav,
               CASE
                 WHEN la.price IS NOT NULL THEN 'ad'
                 WHEN l.assignee_account_id IS NOT NULL THEN 'mine'
                 ELSE 'normal'
               END AS col,
               CASE
                 WHEN la.price IS NOT NULL THEN la.price
                 ELSE b.last_sale_price          -- sales.금액 = 원 단위
               END AS price
        FROM master.buildings b
        LEFT JOIN latest_ad la ON la.building_pk = b.building_pk
        LEFT JOIN app.listings l
          ON l.building_pk = b.building_pk AND l.team_id = $1
             AND l.assignee_account_id IS NOT NULL
        {fav_join}
        WHERE TRUE {poly_sql} {filt_sql} {fav_where}
      )
    """

    async def col(name: str, page: int):
        off = (page - 1) * body.per_page
        rows = await pool().fetch(
            base + f"""SELECT *, count(*) OVER() AS total FROM classified
                       WHERE col = '{name}' ORDER BY {order}
                       LIMIT {body.per_page} OFFSET {off}""",
            *args,
        )
        total = rows[0]["total"] if rows else 0
        items = [
            {k: v for k, v in dict(r).items() if k != "total"} for r in rows
        ]
        return {"items": items, "total": total, "page": page,
                "pages": max(1, -(-total // body.per_page))}

    return {
        "ad": await col("ad", body.page_ad),
        "mine": await col("mine", body.page_mine),
        "normal": await col("normal", body.page_normal),
    }
