"""주변시세(S03): 반경 내 전 팀 임대 comps + 매각 comps. 원본 나열·이상치 플래그.
specs S03 · 01-상세설계 §3.3. '저장은 사적, 조회는 공용'(F-01 B안).
"""
import json
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
    polygon: dict | None = None      # GeoJSON — 있으면 반경 대신 이 영역으로 필터(지도 직접 그리기)
    building_pk: str | None = None   # 본매물 — 주변 comps에서 제외
    floors: list[str] = []           # 본매물 층 — 임대 미입력 후보를 이 층 기준으로 노출
    floor_from: int = -1     # 지하1
    floor_to: int = 5        # 지상5
    # 실거래 사례 조건 — 리포트(comp_filter 오버레이)와 같은 뜻. 기본은 현행(5년·무제한).
    # 조건이 화면마다 다르면 같은 매물의 '주변 실거래'가 두 값으로 보인다.
    sale_years: int = 5
    sale_price_min: int | None = None
    sale_price_max: int | None = None


# 공간 필터: 폴리곤($5) 있으면 그 영역, 없으면 반경($3). $1 lng·$2 lat·$3 radius·$5 polygon(json)
_SPATIAL = """($5::text IS NOT NULL AND ST_Within({geom}, ST_MakeValid(ST_GeomFromGeoJSON($5::text)))
               OR $5::text IS NULL AND ST_DWithin({geom}::geography,
                    ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, $3))"""


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
    # 임대 comps(팀 실측 + 마스터 추정 300건, 층별 평균)는 뺐다(감사 2026-09-17). 실거래 탭은
    # sales 만 읽는데 응답 108KB 의 대부분이 rents 였다. 임대 추정은 임대 탭·보고서가 따로 낸다.
    # 매각 comps: 반경 내 매각 이력 — S03 §3.3. 기간·가격대는 상권 조건을 따른다.
    sale_rows = await pool().fetch(
        f"""SELECT DISTINCT ON (sh.building_pk)
                  sh.building_pk, sh.contract_ym, sh.price, sh.total_area, b.addr,
                  ST_X(b.geom) AS lng, ST_Y(b.geom) AS lat,
                  round(ST_Distance(b.geom::geography,
                        ST_SetSRID(ST_MakePoint($1,$2),4326)::geography)) AS dist_m
           FROM master.sales_history sh
           JOIN master.buildings b ON b.building_pk = sh.building_pk
           WHERE sh.contract_ym >= to_char(now() - make_interval(years => $6::int), 'YYYYMM')
             AND ($4::text IS NULL OR sh.building_pk <> $4)
             AND ($7::bigint IS NULL OR sh.price >= $7)
             AND ($8::bigint IS NULL OR sh.price <= $8)
             AND {_SPATIAL.format(geom='b.geom')}
           ORDER BY sh.building_pk, sh.contract_ym DESC""",   # 같은 매물=최근 거래만(DISTINCT ON)
        body.center_lng, body.center_lat, body.radius_m, body.building_pk,
        json.dumps(body.polygon) if body.polygon else None,
        max(1, min(body.sale_years or 5, 30)),
        body.sale_price_min or None, body.sale_price_max or None,
    )
    sales = []
    for r in sale_rows:
        d = dict(r)
        d["is_outlier"] = False
        if d["total_area"]:
            d["per_area"] = round(d["price"] / float(d["total_area"]) * 3.305785)  # 원/평(연면적)
        sales.append(d)
    sales.sort(key=lambda x: x["contract_ym"], reverse=True)   # DISTINCT ON은 pk순 → 최근순 재정렬
    _flag_outliers(sales, "per_area")

    # (구 rent_candidates 제거) — 미입력 매물은 이제 마스터 추정 comp(is_estimate)로 노출되므로 중복.
    return {"sales": sales, "radius_m": body.radius_m}


# ── 주변 실거래 (지도 선택 카드용) ────────────────────────────────
# S01 지도에서 매물을 고르면 "이게 어느 정도인가"를 바로 가늠할 수 있어야 한다.
# 자기 실거래 이력이 있는 건물은 13.5%뿐이라(2026-08-09 실측) 자기 이력만으로는 대개 빈 화면이다.
# nearby()는 임대 추정 comp까지 무는 무거운 조회라 카드용으로는 매각 사례만 가볍게 뽑는다.
@router.get("/nearby-sales/{building_pk}", openapi_extra={"x-ai": "read"})   # AI 가 부를 수 있다(10-AI §3-3)
async def nearby_sales(building_pk: str, radius_m: int = 500, years: int = 5, limit: int = 8,
                       _: CurrentUser = Depends(current_user)):
    """반경 내 최근 매각 사례 — 가까운 순. 본매물 제외, 매물당 최근 거래 1건(DISTINCT ON).
    per_area = 연면적 평단가(원/평). 04 슬라이드 비교와 같은 축이라 두 화면이 같은 말을 한다."""
    radius_m = max(100, min(radius_m, 3000))
    years = max(1, min(years, 30))
    rows = await pool().fetch(
        """WITH me AS (
                -- 건물이면 그 점, 나대지면 필지 안의 점. building_pk 는 8·9·10·14·22자리이고
                -- pnu 는 19자리라 **한쪽만 걸린다**(2026-09-20). 건물 경로는 그대로다.
                SELECT geom FROM master.buildings WHERE building_pk = $1
                UNION ALL
                SELECT ST_PointOnSurface(geom) FROM master.vacant_parcels WHERE pnu = $1),
                near AS MATERIALIZED (
             SELECT b.building_pk, b.addr, b.total_area, b.land_area,
                    round(ST_Distance(b.geom::geography, (SELECT geom FROM me)::geography)) AS dist_m
             FROM master.buildings b, me
             WHERE b.building_pk <> $1
               AND ST_DWithin(b.geom::geography, me.geom::geography, $2))
           SELECT DISTINCT ON (n.building_pk)
                  n.building_pk, n.addr, n.dist_m, n.total_area, n.land_area,
                  sh.contract_ym, sh.price
           FROM near n JOIN master.sales_history sh USING (building_pk)
           WHERE sh.price > 0 AND sh.total_area > 0
             AND sh.contract_ym >= to_char(now() - make_interval(years => $3::int), 'YYYYMM')
           ORDER BY n.building_pk, sh.contract_ym DESC""",
        building_pk, radius_m, years)

    sales = []
    for r in rows:
        d = dict(r)
        d["is_outlier"] = False
        ta = float(d["total_area"]) if d["total_area"] else None
        d["per_area"] = round(d["price"] / ta * 3.305785) if ta else None
        sales.append(d)

    # 이상치 표시 — 막대 하나가 28,570만/평이면 나머지가 전부 바닥에 깔려 아무것도 못 읽는다.
    # 반경 전체(가까운 8건이 아니라)를 기준으로 판정해야 표본이 충분하다.
    _flag_outliers(sales, "per_area")
    ok = [x for x in sales if x["per_area"] and not x["is_outlier"]]
    ok.sort(key=lambda x: x["dist_m"])                # 가까운 순 — 가늠의 기준은 거리다

    pers = sorted(x["per_area"] for x in ok)
    median = pers[len(pers) // 2] if pers else None
    # 총액 중앙 — 평당과 **같은 표본**에서 낸다. 건물 크기가 제각각이라 뜻은 약하지만
    # 「얼마짜리가 오가는 동네인가」는 총액으로 감이 온다(2026-08-28 비교 막대).
    prices = sorted(x["price"] for x in ok)
    median_price = prices[len(prices) // 2] if prices else None

    return {"radius_m": radius_m, "years": years,
            "total": len(sales),                      # 반경 내 전체(막대는 가까운 limit개만)
            "excluded": len(sales) - len(ok),         # 이상치로 뺀 건수 — 숨기지 않고 말한다
            "median_per_area": median,                # 주변 중앙값 — 이상치에 안 흔들린다
            "median_price": median_price,
            "sales": ok[:limit]}
