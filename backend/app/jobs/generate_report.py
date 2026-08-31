"""보고서 비동기 생성 잡. specs R · 01-상세설계 §3.2.

플로우: 데이터 조립(master+overlay+층별임대) → 가치점수(F-16, 레지스트리 파라미터)
→ python-pptx 생성 → 저장(베타 로컬 / 프로덕션 GCS) → 성공 트랜잭션 안에서 크레딧 차감.
실패 → status=failed + 사유, 크레딧 미차감.

엔트리 2개: run_generate(로컬 BackgroundTasks) · POST /jobs/generate-report(Cloud Tasks).
"""
import json
import datetime as dt
from fastapi import APIRouter
from pydantic import BaseModel
from ..core.db import tx, pool
from ..core.config import settings
from . import value_score, report_calc, use_type

router = APIRouter(prefix="/jobs", tags=["worker"])



def _fnum(v) -> float | None:
    try:
        return float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


async def _load_formula_params() -> tuple[int, dict[str, float], dict]:
    """반환: (set_version, 수치 파라미터, F-17 시점보정표)."""
    rows = await pool().fetch(
        """SELECT p.set_version, p.formula_id, p.param_key, p.value_num, p.value_json
           FROM ref.formula_params p
           JOIN ref.formula_sets s ON s.set_version = p.set_version AND s.active"""
    )
    params = {r["param_key"]: float(r["value_num"]) for r in rows if r["value_num"] is not None}
    tj = next((r["value_json"] for r in rows if r["param_key"] == "time_adjust"), None)
    time_adjust = json.loads(tj) if isinstance(tj, str) else (tj or {})
    # v3.1: 분기 가격지수(sale_price_index) 병합 — 있으면 산식이 지수비 우선 사용(연표는 폴백)
    try:
        qrows = await pool().fetch("SELECT quarter, ratio FROM master.sale_price_index")
        time_adjust = {**time_adjust, **{r["quarter"]: float(r["ratio"]) for r in qrows}}
    except Exception:
        pass
    version = rows[0]["set_version"] if rows else 1
    return version, params, time_adjust


async def _assemble(building_pk: str, team_id: int) -> dict:
    """master + 팀 오버레이 병합 + 층별임대 합계."""
    merged = await pool().fetchval("SELECT app.building_view($1,$2)", building_pk, team_id)
    b = json.loads(merged) if isinstance(merged, str) else (merged or {})
    rents = await pool().fetch(
        """SELECT deposit, rent, maintenance, is_vacant FROM app.floor_rents
           WHERE building_pk=$1 AND team_id=$2 AND deleted_at IS NULL""",
        building_pk, team_id,
    )
    b["total_deposit"] = sum(r["deposit"] or 0 for r in rents)
    b["total_rent"] = sum(r["rent"] or 0 for r in rents)
    b["vacant_count"] = sum(1 for r in rents if r["is_vacant"])

    # 가치점수 입력 보강(F-16) — 토지 속성은 대표필지에서, 연수는 날짜→환산
    if b.get("pnu"):
        p = await pool().fetchval(
            """SELECT to_jsonb(x) FROM (
                 SELECT road_frontage, use_zone, shape, slope
                 FROM master.parcels WHERE pnu=$1) x""",
            b["pnu"],
        )
        pj = json.loads(p) if isinstance(p, str) else (p or {})
        for k in ("road_frontage", "use_zone", "shape", "slope"):
            b.setdefault(k, pj.get(k)) if not b.get(k) else None
            if not b.get(k):
                b[k] = pj.get(k)
    # 주야비(낮÷밤 생활인구) — F-17 v3.2 의 E2 축. building_view 가 안 싣는 값이라 여기서 붙인다.
    pop = await pool().fetchrow(
        "SELECT day_avg::float d, night_avg::float n FROM master.building_pop WHERE building_pk=$1",
        building_pk)
    if pop:
        b["day_pop"], b["night_pop"] = pop["d"], pop["n"]

    # 분석용 용적률 — 활용 유형·미래가치는 **분석값**이라 검색 전용 계산값을 얹는다(0144).
    # 화면·서류로 나가는 b["far"] 는 대장 그대로 둔다. 둘을 섞지 않는다.
    b["far_any"] = b.get("far")
    if b.get("far") is None:
        b["far_any"] = await pool().fetchval(
            "SELECT far_calc FROM master.building_calc WHERE building_pk=$1", building_pk)
    if b.get("approval_ymd"):
        try:
            y = dt.date.fromisoformat(str(b["approval_ymd"])[:10])
            b["age_years"] = (dt.date.today() - y).days / 365.25
        except ValueError:
            pass
    if b.get("remodel_ymd"):
        try:
            y = dt.date.fromisoformat(str(b["remodel_ymd"])[:10])
            b["remodel_years"] = (dt.date.today() - y).days / 365.25
        except ValueError:
            pass
    # F-17 수익환원 블렌드용: 마스터 연임대추정 + 자치구 cap rate(구별 2.5~6.9%라 구별 필요)
    inc = await pool().fetchrow(
        """SELECT e.annual_rent,
                  COALESCE(ic.cap, (SELECT cap FROM master.income_cap WHERE gu='_seoul')) AS cap
           FROM master.buildings b
           LEFT JOIN master.building_rent_est e ON e.building_pk = b.building_pk
           LEFT JOIN master.income_cap ic ON ic.gu = substr(b.bjd_code, 1, 5)
           WHERE b.building_pk = $1""",
        building_pk)
    if inc:
        b["est_annual_rent"] = float(inc["annual_rent"]) if inc["annual_rent"] else None
        b["gu_cap"] = float(inc["cap"]) if inc["cap"] else None
    return b


# 공간 필터: market_area 폴리곤 있으면 그 영역, 없으면 center 반경(기본 500m).
_COMP_SPATIAL = """($5::text IS NOT NULL AND ST_Within(b.geom, ST_MakeValid(ST_GeomFromGeoJSON($5::text)))
                    OR $5::text IS NULL AND ST_DWithin(b.geom::geography,
                         ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, $3))"""


def _market_spatial(subject: dict) -> tuple[dict | None, int, dict | None]:
    """market_area 오버레이 → (polygon, radius_m, center). 없으면 (None, 500, None)."""
    ma = subject.get("market_area")
    if isinstance(ma, str):
        try:
            ma = json.loads(ma)
        except json.JSONDecodeError:
            ma = None
    if isinstance(ma, dict):
        if ma.get("kind") == "polygon":
            return ma.get("geojson"), 500, None
        if ma.get("kind") == "circle":
            return None, int(ma.get("radius_m") or 500), ma.get("center")
    return None, 500, None


# 실거래 사례 조건(기간·가격대) — market_area 옆의 comp_filter 오버레이.
# 기간이 5년으로 박혀 있고 가격대 필터가 없어서, 1,500억 매물의 사례에 3억짜리가 섞였다.
# 기본값은 현행 그대로(5년·무제한)라 조건을 안 건드린 리포트는 값이 안 변한다.
COMP_YEARS_DEFAULT = 5


def _comp_filter(subject: dict) -> tuple[int, int | None, int | None]:
    """comp_filter 오버레이 → (years, price_min, price_max). 없으면 (5, None, None)."""
    cf = subject.get("comp_filter")
    if isinstance(cf, str):
        try:
            cf = json.loads(cf)
        except json.JSONDecodeError:
            cf = None
    if not isinstance(cf, dict):
        return COMP_YEARS_DEFAULT, None, None

    def _pos(k):
        v = cf.get(k)
        try:
            v = int(v)
        except (TypeError, ValueError):
            return None
        return v if v > 0 else None

    years = _pos("years") or COMP_YEARS_DEFAULT
    return min(years, 30), _pos("price_min"), _pos("price_max")


def _f16_from_ymd(cb: dict) -> dict:
    """approval_ymd/remodel_ymd(date) → age_years/remodel_years 파생(F-16 입력용)."""
    today = dt.date.today()
    for dk, ak in (("approval_ymd", "age_years"), ("remodel_ymd", "remodel_years")):
        if cb.get(dk):
            d = cb[dk] if isinstance(cb[dk], dt.date) else dt.date.fromisoformat(str(cb[dk])[:10])
            cb[ak] = (today - d).days / 365.25
    return cb


def _apply_override(cb: dict, ov: dict) -> dict:
    """S02b 편집값(fields)을 comp 대장값 위에 덮음. 표시값 → F-16 입력 매핑."""
    for k in ("road_frontage", "use_zone", "shape", "slope", "station_dist"):
        if ov.get(k) not in (None, ""):
            cb[k] = ov[k]
    if ov.get("elevator") is not None:
        cb["elevator"] = 1 if ov["elevator"] in (True, 1, "있음") else 0
    if ov.get("approval_ym"):
        ym = str(ov["approval_ym"]).replace("/", "").replace("-", "")[:6]
        if len(ym) >= 6:
            cb["approval_ymd"] = dt.date(int(ym[:4]), int(ym[4:6]), 1)
    if "remodel_ym" in ov:
        rv = str(ov.get("remodel_ym") or "").replace("/", "").replace("-", "")[:6]
        cb["remodel_ymd"] = dt.date(int(rv[:4]), int(rv[4:6]), 1) if len(rv) >= 6 else None
    return cb


# comp 성격(섹터) 정본은 report_calc — 배치(build_sale_est)와 동일 소스(정합 단일화, 2026-08-06).
_comp_type_filter = report_calc.comp_type_filter
_ADJ_FACTOR = report_calc.ADJ_FACTOR


async def _fetch_comps(building_pk: str, subject: dict, params: dict,
                       overrides: dict | None = None) -> list[dict]:
    """market_area 내 최근 5년 매각사례 + 각 comp F-16 점수. overrides[pk]=편집 fields.
    반환 각 항목에 편집용 fields(대장 원본 표시값) 포함. F-16 결측=0점(게이팅 없음)."""
    overrides = overrides or {}
    poly, radius, center = _market_spatial(subject)
    geom = await pool().fetchrow(
        "SELECT ST_X(geom) AS lng, ST_Y(geom) AS lat FROM master.buildings WHERE building_pk=$1", building_pk)
    clng = (center or {}).get("lng") if center else None
    clat = (center or {}).get("lat") if center else None
    if clng is None and geom:
        clng, clat = geom["lng"], geom["lat"]

    allowed, allowed_mu, adj = _comp_type_filter(subject.get("land_use"), subject.get("main_use"))   # 성격(섹터) 필터. None=미적용
    years, pmin, pmax = _comp_filter(subject)
    rows = await pool().fetch(
        f"""SELECT DISTINCT ON (sh.building_pk)
                  sh.building_pk, sh.contract_ym, sh.price, sh.total_area, sh.land_area,
                  b.gongsi_latest, b.addr, b.land_use,
                  b.road_frontage, b.use_zone, b.shape, b.slope, b.station_dist,
                  b.approval_ymd, b.remodel_ymd, b.elevator,
                  pp.day_avg::float AS day_pop, pp.night_avg::float AS night_pop,
                  ST_X(b.geom) AS lng, ST_Y(b.geom) AS lat,
                  round(ST_Distance(b.geom::geography,
                        ST_SetSRID(ST_MakePoint($1,$2),4326)::geography)) AS dist_m
           FROM master.sales_history sh
           JOIN master.buildings b ON b.building_pk = sh.building_pk
           LEFT JOIN master.building_pop pp ON pp.building_pk = b.building_pk
           WHERE sh.contract_ym >= to_char(now() - make_interval(years => $8::int), 'YYYYMM')
             AND sh.building_pk <> $4 AND sh.price > 0 AND sh.total_area > 0
             AND ($9::bigint IS NULL OR sh.price >= $9)
             AND ($10::bigint IS NULL OR sh.price <= $10)
             AND ($6::text[] IS NULL OR b.land_use = ANY($6) OR substr(b.main_use,1,2) = ANY($7))
             AND {_COMP_SPATIAL}
           ORDER BY sh.building_pk, sh.contract_ym DESC""",
        clng, clat, radius, building_pk, json.dumps(poly) if poly else None, allowed, allowed_mu,
        years, pmin, pmax,
    )
    comps = []
    for r in rows:
        cb = dict(r)
        fields = {  # 편집용 표시값(대장 원본)
            "road_frontage": cb["road_frontage"], "station_dist": cb["station_dist"],
            "use_zone": cb["use_zone"], "shape": cb["shape"], "slope": cb["slope"],
            "elevator": "있음" if (cb["elevator"] or 0) > 0 else "없음",
            "approval_ym": cb["approval_ymd"].strftime("%Y/%m") if cb["approval_ymd"] else None,
            "remodel_ym": cb["remodel_ymd"].strftime("%Y/%m") if cb["remodel_ymd"] else None,
        }
        ov = overrides.get(cb["building_pk"])
        if ov:
            _apply_override(cb, ov)
        _f16_from_ymd(cb)
        cvs = value_score.compute(cb, params)
        per_area = round(cb["price"] / float(cb["total_area"]) * report_calc.M2_PER_PYEONG)
        c_la = float(cb["land_area"]) if cb["land_area"] else None
        c_gt = (float(cb["gongsi_latest"]) * c_la) if (cb["gongsi_latest"] and c_la) else None
        comps.append({"building_pk": cb["building_pk"], "addr": cb["addr"],
                      "contract_ym": cb["contract_ym"], "price": cb["price"],
                      "total_area": float(cb["total_area"]), "land_area": c_la, "gongsi_total": c_gt,
                      "approval_ymd": cb["approval_ymd"], "remodel_ymd": cb["remodel_ymd"],
                      # F-17 v3.2 의 두 축(도로접면·주야비). **여기 안 실으면 라이브만 조용히
                      # 보정 없이 계산한다** — 산식은 값이 없으면 안 걸리게 돼 있어서 오류가 안 난다.
                      # 실제로 그렇게 빠뜨려 배치 2,575억 vs 라이브 2,110억(18%)이 났다(2026-08-30).
                      # road_frontage 는 cb 에서 읽는다 — 오버레이로 고친 값이 반영된 뒤다.
                      "road_frontage": cb["road_frontage"],
                      "day_pop": cb["day_pop"], "night_pop": cb["night_pop"],
                      "score": cvs["score"],
                      "per_area": per_area, "dist_m": cb["dist_m"], "land_use": cb["land_use"],
                      "type_factor": _ADJ_FACTOR if cb["land_use"] in adj else 1.0,
                      "lng": cb["lng"], "lat": cb["lat"],
                      "fields": {**fields, **(ov or {})}, "is_outlier": False})
    _flag_comp_outliers(comps)
    return comps


def baseline_comps(comps: list[dict]) -> list[dict]:
    """무오버레이 기본 comp 선택 — 배치(build_sale_est._iqr_keep + '<3 제외' 가드)와 완전 동일.
    comp<3=사례부족([] → appraise None) · 이상치 제외 · 제외 후 <3이면 되돌림(표본 보전).
    ★ 이 함수가 배치=리포트 정합의 단일 기준. 오버레이 없으면 두 경로가 이 규칙으로 같은 값."""
    if len(comps) < 3:
        return []
    kept = [c for c in comps if not c.get("is_outlier")]
    return kept if len(kept) >= 3 else comps


async def _load_comps(building_pk: str, subject: dict, params: dict,
                      exclude: set | None = None, overrides: dict | None = None) -> list[dict]:
    """생성용 F-17 입력 리스트. exclude=None(무오버레이) → 배치 동일 baseline. exclude 지정 → 유저 선택대로."""
    comps = await _fetch_comps(building_pk, subject, params, overrides)
    if exclude is None:
        return baseline_comps(comps)
    return [c for c in comps if c["building_pk"] not in exclude]


def _floor_key(fl: str) -> int:
    """층 정렬(지하=음수). '지하1층'→-1, '지1층'→-1, '1층'→1.

    파싱은 core/floor_label 하나만 쓴다(2026-08-29). 여기 있던 판정은 「지하」 두 글자만
    지하로 봐서, 대장의 「지1층」·「지1」·「지층」(37만건)을 지상으로 뒤집어 읽었다.
    이 함수는 정렬·숨김 매칭에만 쓰이지만, 층이 뒤집히면 보고서에서 지하가 맨 위에 선다."""
    from ..core.floor_label import signed
    return signed(fl) or 0


async def _nearby_rent_apply(building_pk: str, subject: dict, team_id: int) -> dict | None:
    """주변임대시세(반경 내 층별 평균, 이상치 제외)를 본매물 층에 적용.
    반환: {floors:[{floor,cur,mkt,diff,count}], applied_rent, applied_deposit, cur_rent, cur_deposit}
    또는 None(주변 임대사례 없음 → 토글 무의미)."""
    import statistics
    poly, radius, center = _market_spatial(subject)
    geom = await pool().fetchrow(
        "SELECT ST_X(geom) AS lng, ST_Y(geom) AS lat FROM master.buildings WHERE building_pk=$1", building_pk)
    clng = (center or {}).get("lng") if center else None
    clat = (center or {}).get("lat") if center else None
    if clng is None and geom:
        clng, clat = geom["lng"], geom["lat"]

    # 주변 평균 수익률(중앙값) = 반경 내 건물들의 (연임대추정 ÷ 추정가) — 06 비교·07 의견용.
    nearby_roi = await pool().fetchval(
        f"""SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY e.annual_rent::float / se.sale_est * 100)
            FROM master.building_rent_est e
            JOIN master.building_sale_est se USING (building_pk)
            JOIN master.buildings b USING (building_pk)
            WHERE e.annual_rent > 0 AND se.sale_est > 0 AND b.building_pk <> $4 AND {_COMP_SPATIAL}""",
        clng, clat, radius, building_pk, json.dumps(poly) if poly else None)

    # 주변 임대 comps = 팀 실제(app.floor_rents) + 마스터 추정(master.floor_rent_est, 팀 미입력 층) — market.nearby와 동일 소스.
    rows = await pool().fetch(
        f"""SELECT floor, area, rent, deposit FROM (
              SELECT fr.floor, fr.contract_area::float AS area, fr.rent::float AS rent, COALESCE(fr.deposit,0)::float AS deposit
              FROM app.floor_rents fr JOIN master.buildings b ON b.building_pk = fr.building_pk
              WHERE fr.deleted_at IS NULL AND fr.is_vacant IS NOT TRUE AND fr.building_pk <> $4
                AND fr.rent > 0 AND fr.contract_area > 0 AND {_COMP_SPATIAL}
              UNION ALL
              SELECT fo.floor, sum(fo.floor_area)::float, sum(fre.rent_est)::float, sum(COALESCE(fre.deposit_est,0))::float
              FROM master.buildings b JOIN master.floor_rent_est fre ON fre.building_pk = b.building_pk
                   JOIN master.floor_outline fo ON fo.building_pk = fre.building_pk AND fo.seq = fre.seq
              WHERE b.building_pk <> $4 AND fre.rent_est > 0 AND fo.floor_area > 0 AND {_COMP_SPATIAL}
                AND NOT EXISTS (SELECT 1 FROM app.floor_rents fr2
                                WHERE fr2.building_pk = b.building_pk AND fr2.floor = fo.floor AND fr2.deleted_at IS NULL)
              GROUP BY b.building_pk, fo.floor
            ) q WHERE area > 0 AND rent > 0""",
        clng, clat, radius, building_pk, json.dumps(poly) if poly else None)
    if not rows:
        return None
    # per_rent/per_deposit(원/㎡) → 전역 IQR 이상치 제외 → 층별 평균. market.nearby와 동일 알고리즘(화면 숫자 일치)
    recs = [{"floor": r["floor"], "per_rent": r["rent"] / r["area"],
             "per_deposit": r["deposit"] / r["area"]} for r in rows]
    prs = [x["per_rent"] for x in recs]
    lo, hi = float("-inf"), float("inf")
    if len(prs) >= 3:
        q1, q3 = statistics.quantiles(prs, n=4)[0], statistics.quantiles(prs, n=4)[2]
        lo, hi = q1 - 1.5 * (q3 - q1), q3 + 1.5 * (q3 - q1)
    by_floor: dict = {}
    for x in recs:
        if lo <= x["per_rent"] <= hi:
            by_floor.setdefault(x["floor"], []).append(x)
    mkt = {fl: {"per_rent": statistics.mean(x["per_rent"] for x in xs),
                "per_deposit": statistics.mean(x["per_deposit"] for x in xs), "count": len(xs)}
           for fl, xs in by_floor.items()}

    # 본매물 층별 = 마스터 대장(floor_outline+floor_rent_est) 기준, 팀 오버레이(app.floor_rents) 있으면 그 층 대체.
    mrows = await pool().fetch(
        """SELECT fo.floor, sum(fo.floor_area)::float AS area,
                  sum(fre.rent_est)::float AS rent, sum(COALESCE(fre.deposit_est,0))::float AS deposit
           FROM master.floor_outline fo JOIN master.floor_rent_est fre USING (building_pk, seq)
           WHERE fo.building_pk=$1 AND fre.rent_est>0 GROUP BY fo.floor""", building_pk)
    trows = await pool().fetch(
        """SELECT floor, sum(contract_area)::float AS area, sum(rent)::float AS rent, sum(COALESCE(deposit,0))::float AS deposit
           FROM app.floor_rents WHERE building_pk=$1 AND team_id=$2 AND deleted_at IS NULL AND is_vacant IS NOT TRUE
           GROUP BY floor""", building_pk, team_id)
    sf: dict = {r["floor"]: {"area": r["area"] or 0.0, "rent": r["rent"] or 0, "deposit": r["deposit"] or 0} for r in mrows}
    for r in trows:   # 팀 입력 층 = 대체(오버레이 우선)
        sf[r["floor"]] = {"area": r["area"] or 0.0, "rent": r["rent"] or 0, "deposit": r["deposit"] or 0}
    # 팀이 없앤 층(0029)은 이 건물에 존재하지 않는 층 — 임대수익·주변시세 비교에서 뺀다.
    hidden = {r["floor"] for r in await pool().fetch(
        "SELECT floor FROM app.floor_hidden WHERE building_pk=$1 AND team_id=$2", building_pk, team_id)}
    hidden_sf = {_floor_key(f) for f in hidden}
    for fl in [f for f in sf if _floor_key(f) in hidden_sf]:
        del sf[fl]
    if not sf:
        return None
    floors, applied_rent, applied_deposit, cur_rent, cur_deposit = [], 0, 0, 0, 0
    for fl in sorted(sf, key=_floor_key):
        s = sf[fl]; m = mkt.get(fl); scur = round(s["rent"])
        cur_rent += scur; cur_deposit += round(s["deposit"])
        if m and s["area"] > 0:
            mr, md, cnt = round(m["per_rent"] * s["area"]), round(m["per_deposit"] * s["area"]), m["count"]
        else:
            mr, md, cnt = scur, round(s["deposit"]), 0   # 그 층 주변사례 없음 → 현재 폴백
        applied_rent += mr; applied_deposit += md
        floors.append({"floor": fl, "cur": scur, "mkt": mr, "diff": mr - scur, "count": cnt,
                       # 보증금도 층별로 이미 셈해 놨다 — 화면이 임대료와 나란히 쓴다(2026-08-25)
                       "cur_dep": round(s["deposit"]), "mkt_dep": md})
    return {"floors": floors, "applied_rent": applied_rent, "applied_deposit": applied_deposit,
            "cur_rent": cur_rent, "cur_deposit": cur_deposit,
            "nearby_roi": round(float(nearby_roi), 2) if nearby_roi else None}


def _parse_far(txt) -> float | None:
    """legal_far 텍스트('800%', '1,000% (도심 800%)') → float(%). 앞의 숫자."""
    if not txt:
        return None
    import re
    m = re.search(r"[\d,]+", str(txt))
    return float(m.group().replace(",", "")) if m else None


async def _market_zones(building_pk: str) -> list[dict]:
    """상권 존(격자 ~100m) — 셀별 지배 용도(업무/먹자/유흥/판매) 폴리곤. 지도 오버레이용."""
    rows = await pool().fetch(
        """WITH s AS (SELECT geom, ST_X(geom) lng, ST_Y(geom) lat FROM master.buildings WHERE building_pk=$1),
             cells AS (
               SELECT ST_SnapToGrid(b.geom, s.lng, s.lat, 0.0011, 0.0009) cell,
                 CASE WHEN fo.use ~ '사무소|업무시설' THEN '업무'
                      WHEN fo.use ~ '음식점' THEN '먹자'
                      WHEN fo.use ~ '유흥|단란|노래연습장|주점' THEN '유흥'
                      WHEN fo.use ~ '소매점|백화점' THEN '판매' ELSE '기타' END cat
               FROM master.buildings b JOIN master.floor_outline fo USING(building_pk), s
               WHERE ST_DWithin(b.geom::geography, s.geom::geography, 300)
                 AND fo.use !~ '주택|아파트|오피스텔|주차|부대'),
             agg AS (SELECT cell, cat, count(*) c FROM cells WHERE cat<>'기타' GROUP BY cell, cat),
             dom AS (SELECT DISTINCT ON (cell) cell, cat, c FROM agg ORDER BY cell, c DESC)
           SELECT ST_AsGeoJSON(ST_Envelope(ST_Expand(cell, 0.00055, 0.00045))) geojson, cat, c
           FROM dom WHERE c >= 3 ORDER BY c""",
        building_pk)
    return [{"geojson": json.loads(r["geojson"]), "cat": r["cat"], "count": r["c"]} for r in rows]


async def _use_type(building_pk: str, b: dict) -> dict | None:
    """F-20 활용 유형(투자 유형) 분류 — legal_far·상권 프로필 조립 후 classify()."""
    lf = await pool().fetchval(
        """SELECT max(pr.legal_far) FROM master.building_parcels bp
           JOIN master.parcels pr ON pr.pnu = bp.pnu WHERE bp.building_pk = $1""", building_pk)
    mk = await pool().fetchrow(
        """WITH s AS (SELECT geom FROM master.buildings WHERE building_pk=$1),
             f AS (SELECT fo.use FROM master.floor_outline fo JOIN master.buildings b USING(building_pk), s
                   WHERE ST_DWithin(b.geom::geography, s.geom::geography, 300)
                     AND fo.use !~ '주택|아파트|오피스텔|주차|부대|고시원')
           SELECT count(*) AS n,
             avg((use ~ '사무소|업무시설')::int)::float AS office, avg((use ~ '음식점')::int)::float AS food,
             avg((use ~ '유흥|단란|노래연습장|주점')::int)::float AS ent, avg((use ~ '소매점|백화점')::int)::float AS retail
           FROM f""", building_pk)
    market = ({"office": mk["office"] or 0, "food": mk["food"] or 0, "ent": mk["ent"] or 0, "retail": mk["retail"] or 0}
              if mk and mk["n"] else {})
    la = _fnum(b.get("land_area"))
    result = use_type.classify({
        "far": _fnum(b.get("far_any")), "legal_far": _parse_far(lf), "land_use": b.get("land_use"),
        "floors_above": b.get("floors_above"), "land_area_py": (la / 3.305785) if la else None,
        "age_years": b.get("age_years"), "remodel_years": b.get("remodel_years"),
        "shape": b.get("shape"), "road_frontage": b.get("road_frontage"),
        "road_score": value_score.ROAD_SCORES.get(b.get("road_frontage") or "", 0),
        "station_score": value_score.station_score(_fnum(b.get("station_dist"))),
        "use_zone": b.get("use_zone"), "market": market,
    })
    result["zones"] = await _market_zones(building_pk)   # 상권 존 폴리곤(지도용)
    result["_far"], result["_legal_far"] = _fnum(b.get("far_any")), _parse_far(lf)   # 미래가치 계산용
    result["_land_rate5"] = await _land_rate5(b)         # 지가 상승 추세(미래가치 3축)
    rz = await pool().fetchrow(                          # 정비구역·재정비촉진 지정 여부(F-21 개발여지)
        "SELECT kind, name FROM master.building_redevel WHERE building_pk=$1 LIMIT 1", building_pk)
    result["_redevel"] = dict(rz) if rz else None
    return result


async def _land_rate5(b: dict) -> float | None:
    """지가 5년 변동률(%) — 개별 공시지가 시계열(gongsi_series) 우선, 없으면 자치구 지가변동률(land_adjust)."""
    if b.get("pnu"):
        gs = await pool().fetch(
            "SELECT year, price FROM master.gongsi_series WHERE pnu=$1 ORDER BY year", b["pnu"])
        if len(gs) >= 2 and gs[-1]["price"]:
            last_y = gs[-1]["year"]
            base = next((r for r in gs if r["year"] == last_y - 5), gs[0])   # 5년 전(없으면 최古)
            if base["price"]:
                return (gs[-1]["price"] - base["price"]) / base["price"] * 100
    if b.get("bjd_code"):                                # 폴백: 자치구 누적 지가변동률 팩터
        gu = str(b["bjd_code"])[:5]
        f = (await pool().fetchval("SELECT adj FROM master.land_adjust WHERE gu=$1 AND yr=2020", gu)
             or await pool().fetchval("SELECT adj FROM master.land_adjust WHERE gu='11' AND yr=2020"))
        if f:
            return (float(f) - 1) * 100
    return None


def _attach_future(ut: dict | None, rent_summary: dict | None) -> None:
    """미래가치(개발여지+임대상향) 계산해 use_type에 부착. far/legal은 _use_type, 임대는 synthesize에서 조립."""
    if not ut:
        return
    rs = rent_summary or {}
    ut["future"] = use_type.future_value(
        ut.pop("_far", None), ut.pop("_legal_far", None), None,   # land_use는 far로 이미 반영(나지=far 0)
        rs.get("cur_rent"), rs.get("mkt_rent"), ut.pop("_land_rate5", None),
        redevel=ut.pop("_redevel", None))


async def _save_master_fair(building_pk: str, fair: float, b: dict) -> None:
    """무오버레이 리포트 값을 master.building_sale_est 에 되쓴다 — 검색·목록도 같은 값을 본다.

    배치는 원천이 바뀌어야 도는데(용도지역·요율 갱신) 리포트는 그 사이에도 최신 산식으로 낸다.
    그래서 같은 건물이 검색에선 1,070억, 상세에선 896억으로 갈렸다(2026-08-28 삼성동 78).
    실패해도 리포트 생성은 계속한다 — 부수 효과가 본 일을 막으면 안 된다.
    """
    ta = _fnum(b.get("total_area"))
    per_py = round(fair / (ta / report_calc.M2_PER_PYEONG)) if ta else None
    try:
        await pool().execute(
            """INSERT INTO master.building_sale_est
                 (building_pk, sale_est, per_py, n_comps, method, updated)
               VALUES ($1, $2, $3, NULL, 'f17v3-live', now())
               ON CONFLICT (building_pk) DO UPDATE
                 SET sale_est = EXCLUDED.sale_est, per_py = EXCLUDED.per_py,
                     method = EXCLUDED.method, updated = EXCLUDED.updated""",
            building_pk, round(fair), per_py)
    except Exception as e:                                    # noqa: BLE001
        print(f"[report] master fair 되쓰기 실패 {building_pk}: {e}")


def synthesize(subject: dict, subject_score: float, comps: list[dict],
               params: dict, time_adjust: dict, rent_apply: dict | None = None,
               apply_market: bool = False) -> dict:
    """F-17 적정매매가 + F-18 예상수익률 + 협의금액. preview·생성 공용.
    rent_apply=주변임대 '데이터'(비교표·주변수익률 표시용, 항상 전달 가능).
    apply_market=True(토글 ON)일 때만 그 값이 수익률·적용임대료를 움직임 —
    기본(False)은 팀 실입력→마스터 추정 폴백으로 배치(search.classified roi)와 동일."""
    ap = report_calc.appraise(subject_score, subject, comps, params, time_adjust)
    _cur = _fnum(subject.get("total_rent"))
    _est_mo = (_fnum(subject.get("est_annual_rent")) or 0) / 12 or None   # 마스터 추정(월) — 배치 폴백과 동일
    if apply_market and rent_apply:
        rent, deposit = rent_apply["applied_rent"], rent_apply["applied_deposit"]
    else:   # 기본: 팀 임대 실입력 → 마스터 추정 — 검색 핀 수익률과 같은 분자
        rent, deposit = (_cur or _est_mo), _fnum(subject.get("total_deposit"))
    # 수익환원 블렌드(β): NOI(연임대) ÷ 구cap 을 comp식(v2)에 소폭 섞음(공용 report_calc.blend_income).
    # 임대 = 팀입력(월) 있으면 그것, 없으면 마스터 추정 연임대. 백테스트상 β=0.2가 최적.
    beta = params.get("blend.income", 0.2)
    cap = _fnum(subject.get("gu_cap"))
    # ★ 추정가 블렌드 임대료 = 팀 실입력(total_rent) → 마스터 추정 — 배치(build_sale_est)와 동일 기준.
    #   주변임대 토글(rent_apply)은 수익률·임대표에만 반영. 여기에 섞으면 무오버레이인데도
    #   검색 핀(배치)과 리포트 추정가가 계통적으로 어긋남(2026-08-06 역삼 619-16, −2.8% 사례).
    cur_rent = _fnum(subject.get("total_rent"))
    ann_rent = (cur_rent * 12) if cur_rent else _fnum(subject.get("est_annual_rent"))
    blended = report_calc.blend_income(ap.get("fair_price"), ann_rent, cap, beta)
    if blended != ap.get("fair_price"):
        subj_py = (_fnum(subject.get("total_area")) or 0) / report_calc.M2_PER_PYEONG
        subj_lpy = (_fnum(subject.get("land_area")) or 0) / report_calc.M2_PER_PYEONG
        ap = {**ap, "fair_price": blended,
              "avg_per_pyeong": round(blended / subj_py) if subj_py else ap.get("avg_per_pyeong"),
              "avg_per_land": round(blended / subj_lpy) if subj_lpy else ap.get("avg_per_land")}
    # 3층 가격(2026-07-29): 매도희망가(건물주) · 매매가(중개인, 기본=추정가) · 빌탐정 추정가(시스템=fair_price)
    ask = _fnum(subject.get("ask_price"))                            # 매도희망가 = 건물주 원하는 값(오버레이)
    broker = _fnum(subject.get("sale_price")) or ap.get("fair_price")  # 매매가 = 중개인 판단(오버레이), 없으면 추정가
    roi = report_calc.expected_roi(rent, broker or ap["fair_price"])   # 수익률은 실제 매수기준가(매매가)로
    gap = round(ask - broker) if (ask and broker) else None          # 협의금액 = 매도희망가 − 매매가
    if ap.get("breakdown"):   # 수익환원 블렌드 정보 보강(리빌용)
        ap["breakdown"] = {**ap["breakdown"], "beta": round(beta, 2),
                           "income_val": round(ann_rent / cap) if (ann_rent and cap) else None,
                           "final": ap.get("fair_price")}
    # 공시지가 맥락(05 페이지): 주변 사례 공시지가 중앙값(원/㎡) + 공시배율(실거래÷공시총액)
    import statistics as _st
    _pm2 = [c["gongsi_total"] / c["land_area"] for c in comps if c.get("gongsi_total") and c.get("land_area")]
    _mult = [c["price"] / c["gongsi_total"] for c in comps if c.get("gongsi_total") and c.get("price")]
    gongsi_ctx = {"nbhd_per_m2": round(_st.median(_pm2)) if _pm2 else None,
                  "mult": round(_st.median(_mult), 2) if _mult else None, "n": len(_pm2)}
    # 임대 요약(06 페이지): 층수·현재/주변 총임대료·보증금 집계
    rent_summary = ({"floor_count": len(rent_apply["floors"]),
                     "cur_rent": round(rent_apply["cur_rent"]), "mkt_rent": round(rent_apply["applied_rent"]),
                     "cur_deposit": round(rent_apply["cur_deposit"]), "mkt_deposit": round(rent_apply["applied_deposit"]),
                     "nearby_roi": rent_apply.get("nearby_roi")}
                    if rent_apply else None)
    return {**ap, "expected_roi": roi, "gap": gap, "gongsi_ctx": gongsi_ctx, "rent_summary": rent_summary,
            "ask_price": round(ask) if ask else None,               # 매도희망가
            "broker_price": round(broker) if broker else None,     # 매매가(중개인)
            "applied_rent": round(rent) if rent else None, "expected_deposit": round(deposit) if deposit else None,
            "rent_floors": rent_apply["floors"] if rent_apply else None,
            "market_applied": bool(apply_market and rent_apply)}


def _outlier_bounds(vals: list[float]) -> tuple[float, float] | None:
    """평단가 이상치 [하한,상한]. 표본 충분(≥10)=IQR 1.5, 소표본=MAD 수정z(3.5, 소표본서도 견고).
    3건 미만이거나 편차 0이면 판정 불가(None). 배치·라이브 공용 규칙."""
    import statistics
    if len(vals) < 3:
        return None
    med = statistics.median(vals)
    if len(vals) >= 10:
        q1, q3 = statistics.quantiles(vals, n=4)[0], statistics.quantiles(vals, n=4)[2]
        iqr = q3 - q1
        return (q1 - 1.5 * iqr, q3 + 1.5 * iqr)
    mad = statistics.median([abs(x - med) for x in vals])
    if mad == 0:
        return None
    d = 3.5 * mad / 0.6745   # Iglewicz-Hoaglin 수정 z-score 임계 3.5
    return (med - d, med + d)


def _flag_comp_outliers(comps: list[dict]) -> None:
    """평단가 이상치 플래그(F-17 기본 제외)."""
    b = _outlier_bounds([c["per_area"] for c in comps])
    if b is None:
        return
    lo, hi = b
    for c in comps:
        if not (lo <= c["per_area"] <= hi):
            c["is_outlier"] = True



def _json_safe(v):
    """스냅샷은 JSON으로 저장된다 — Decimal·date가 그대로 들어가면 터진다."""
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    f = _fnum(v)
    if f is not None and not isinstance(v, str):
        return f
    return str(v)


async def _briefing_snapshot(building_pk: str, b: dict, team_id: int) -> dict:
    """브리핑 = 그 건물에 대한 사실만. 추정가·매력도·미래가치 같은 우리 판단은 넣지 않는다
    (그건 빌탐정 리포트의 몫). 대장값 + 팀이 입력한 임대내역 + 올린 서류·사진 + 사무소 정보."""
    office = await pool().fetchrow(
        """SELECT name, office_name, agent_name, agent_title, phone, fax, email, office_addr,
                  (logo_path IS NOT NULL) AS has_logo
           FROM app.teams WHERE id=$1""", team_id)

    # 층별 임대내역 — 팀 입력이 있는 층은 실제값, 없으면 대장 추정(층별임대 표와 같은 하이브리드)
    hidden = {r["floor"] for r in await pool().fetch(
        "SELECT floor FROM app.floor_hidden WHERE building_pk=$1 AND team_id=$2", building_pk, team_id)}
    team_rows = await pool().fetch(
        """SELECT floor, unit_no, use, contract_area, deposit, rent, maintenance, is_vacant
           FROM app.floor_rents WHERE building_pk=$1 AND team_id=$2 AND deleted_at IS NULL""",
        building_pk, team_id)
    team_floors = {r["floor"] for r in team_rows}
    est_rows = await pool().fetch(
        """SELECT fo.floor, fo.use, fo.floor_area, fre.rent_est, fre.deposit_est
           FROM master.floor_outline fo LEFT JOIN master.floor_rent_est fre USING (building_pk, seq)
           WHERE fo.building_pk=$1 ORDER BY fo.seq""", building_pk)
    floors = [
        {"floor": r["floor"], "unit_no": r["unit_no"], "use": r["use"],
         "contract_area": _fnum(r["contract_area"]),
         "deposit": r["deposit"], "rent": r["rent"], "maintenance": r["maintenance"],
         "is_vacant": r["is_vacant"], "est": False}
        for r in team_rows if r["floor"] not in hidden
    ] + [
        {"floor": r["floor"], "unit_no": None, "use": r["use"],
         "contract_area": _fnum(r["floor_area"]),
         "deposit": r["deposit_est"], "rent": r["rent_est"], "maintenance": None,
         "is_vacant": None, "est": True}
        for r in est_rows if r["floor"] not in hidden and r["floor"] not in team_floors
    ]
    floors.sort(key=lambda x: _floor_key(x["floor"]), reverse=True)

    photos = [{**dict(r), "sort_order": int(r["sort_order"])} for r in await pool().fetch(
        """SELECT id, kind::text, caption, sort_order, transform FROM app.photos
           WHERE building_pk=$1 AND team_id=$2 AND deleted_at IS NULL
           ORDER BY photos.kind, sort_order, id""", building_pk, team_id)]

    # 법정 용적률·건폐율 — 입체 지적도가 '남은 여유'를 그리려면 필요. 필지 규제에서 뽑는다.
    # 건폐율도 같이 싣는다: 기존 건축물이 법정을 넘는 경우가 흔하고(종로2가 71-6은 97.98% vs 법정 60%),
    # 그건 '신축하면 바닥이 줄어든다'는 뜻이라 브리핑에서 빠지면 안 되는 사실이다.
    lr = await pool().fetchrow(
        """SELECT max(pr.legal_far) far, max(pr.legal_bcr) bcr FROM master.building_parcels bp
           JOIN master.parcels pr ON pr.pnu = bp.pnu WHERE bp.building_pk = $1""", building_pk)
    if lr:
        b = {**b, "legal_far": _parse_far(lr["far"]), "legal_bcr": _parse_far(lr["bcr"])}

    # 접도 폭 — 배치(0033) 산출값. 팀 수기 오버레이가 있으면 그쪽이 이긴다(_assemble이 이미 덮음).
    rw = await pool().fetchrow(
        "SELECT front_m, side_m, rear_m, front_rn FROM master.building_road WHERE building_pk=$1", building_pk)
    if rw:
        # numeric → float. 스냅샷은 JSON이라 Decimal이 들어가면 직렬화에서 터진다.
        b = {**b, **{f"road_{k}": b.get(f"road_{k}") or _fnum(rw[k]) for k in ("front_m", "side_m", "rear_m")},
             "road_front_rn": rw["front_rn"]}

    # 매매가는 팀 수기값 우선, 없으면 배치 추정가(_assemble이 안 싣는 값이라 여기서 채운다)
    if b.get("sale_est") is None:
        b = {**b, "sale_est": await pool().fetchval(
            "SELECT sale_est FROM master.building_sale_est WHERE building_pk=$1", building_pk)}

    # bcr_src — 건폐율이 대장값인지 계산인지 추정인지. 추정을 사실로 내밀지 않으려면 화면이 알아야 한다(0040).
    keep = ("addr", "road_addr", "land_area", "total_area", "build_area", "far_area", "bcr", "bcr_src", "far",
            "floors_above", "floors_below", "height", "parking", "elevator", "approval_ymd", "remodel_ymd",
            "use_zone", "main_use_name", "etc_use", "structure", "jimok", "land_use", "road_frontage",
            "road_front_m", "road_side_m", "road_rear_m", "road_front_rn",
            "legal_far", "legal_bcr", "briefing_comment",
            "shape", "slope", "station_dist", "gongsi_latest", "sale_price", "sale_est",
            "last_sale_price", "last_sale_ym", "lng", "lat")
    # 좌표 — _assemble이 싣지 않는다. 위치도 지도가 이 값으로 중심을 잡는다.
    pt = await pool().fetchrow(
        "SELECT ST_X(geom) AS lng, ST_Y(geom) AS lat FROM master.buildings WHERE building_pk=$1", building_pk)
    if pt:
        b = {**b, "lng": _fnum(pt["lng"]), "lat": _fnum(pt["lat"])}

    # 입체 지적도용 — 필지 폴리곤과 접한 도로 구간. 지도 타일 없이 이 도형만으로 그린다.
    parcel = await pool().fetchval(
        """SELECT ST_AsGeoJSON(ST_Union(p.geom)) FROM master.building_parcels bp
           JOIN master.parcels p ON p.pnu = bp.pnu WHERE bp.building_pk = $1""", building_pk)
    roads = [dict(r) for r in await pool().fetch(
        """SELECT r.rn, r.road_bt, ST_AsGeoJSON(r.geom) AS geojson
           FROM master.road_segment r
           WHERE ST_DWithin(r.geom::geography,
                 (SELECT geom::geography FROM master.buildings WHERE building_pk=$1), 40)
           ORDER BY r.road_bt DESC LIMIT 12""", building_pk)]

    return {
        "kind": "briefing",
        "parcel": json.loads(parcel) if parcel else None,
        "roads": [{"rn": r["rn"], "road_bt": _fnum(r["road_bt"]),
                    "geojson": json.loads(r["geojson"])} for r in roads],
        # Decimal·date 등이 섞여 있어 숫자는 float, 나머지는 문자열로 눕힌다(JSON 직렬화 안전).
        "subject": {k: _json_safe(b.get(k)) for k in keep},
        "office": dict(office) if office else {},
        "floors": floors,
        "photos": photos,
    }


async def run_generate(report_id: int, team_id: int) -> dict:
    """잡 본체. 성공=크레딧 차감+완료 / 실패=failed+미차감.
    산출물은 result_json 스냅샷 하나 — 웹 리포트(/reports/:id)가 이걸 렌더한다.
    PPTX 내보내기는 폐지(웹 덱과 구성이 어긋나 유지 비용만 컸다)."""
    try:
        async with tx() as conn:
            rep = await conn.fetchrow("SELECT * FROM app.reports WHERE id=$1", report_id)
            if not rep:
                return {"ok": False, "reason": "not found"}
            await conn.execute("UPDATE app.reports SET status='generating' WHERE id=$1", report_id)

        fs_version, params, time_adjust = await _load_formula_params()
        b = await _assemble(rep["building_pk"], team_id)
        vs = value_score.compute(b, params) if rep["kind"] == "analysis" else None

        syn = None
        if rep["kind"] == "analysis":   # F-17 적정매매가 · F-18 예상수익률
            opt = rep["options_json"]
            opt = json.loads(opt) if isinstance(opt, str) else (opt or {})
            overrides = opt.get("overrides") or {}
            # 오버레이(유저 comp 제외) 있으면 그대로, 없으면 무오버레이 baseline(배치 동일).
            exclude = set(opt["exclude"]) if opt.get("exclude") else None
            comps = await _load_comps(rep["building_pk"], b, params, exclude, overrides)
            rent_apply = await _nearby_rent_apply(rep["building_pk"], b, team_id)   # 비교표·주변수익률 데이터(항상)
            syn = synthesize(b, vs["score"], comps, params, time_adjust, rent_apply,
                             apply_market=opt.get("include_market", False))   # 기본 OFF = 배치 수익률과 동일
            # ★ 오버레이가 하나라도 걸렸으면 안 쓴다 — 마스터는 팀 공용이라 한 팀의 가정이
            #   전 팀의 기본값이 되면 안 된다(추정→정본 금지).
            if (syn.get("fair_price") and not exclude and not overrides
                    and not opt.get("include_market") and not _fnum(b.get("total_rent"))):
                await _save_master_fair(rep["building_pk"], syn["fair_price"], b)

        # 웹 보고서(/reports/:id) 렌더용 synthesis 스냅샷 — 생성 시점 값 고정(analysis만).
        # PPT도 이 스냅샷에서 굽는다(웹 덱과 같은 입력 → 두 산출물의 값이 어긋날 수 없음).
        snapshot = None
        if rep["kind"] == "analysis" and vs and syn:
            ut = await _use_type(rep["building_pk"], b)   # F-20 투자 유형
            _attach_future(ut, syn.get("rent_summary"))   # F-21 미래가치
            snapshot = {
                "subject": {"addr": b.get("addr"), "score": vs["score"], "grade": vs["grade"],
                            "items": vs["items"], "total_area": _fnum(b.get("total_area")),
                            "land_area": _fnum(b.get("land_area")), "sale_price": _fnum(b.get("sale_price")),
                            "total_rent": _fnum(b.get("total_rent"))},
                "preview": {"score": vs["score"], "grade": vs["grade"], "fair_price": syn["fair_price"],
                            "avg_per_pyeong": syn["avg_per_pyeong"], "avg_per_land": syn.get("avg_per_land"),
                            "expected_roi": syn["expected_roi"],
                            "gap": syn["gap"], "ask_price": syn["ask_price"], "broker_price": syn.get("broker_price"),
                            "applied_rent": syn.get("applied_rent"), "expected_deposit": syn.get("expected_deposit"),
                            "market_applied": syn.get("market_applied", False), "breakdown": syn.get("breakdown"),
                            "gongsi_ctx": syn.get("gongsi_ctx"), "use_type": ut,
                            "rent_summary": syn.get("rent_summary"),
                            "rent_floors": syn.get("rent_floors"), "comps_used": syn.get("comps_used")},
            }

        if rep["kind"] == "briefing":
            snapshot = await _briefing_snapshot(rep["building_pk"], b, team_id)

        cost = settings.cost_briefing if rep["kind"] == "briefing" else settings.cost_analysis
        async with tx() as conn:  # 성공 트랜잭션: 차감+완료+워터마크 원자
            await conn.execute("SELECT app.deduct_credit($1,$2,$3)", rep["account_id"], cost, report_id)
            await conn.execute(
                """UPDATE app.reports SET status='done', completed_at=now(),
                     credits_spent=$2, formula_set_version=$3, result_json=$6,
                     master_version=(SELECT version FROM master.master_version),
                     source_watermark=COALESCE(app.building_watermark($4,$5), now())
                   WHERE id=$1""",
                report_id, cost, fs_version, rep["building_pk"], team_id,
                json.dumps(snapshot) if snapshot else None,
            )
        return {"ok": True, "credits": cost}
    except Exception as e:  # 실패: 미차감
        async with tx() as conn:
            await conn.execute(
                "UPDATE app.reports SET status='failed', failed_reason=$2 WHERE id=$1",
                report_id, str(e)[:500],
            )
        return {"ok": False, "reason": str(e)}


class GenerateIn(BaseModel):
    report_id: int
    team_id: int


@router.post("/generate-report")
async def generate_report(body: GenerateIn):
    """Cloud Tasks 진입점(프로덕션)."""
    return await run_generate(body.report_id, body.team_id)
