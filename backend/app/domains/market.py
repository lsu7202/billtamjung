"""주변시세(S03): 반경 내 전 팀 임대 comps + 매각 comps. 원본 나열·이상치 플래그.
specs S03 · 01-상세설계 §3.3. '저장은 사적, 조회는 공용'(F-01 B안).
"""
import json
import statistics
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from ..core.db import pool
from ..core.deps import current_user, any_user, CurrentUser, viewer

router = APIRouter(prefix="/market", tags=["market"])


class NearbyIn(BaseModel):
    center_lat: float
    center_lng: float
    radius_m: int = 500
    polygon: dict | None = None      # GeoJSON — 있으면 반경 대신 이 영역으로 필터(지도 직접 그리기)
    pnu: str | None = None           # 본매물 지번 — 주변 comps에서 제외
    floors: list[str] = []           # 본매물 층 — 임대 미입력 후보를 이 층 기준으로 노출
    floor_from: int = -1     # 지하1
    floor_to: int = 5        # 지상5
    # 실거래 사례 조건 — 리포트(comp_filter 오버레이)와 같은 뜻. 기본은 현행(5년·무제한).
    # 조건이 화면마다 다르면 같은 매물의 '주변 실거래'가 두 값으로 보인다.
    sale_years: int = 5
    sale_price_min: int | None = None
    sale_price_max: int | None = None
    # 유사 기준(10-01, 상세보기 「주변 유사거래」 — 디스코식). 비우면 안 거른다
    use_like: str | None = None      # 주용도 부분일치(「근린」 → 제1·2종근린생활시설)
    use_zone: str | None = None      # 같은 용도지역
    jimok: str | None = None         # 같은 지목


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
async def nearby(body: NearbyIn, _: CurrentUser = Depends(viewer)):
    # 임대 comps(팀 실측 + 마스터 추정 300건, 층별 평균)는 뺐다(감사 2026-09-17). 실거래 탭은
    # sales 만 읽는데 응답 108KB 의 대부분이 rents 였다. 임대 추정은 임대 탭·보고서가 따로 낸다.
    # 매각 comps: 반경 내 매각 이력 — S03 §3.3. 기간·가격대는 상권 조건을 따른다.
    sale_rows = await pool().fetch(
        # 실거래는 지번에 붙는다(2026-10-08). 자리는 그 지번의 대표 동(parcel_rep)에서, 면적 · 유형은 거래가 신고한 값.
        # 단가를 견주는 사례라 통매만(trade_whole) — 호실 값을 섞으면 연면적 평단가가 무너진다
        f"""SELECT DISTINCT ON (sh.pnu)
                  sh.pnu, b.building_pk, sh.contract_ym, sh.price, sh.total_area, b.addr,
                  sh.land_area, b.main_use_name, b.use_zone, b.jimok,
                  sh.trade_type, sh.use_label AS trade_use,   -- 신고 갈래 · 원천 용도(0246). 대장 용도와 다를 수 있다
                  ST_X(b.geom) AS lng, ST_Y(b.geom) AS lat,
                  round(ST_Distance(b.geom::geography,
                        ST_SetSRID(ST_MakePoint($1,$2),4326)::geography)) AS dist_m
           FROM master.trade_whole sh
           JOIN master.parcel_rep pr ON pr.pnu = sh.pnu
           JOIN master.buildings b ON b.building_pk = pr.rep_pk
           WHERE sh.contract_ym >= to_char(now() - make_interval(years => $6::int), 'YYYYMM')
             AND ($4::text IS NULL OR sh.pnu IS DISTINCT FROM $4)
             AND ($7::bigint IS NULL OR sh.price >= $7)
             AND ($8::bigint IS NULL OR sh.price <= $8)
             AND ($9::text IS NULL OR b.main_use_name ILIKE '%' || $9 || '%')
             AND ($10::text IS NULL OR b.use_zone = $10)
             AND ($11::text IS NULL OR b.jimok = $11)
             AND {_SPATIAL.format(geom='b.geom')}
           ORDER BY sh.pnu, sh.contract_ym DESC, sh.contract_day DESC NULLS LAST""",   # 같은 지번 = 최근 거래만
        body.center_lng, body.center_lat, body.radius_m, body.pnu,
        json.dumps(body.polygon) if body.polygon else None,
        max(1, min(body.sale_years or 5, 30)),
        body.sale_price_min or None, body.sale_price_max or None,
        body.use_like or None, body.use_zone or None, body.jimok or None,
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


# 주변 실거래(지도 선택 카드용)는 GET /parcels/{pnu}/nearby-trades 로 옮겼다(10-08 · 지번 열쇠)


# ─── 임대시세 지도 핀(0212, 2026-10-04) ───────────────────────────────────────────────
# 실거래처럼 켜고 끄는 가격지표. 크롤링 자료라 중개사에게만(0191 결정). 건물 하나에 핀 하나, 그 건물의 **가장 최근 수집일** 값.
# 매매시세 핀은 걷었다(10-08) — 탐색의 네이버 매물이 같은 자료다.
#   임대시세  **층을 골라서만** 본다(대표 10-04: 모든 층 평당 월세는 안 낸다 — 층마다 값이 다르고
#             모든 층에 광고가 있는 건물은 드물어, 섞으면 건물마다 다른 층 구성을 견주게 된다).
#             고른 층 무리 안 공간들의 평당 월세(월세 ÷ 계약면적) 가운데 값. 전세(월세 0)는 뺀다.
#             승강기(대장 대수) 있음 · 없음으로 거른다 — 대장에 칸이 없으면 없음
RENT_FLOORS = {
    "1": "r.floor = '1층'",
    "2": "r.floor = '2층'",
    "3": "r.floor ~ '^[0-9]+층$' AND substring(r.floor FROM '^[0-9]+')::int >= 3",
    "B": "r.floor LIKE '지하%'",
}


@router.get("/pins")
async def market_pins(kind: str, minlng: float, minlat: float, maxlng: float, maxlat: float,
                      floor: str = "1", elev: str = "all", use: str = "all",
                      user: CurrentUser = Depends(current_user)):
    """임대 = 층(하나) · 승강기(대장만 — 승강기공단은 도로명으로 성기게 붙어 쿼리에 안 넣는다) · 종류(상가 · 사무실)"""
    box = "b.geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)"
    args: list = [minlng, minlat, maxlng, maxlat]
    if kind == "rent" and floor in RENT_FLOORS and elev in ("all", "y", "n") and use in ("all", "상가", "사무실"):
        ev = {"all": "", "y": "AND COALESCE(b.elevator, 0) > 0", "n": "AND COALESCE(b.elevator, 0) = 0"}[elev]
        sql = f"""
            WITH last AS (
              SELECT r.building_pk, max(r.observed_on) AS d FROM master.market_rent r
                JOIN master.buildings b ON b.building_pk = r.building_pk
               WHERE {box} {ev} GROUP BY r.building_pk),
            a AS (
              SELECT r.building_pk, max(l.d) AS observed_on, count(*) AS n,
                     percentile_cont(0.5) WITHIN GROUP (ORDER BY r.rent / r.contract_area) AS v
                FROM master.market_rent r JOIN last l ON l.building_pk = r.building_pk AND r.observed_on = l.d
               WHERE r.rent > 0 AND {RENT_FLOORS[floor]} {"" if use == "all" else f"AND r.use_type = '{use}'"}
               GROUP BY r.building_pk)
            SELECT a.*, b.pnu, b.addr, ST_X(b.geom) AS lng, ST_Y(b.geom) AS lat, b.land_area, b.total_area, b.main_use_name
              FROM a JOIN master.buildings b ON b.building_pk = a.building_pk"""
    else:
        return []
    rows = await pool().fetch(sql + " LIMIT 5000", *args)
    # ㎡당 월세(원) — 평으로 바꾸는 건 화면이 단위 토글을 따라 한다
    return [{**dict(r), "v": float(r["v"]) if r["v"] is not None else None} for r in rows]
