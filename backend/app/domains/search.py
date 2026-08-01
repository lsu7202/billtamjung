"""검색: 주소 자동완성 + 2열 목록(내매물/일반) + 영역(폴리곤) 검색.
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
    """S01b 속성 필터 — master.buildings 컬럼 매핑 필드. None/빈리스트=미적용.
    (UI엔 60필드지만 여기 없는 건 app레이어/미보유라 서버 필터 미지원 — 점진 확장)"""
    bjd_code: str | None = None       # 법정동(prefix: 구=5자리·동=10자리)
    # 다중선택(= ANY)
    use_zones: list[str] | None = None       # 용도지역
    jimoks: list[str] | None = None          # 지목
    road_frontages: list[str] | None = None  # 도로접면
    shapes: list[str] | None = None          # 지형형상
    slopes: list[str] | None = None          # 지세
    land_uses: list[str] | None = None       # 토지이용상황(land_use) — 값=명(상업용·단독 등)
    main_uses: list[str] | None = None       # 주용도(코드 저장 — 매핑 전까지 미연결)
    etc_use: str | None = None               # 기타용도(부분일치)
    # 범위 (min/max)
    land_area_min: float | None = None
    land_area_max: float | None = None
    total_area_min: float | None = None
    total_area_max: float | None = None
    build_area_min: float | None = None
    build_area_max: float | None = None
    floors_above_min: int | None = None
    floors_above_max: int | None = None
    floors_below_min: int | None = None
    floors_below_max: int | None = None
    bcr_min: float | None = None
    bcr_max: float | None = None
    far_min: float | None = None
    far_max: float | None = None
    elevator_min: int | None = None
    elevator_max: int | None = None
    parking_min: int | None = None
    parking_max: int | None = None
    station_dist_max: int | None = None
    last_sale_min: int | None = None         # 실거래가(원)
    last_sale_max: int | None = None
    last_sale_years_min: int | None = None   # 실거래일(최근 N년) — 사용승인일과 동일 시맨틱
    last_sale_years_max: int | None = None
    gongsi_min: int | None = None            # 최신 공시지가(원/㎡)
    gongsi_max: int | None = None
    age_min: int | None = None               # 연식(년) — 사용승인일 기준
    age_max: int | None = None


class SearchIn(BaseModel):
    polygon: dict | None = None       # GeoJSON — 있으면 지역범위 대체(§3.6c)
    filters: Filters = Filters()
    sort: str = "price"               # price|roi|addr
    fav_only: bool = False            # 즐겨찾기 빠른 필터(§3.2a)
    page_mine: int = 1                # 열별 독립 페이징(§3.4)
    page_normal: int = 1
    per_page: int = 20


class SnapIn(BaseModel):
    polygon: dict                     # GeoJSON — 손으로 그린 영역


@router.post("/snap")
async def snap_parcels(body: SnapIn, _: CurrentUser = Depends(current_user)):
    """자석 올가미(후처리): 그린 영역에 걸치는 필지 합집합으로 스냅 → 필지 경계 정합 폴리곤 반환.
    specs S01 §3.6c(영역 그리기)·기능목록 §2(자석 스냅 후처리). parcels_v2 GiST 인덱스 사용."""
    gj = await pool().fetchval(
        """SELECT ST_AsGeoJSON(ST_Union(p.geom))
           FROM master.parcels p
           WHERE ST_Intersects(p.geom, ST_MakeValid(ST_GeomFromGeoJSON($1::text)))""",
        json.dumps(body.polygon),
    )
    return {"polygon": json.loads(gj) if gj else None}


@router.get("/parcel-at")
async def parcel_at_point(lng: float, lat: float, _: CurrentUser = Depends(current_user)):
    """클릭 지점을 포함하는 필지 1건 → building_pk. 지적도 전체 로드 없이 클릭 시에만 조회.
    ST_Contains(&& GiST 선행). 색칠은 building_pk로 /parcel/{pk} 조회."""
    row = await pool().fetchrow(
        """SELECT building_pk, pnu FROM master.parcels
           WHERE geom && ST_SetSRID(ST_MakePoint($1, $2), 4326)
             AND ST_Contains(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
           LIMIT 1""",
        lng, lat,
    )
    return {"building_pk": row["building_pk"], "pnu": row["pnu"]} if row else {"building_pk": None, "pnu": None}


@router.get("/parcel/{building_pk}")
async def parcel_for_building(building_pk: str, _: CurrentUser = Depends(current_user)):
    """한 건물의 필지 합집합(선택 시 분류색 오버레이용). 멀티필지는 union."""
    gj = await pool().fetchval(
        "SELECT ST_AsGeoJSON(ST_Union(geom)) FROM master.parcels WHERE building_pk=$1",
        building_pk,
    )
    return {"polygon": json.loads(gj) if gj else None}


def _filter_sql(f: Filters, args: list) -> str:
    """속성 필터 → WHERE 절. args에 파라미터 추가."""
    conds = []
    def add(cond: str, val):
        args.append(val)
        conds.append(cond.format(i=len(args)))
    def rng(col: str, lo, hi):
        if lo is not None: add(f"b.{col} >= ${{i}}", lo)
        if hi is not None: add(f"b.{col} <= ${{i}}", hi)
    def anyof(col: str, vals):
        if vals: add(f"b.{col} = ANY(${{i}})", vals)

    if f.bjd_code:
        add("b.bjd_code LIKE ${i} || '%'", f.bjd_code)
    anyof("use_zone", f.use_zones)
    anyof("jimok", f.jimoks)
    anyof("road_frontage", f.road_frontages)
    anyof("shape", f.shapes)
    anyof("slope", f.slopes)
    anyof("land_use", f.land_uses)
    anyof("main_use", f.main_uses)
    if f.etc_use:
        add("b.etc_use ILIKE '%' || ${i} || '%'", f.etc_use)
    rng("land_area", f.land_area_min, f.land_area_max)
    rng("total_area", f.total_area_min, f.total_area_max)
    rng("build_area", f.build_area_min, f.build_area_max)
    rng("floors_above", f.floors_above_min, f.floors_above_max)
    rng("floors_below", f.floors_below_min, f.floors_below_max)
    rng("bcr", f.bcr_min, f.bcr_max)
    rng("far", f.far_min, f.far_max)
    rng("elevator", f.elevator_min, f.elevator_max)
    rng("parking", f.parking_min, f.parking_max)
    if f.station_dist_max is not None:
        add("b.station_dist <= ${i}", f.station_dist_max)
    rng("last_sale_price", f.last_sale_min, f.last_sale_max)
    # 실거래일(최근 N년): last_sale_ym 'YYYYMM' ≥ 오늘−N년. NULL(실거래 없음)은 자동 제외.
    if f.last_sale_years_max is not None:
        add("b.last_sale_ym >= to_char(CURRENT_DATE - make_interval(years => ${i}), 'YYYYMM')", f.last_sale_years_max)
    if f.last_sale_years_min is not None:
        add("b.last_sale_ym <= to_char(CURRENT_DATE - make_interval(years => ${i}), 'YYYYMM')", f.last_sale_years_min)
    rng("gongsi_latest", f.gongsi_min, f.gongsi_max)
    # 연식(년): approval_ymd 기준. age≤max → 지은지 max년 이내 → approval_ymd ≥ 오늘-max년
    if f.age_max is not None:
        add("b.approval_ymd >= (CURRENT_DATE - make_interval(years => ${i}))", f.age_max)
    if f.age_min is not None:
        add("b.approval_ymd <= (CURRENT_DATE - make_interval(years => ${i}))", f.age_min)
    return (" AND " + " AND ".join(conds)) if conds else ""


def _build_base(body: SearchIn, user: CurrentUser) -> tuple[str, list]:
    """3열 분류 CTE(classified) + args 구성 — search(페이징)·pins(전체) 공용."""
    args: list = [user.team_id]
    poly_sql = ""
    if body.polygon:
        args.append(json.dumps(body.polygon))
        poly_sql = f" AND ST_Within(b.geom, ST_MakeValid(ST_GeomFromGeoJSON(${len(args)}::text)))"
    filt_sql = _filter_sql(body.filters, args)
    args.append(user.account_id)   # 즐겨찾기 조인용
    acct_i = len(args)
    fav_join = f"LEFT JOIN app.favorites fv ON fv.building_pk=b.building_pk AND fv.account_id=${acct_i}"
    fav_where = "AND fv.building_pk IS NOT NULL" if body.fav_only else ""

    base = f"""
      WITH team_rent AS (   -- 팀 층별임대 합계(수익률 추정용, S01 §3.5)
        SELECT building_pk, SUM(rent) AS monthly_rent
        FROM app.floor_rents
        WHERE team_id = $1 AND deleted_at IS NULL AND rent IS NOT NULL
        GROUP BY building_pk
      ),
      sale_ov AS (     -- 팀 수기 매매가(sale_price 오버레이) — 매매가 소스(실거래 아님)
        SELECT target_id AS building_pk, value::bigint AS sale_price
        FROM app.overlays
        WHERE team_id = $1 AND target_type = 'building' AND field = 'sale_price' AND value ~ '^[0-9]+$'
      ),
      classified AS (
        SELECT b.building_pk, b.addr, b.land_area, b.total_area,
               b.floors_above, b.floors_below, b.use_zone, b.land_use,
               ST_X(b.geom) AS lng, ST_Y(b.geom) AS lat,
               b.last_sale_price, b.last_sale_ym,
               se.sale_est,
               l.assignee_account_id,
               (fv.building_pk IS NOT NULL) AS is_fav,
               CASE
                 WHEN l.assignee_account_id IS NOT NULL THEN 'mine'
                 ELSE 'normal'
               END AS col,
               -- 매매가 = 팀 수기값(sale_price). 실거래가는 매매가가 아님 → 제외.
               so.sale_price AS price,
               -- 수익률(추정) = 연임대료 / (매매가, 없으면 실거래로 추정)
               CASE
                 WHEN tr.monthly_rent IS NOT NULL AND COALESCE(so.sale_price, b.last_sale_price) > 0
                 THEN round((tr.monthly_rent * 12.0)
                            / COALESCE(so.sale_price, b.last_sale_price) * 100, 2)
                 ELSE NULL
               END AS roi
        FROM master.buildings b
        LEFT JOIN sale_ov so ON so.building_pk = b.building_pk
        LEFT JOIN master.building_sale_est se ON se.building_pk = b.building_pk
        LEFT JOIN team_rent tr ON tr.building_pk = b.building_pk
        LEFT JOIN app.listings l
          ON l.building_pk = b.building_pk AND l.team_id = $1
             AND l.assignee_account_id IS NOT NULL
        {fav_join}
        WHERE TRUE {poly_sql} {filt_sql} {fav_where}
      )
    """
    return base, args


@router.post("")
async def search(body: SearchIn, user: CurrentUser = Depends(current_user)):
    """2열 목록(내매물/일반) + 열별 독립 페이징. 무크레딧.

    분류(§3.4·상태 종속): 내매물 = 팀 담당자 지정 · 일반 = 나머지.
    매매가(§3.5): 내매물=팀 수기 sale_price / 일반=NULL(후순위).
    """
    base, args = _build_base(body, user)
    # 정렬 = 매매가순 / 수익률순만(S01 §3.3). 값 없는 항목은 후순위(NULLS LAST).
    order = {
        "price": "price DESC NULLS LAST, addr",
        "roi": "roi DESC NULLS LAST, price DESC NULLS LAST",
    }.get(body.sort, "price DESC NULLS LAST, addr")

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
        "mine": await col("mine", body.page_mine),
        "normal": await col("normal", body.page_normal),
    }


@router.post("/pins")
async def pins(body: SearchIn, user: CurrentUser = Depends(current_user)):
    """지도 핀 — 페이징 없이 조건에 맞는 매물(경량: 좌표·분류·가격).
    프론트가 뷰포트 컬링(화면 안 핀만 렌더)하므로 넉넉히 반환하되, 3000개 상한(응답 크기·극단 방지).
    가격 있는 매물 우선(NULLS LAST) → 상한에 걸려도 유의미한 핀부터."""
    base, args = _build_base(body, user)
    rows = await pool().fetch(
        base + """SELECT building_pk, addr, lng, lat, col, price, roi,
                         last_sale_price, sale_est, land_use, is_fav
                  FROM classified WHERE lng IS NOT NULL
                  ORDER BY price DESC NULLS LAST, building_pk LIMIT 3000""",
        *args,
    )
    return [dict(r) for r in rows]
