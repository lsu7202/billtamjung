"""검색: 주소 자동완성 + 2열 목록(내매물/일반) + 영역(폴리곤) 검색.
specs S01 §3.1a(자동완성)·§3.4(3열·열별 페이징)·§3.5(표시값)·§3.6c(영역).
"""
import asyncio
import json
import re
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from ..core.db import pool
from ..core.hangul import from_qwerty, looks_latin
from ..core.deps import current_user, CurrentUser

router = APIRouter(prefix="/search", tags=["search"])


class Suggestion(BaseModel):
    kind: str = "building"             # building | region | station | vacant — 클릭 동작 분기(§3.1a 개편)
    building_pk: str | None = None
    addr: str
    lng: float | None = None
    lat: float | None = None
    is_mine: bool = False              # 내(팀) 등록 매물 — 자동완성 우선·배지
    price: int | None = None           # 매매가(팀 수기 ?? 추정가) — 후보에 표시
    sub: str | None = None             # 부가표시(역=호선, 지역=매물수, 나대지=면적)
    pnu: str | None = None             # 나대지는 building_pk 가 없다 — 필지 자체가 대상이다


# 지역(동·구 중심좌표)·역 — master 버전 키 인메모리 캐시(즉시 매칭·DB 왕복 없음)
_suggest_cache: dict = {}


async def _suggest_refs() -> tuple[list, list]:
    """지역·역 참조 목록. 지역은 미리 집계한 master.region_index(0028)에서 읽는다.
    예전엔 요청 스레드가 buildings 전수 GROUP BY(실측 6.9s)를 직접 돌려서 인스턴스가 새로
    뜰 때마다 첫 사용자가 그 비용을 다 물었다."""
    ver = await pool().fetchval("SELECT version FROM master.master_version")
    if ver in _suggest_cache:
        return _suggest_cache[ver]
    regions = [dict(r) for r in await pool().fetch(
        "SELECT gu, dong, bjd_code, lng, lat, cnt FROM master.region_index")]
    gus: dict[str, dict] = {}          # 구 단위(동 평균의 평균)
    for r in regions:
        g = gus.setdefault(r["gu"], {"gu": r["gu"], "lng": 0.0, "lat": 0.0, "cnt": 0, "n": 0})
        g["lng"] += r["lng"]; g["lat"] += r["lat"]; g["cnt"] += r["cnt"]; g["n"] += 1
    gu_list = [{"gu": g["gu"], "lng": g["lng"]/g["n"], "lat": g["lat"]/g["n"], "cnt": g["cnt"]} for g in gus.values()]
    stations = [dict(r) for r in await pool().fetch(
        """SELECT name, string_agg(route, '·' ORDER BY route) AS routes,
                  avg(lng) AS lng, avg(lat) AS lat
           FROM master.subway_stations GROUP BY name""")]
    _suggest_cache.clear()
    _suggest_cache[ver] = (regions + gu_list, stations)
    return _suggest_cache[ver]


# 건물 후보 — 접두/부분일치 공통 부분(팀 매물 여부·표시가격 조인)
_BUILDING_SUGGEST = """
    SELECT b.building_pk, b.addr, ST_X(b.geom) AS lng, ST_Y(b.geom) AS lat,
           bb.total_area, bb.floors_above,
           (l.assignee_account_id IS NOT NULL) AS is_mine,
           COALESCE(so.value::bigint, se.sale_est) AS price
      FROM ({cand}) b
      JOIN master.buildings bb ON bb.building_pk = b.building_pk
      LEFT JOIN app.listings l
        ON l.building_pk = b.building_pk AND l.team_id = $2 AND l.assignee_account_id IS NOT NULL
      LEFT JOIN app.overlays so
        ON so.target_id = b.building_pk AND so.team_id = $2 AND so.target_type = 'building'
           AND so.field = 'sale_price' AND so.value ~ '^[0-9]+$'
      LEFT JOIN master.building_sale_est se ON se.building_pk = b.building_pk
     ORDER BY (l.assignee_account_id IS NOT NULL) DESC, length(b.addr), b.addr
     LIMIT $3
"""

@router.get("/suggest", response_model=list[Suggestion])
async def suggest(q: str = Query(min_length=1), user: CurrentUser = Depends(current_user)):
    """통합 자동완성 — 지역(동·구) + 지하철역 + 건물주소(§3.1a 개편, 지오코딩 폴백 폐지).
    지역·역=인메모리 캐시 즉시 매칭 / 건물=동+지번 접두(btree) 우선, 모자라면 부분일치(trgm).
    한/영 전환을 잊고 친 입력은 자판을 되돌려 검색한다(로그에 EHSDMLEHD=돈의동 실사례)."""
    norm = q.replace(" ", "")
    if looks_latin(norm):
        norm = from_qwerty(norm)
    # 결과는 「삼성동 78번지」로 보여주면서 그대로 치면 안 걸렸다(2026-08-28).
    # 색인(master.dong_jibun)이 「번지」를 떼고 만들어지니, 입력도 같은 규칙으로 다듬는다.
    # 「서울특별시/서울시」와 구 이름도 같은 이유로 뗀다 — 색인은 동+지번만 담는다.
    norm = re.sub(r"^서울(특별시|시)?", "", norm)
    norm = re.sub(r"^[가-힣]{1,4}(구|군)(?=[가-힣]{2,}(동|가|로|street)?)", "", norm)
    norm = norm.replace("번지", "")
    out: list[Suggestion] = []

    regions, stations = await _suggest_refs()
    # 지역: 동 접두 우선 → 구 접두 (예: '논현' → 강남구 논현동·논현1동…)
    for r in regions:
        if len(out) >= 3: break
        dong = r.get("dong")
        if dong and dong.startswith(norm):
            out.append(Suggestion(kind="region", addr=f"서울특별시 {r['gu']} {dong}",
                                  lng=r["lng"], lat=r["lat"], sub=f"매물 {r['cnt']:,}동"))
        elif not dong and r["gu"].startswith(norm):
            out.append(Suggestion(kind="region", addr=f"서울특별시 {r['gu']}",
                                  lng=r["lng"], lat=r["lat"], sub=f"매물 {r['cnt']:,}동"))
    # 역: '강남역' → '강남' 매칭도 지원(끝의 '역' 제거)
    st_q = norm[:-1] if norm.endswith("역") and len(norm) > 1 else norm
    st_hits = [s for s in stations if s["name"].startswith(st_q)]
    st_hits.sort(key=lambda s: (s["name"] != st_q, s["name"]))   # 정확일치 우선
    for s in st_hits[:2]:
        out.append(Suggestion(kind="station", addr=f"{s['name']}역", lng=s["lng"], lat=s["lat"], sub=s["routes"]))

    need = 7 - len(out)
    seen: set[str] = set()
    rows: list = []

    # ① 동+지번 접두(0028 인덱스) — 사용자는 '역삼동619'처럼 동부터 친다. 2~4ms.
    #    jibun_norm은 '강남구역삼동619-16'처럼 구를 포함해서 접두가 맞지 않았다(예전 pri 로직이 죽어 있던 이유).
    if need > 0:
        async with pool().acquire() as _conn, _conn.transaction():
            # 비트맵 스캔은 인덱스 순서를 잃어 후보 전체를 모아 정렬한다(1글자 179ms).
            # 정렬된 인덱스 스캔을 강제하면 LIMIT에서 조기 종료된다.
            await _conn.execute("SET LOCAL enable_bitmapscan = off")
            rows = list(await _conn.fetch(
                _BUILDING_SUGGEST.format(cand="""
                    SELECT building_pk, addr, geom FROM master.buildings
                     WHERE master.dong_jibun(addr) LIKE $1 || '%'
                     ORDER BY master.dong_jibun(addr) LIMIT 60"""),
                norm, user.team_id, need))
        seen = {r["building_pk"] for r in rows}

    # 매물번호·소유자명 — 「BT-1292 있잖아요」·「김영순씨 건물」로도 찾는다(2026-08-28).
    #    주소만 받으면 전화로 번호를 부르는 현장 어법이 검색으로 안 이어진다.
    # ★ trgm **앞**에 둔다: 팀 매물은 몇 건뿐이라 늘 0.15s 안에 끝나는데,
    #   뒤에 두면 0.9s 짜리 trgm 을 먼저 태우고 나서야 여기 온다(2026-08-28 실측 2.4s).
    left = need - len(rows)
    if left > 0 and len(q) >= 2:
        biz = await pool().fetch(
            """SELECT l.building_pk, COALESCE(b.addr, vp.addr) AS addr, l.listing_no,
                      o.name AS owner_name,
                      ST_X(ST_Centroid(b.geom)) AS lng, ST_Y(ST_Centroid(b.geom)) AS lat
                 FROM app.listings l
                 LEFT JOIN master.buildings b ON b.building_pk = l.building_pk
                 LEFT JOIN master.vacant_parcels vp ON l.building_pk = 'P' || vp.pnu
                 LEFT JOIN app.owners o ON o.id = l.owner_id AND o.deleted_at IS NULL
                WHERE l.team_id = $1
                  AND (l.listing_no ILIKE '%' || $2 || '%' OR o.name ILIKE '%' || $2 || '%')
                ORDER BY (l.listing_no ILIKE $2 || '%') DESC, l.listing_no
                LIMIT $3""",
            user.team_id, q, left)
        # seen 은 ① 접두가 채운 것 — 여기서 덮으면 아래 trgm 의 중복 제거가 틀어진다
        for r in biz:
            if r["building_pk"] in seen or not r["addr"]:
                continue
            hit = r["listing_no"] if (r["listing_no"] and q.lower() in r["listing_no"].lower()) else r["owner_name"]
            out.append(Suggestion(kind="building", building_pk=r["building_pk"], addr=r["addr"],
                                  lng=r["lng"], lat=r["lat"], is_mine=True, sub=hit))
            seen.add(r["building_pk"])
            need -= 1          # 여기서 채운 만큼 아래 trgm 이 덜 돈다(안 돌 수도 있다)
    # ② 접두로 모자라면 부분일치(trgm). 2글자 이하는 trigram 선택도가 없어 190~270ms가 나오므로
    #    건너뛴다 — 그 길이에선 위 지역·역·접두 결과가 이미 더 쓸모 있다.
    if len(rows) < need and len(norm) >= 3:
        async with pool().acquire() as _conn, _conn.transaction():
            # 플래너가 seq+LIMIT을 고르면 매칭 위치에 따라 0.01~5s로 널뜀(실측) → GIN 강제
            await _conn.execute("SET LOCAL enable_seqscan = off")
            extra = await _conn.fetch(
                _BUILDING_SUGGEST.format(cand="""
                    SELECT building_pk, addr, geom FROM master.buildings
                     WHERE jibun_norm LIKE '%' || $1 || '%' LIMIT 30"""),
                norm, user.team_id, need)
        rows += [r for r in extra if r["building_pk"] not in seen]

    # 한 필지에 여러 동(학교·상가 단지)이면 주소가 똑같은 줄이 나란히 선다 — 연면적·층수를
    # 곁말로 붙여 가른다. 주소가 하나뿐이면 곁말도 없다(늘 붙이면 소음이다). (2026-08-27)
    dup = {a for a in (r["addr"] for r in rows[:need]) if sum(1 for x in rows[:need] if x["addr"] == a) > 1}
    def _sub(r):
        if r["addr"] not in dup:
            return None
        parts = []
        if r["total_area"]:
            parts.append(f"연 {round(float(r['total_area']) / 3.305785):,}평")
        if r["floors_above"]:
            parts.append(f"{r['floors_above']}층")
        return " · ".join(parts) or None
    out += [Suggestion(kind="building", building_pk=r["building_pk"], addr=r["addr"], lng=r["lng"],
                       lat=r["lat"], is_mine=r["is_mine"], price=r["price"], sub=_sub(r))
            for r in rows[:need]]

    # ③ 나대지 — 건물이 없는 「대」 필지(2026-08-27). 건물 후보를 다 채우고 남은 자리에만 붙인다:
    #    같은 주소를 쳤을 때 건물이 먼저 나와야 한다. 빈 땅은 그다음이다.
    #    건물이 서 있지 않다고 매물이 아닌 것은 아니다 — 신축이 되는 땅이다.
    left = 7 - len(out)
    if left > 0 and len(norm) >= 2:
        async with pool().acquire() as _conn, _conn.transaction():
            await _conn.execute("SET LOCAL enable_bitmapscan = off")
            vac = await _conn.fetch(
                """SELECT pnu, addr, ST_X(ST_Centroid(geom)) AS lng, ST_Y(ST_Centroid(geom)) AS lat,
                          area
                     FROM master.vacant_parcels
                    WHERE master.dong_jibun(addr) LIKE $1 || '%'
                    ORDER BY master.dong_jibun(addr) LIMIT $2""",
                norm, left)
        # price 는 비운다 — 여긴 매매가 자리다. 공시지가 총액을 넣었더니 봉은사 부지가
        # 「6조 6,329억」으로 떠서 매물가로 읽혔다. 땅값과 팔 값은 다른 값이다.
        out += [Suggestion(kind="vacant", pnu=r["pnu"], addr=r["addr"], lng=r["lng"], lat=r["lat"],
                           sub=f"나대지 · {round(float(r['area']) / 3.305785):,}평")
                for r in vac]
    return out


_regions_cache: dict = {}   # master_version 키 캐시(적재 시에만 변함)


@router.get("/regions")
async def regions(_: CurrentUser = Depends(current_user)):
    """구·법정동 목록(3단 캐스케이드용). 미리 집계한 master.region_index(0028) + 버전별 인메모리 캐시.
    예전엔 buildings 전수 GROUP BY라 인스턴스별 첫 호출이 9.1s였다(필터 모달 여는 순간)."""
    ver = await pool().fetchval("SELECT version FROM master.master_version")
    if ver in _regions_cache:
        return _regions_cache[ver]
    rows = await pool().fetch(
        "SELECT sgg_code, bjd_code, gu, dong, cnt FROM master.region_index ORDER BY gu, dong")
    out: dict[str, dict] = {}
    for r in rows:
        gu = out.setdefault(r["gu"], {"sgg_code": r["sgg_code"], "dongs": []})
        gu["dongs"].append({"bjd_code": r["bjd_code"], "dong": r["dong"], "count": r["cnt"]})
    _regions_cache.clear()
    _regions_cache[ver] = out
    return out


class Filters(BaseModel):
    """S01b 속성 필터 — master.buildings 컬럼 매핑 필드. None/빈리스트=미적용.
    (UI엔 60필드지만 여기 없는 건 app레이어/미보유라 서버 필터 미지원 — 점진 확장)

    extra=forbid: 모르는 필드는 422로 거절한다. 기본값(ignore)이면 프론트가 필드명을 잘못
    보냈을 때 그 조건만 조용히 빠져 '필터를 걸었는데 전체가 나오는' 형태로만 드러난다.
    실제로 그 부류의 버그를 겪었다."""
    model_config = ConfigDict(extra="forbid")

    bjd_code: str | None = None       # 법정동(prefix: 구=5자리·동=10자리)
    # 한 매물로 좁히기 — 매수자 조건에 이 매물이 걸리는지 볼 때 쓴다(S04 「맞는 매수자」).
    # 매칭용 쿼리를 따로 만들면 검색과 언젠가 어긋나므로, 같은 엔진을 한 행으로 좁혀 쓴다.
    building_pk: str | None = None
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
    # ── 추가 마스터 컬럼 ──
    parcel_area_min: float | None = None     # 토지면적(㎡)
    parcel_area_max: float | None = None
    far_area_min: float | None = None        # 용적률산정용연면적(㎡)
    far_area_max: float | None = None
    remodel_years_min: int | None = None     # 대수선 경과연수
    remodel_years_max: int | None = None
    legal_bcr_min: float | None = None       # 법정건폐율(%)
    legal_bcr_max: float | None = None
    legal_far_min: float | None = None       # 법정용적률(%)
    legal_far_max: float | None = None
    bcr_slack_min: float | None = None       # 건폐율 여유분(%p)
    bcr_slack_max: float | None = None
    far_slack_min: float | None = None       # 용적률 여유분(%p)
    far_slack_max: float | None = None
    # ── classified 계산값(매매가·수익률·평단가·공시·실거래·집계) ──
    price_min: int | None = None             # 매매가(원)
    price_max: int | None = None
    # 팀 값과 추정값은 **다른 항목**이다(2026-08-27). 예전엔 매매가 칸에 추정가를 채워 넣어
    # 매매가로 검색했는데, 추정가가 제 칸을 가졌으니 각자 걸린다.
    sale_est_min: int | None = None          # 빌탐정 추정가(원)
    sale_est_max: int | None = None
    roi_est_min: float | None = None         # 추정 수익률(%) = 추정임대 ÷ 추정가
    roi_est_max: float | None = None
    # 추정 임대(master.building_rent_est) — 20.1만동에 값이 있는데 필터로는 못 찾고 있었다
    rent_est_min: int | None = None          # 추정 월임대료(원)
    rent_est_max: int | None = None
    deposit_est_min: int | None = None       # 추정 보증금(원)
    deposit_est_max: int | None = None
    # 팀 매매가로 나눈 파생 — 추정가로 나눈 것과 다른 컬럼이다(같은 이름으로 부르지 않는다)
    pp_land_team_min: int | None = None
    pp_land_team_max: int | None = None
    pp_total_team_min: int | None = None
    pp_total_team_max: int | None = None
    gongsi_ratio_team_min: float | None = None
    gongsi_ratio_team_max: float | None = None
    roi_min: float | None = None             # 수익률(%) = 총임대료 ÷ 팀 매매가
    roi_max: float | None = None
    roi_exvac_min: float | None = None       # 수익률 공실제외(%)
    roi_exvac_max: float | None = None
    pp_land_min: int | None = None           # 평단가 대지(원/평)
    pp_land_max: int | None = None
    pp_total_min: int | None = None          # 평단가 연면적(원/평)
    pp_total_max: int | None = None
    deposit_total_min: int | None = None     # 총보증금(원)
    deposit_total_max: int | None = None
    rent_total_min: int | None = None        # 총임대료(월, 원)
    rent_total_max: int | None = None
    mgmt_total_min: int | None = None        # 총관리비(월, 원)
    mgmt_total_max: int | None = None
    vacant: str | None = None                # 총공실 있음/없음
    gongsi_total_min: int | None = None      # 공시지가 총액(원)
    gongsi_total_max: int | None = None
    gongsi_ratio_min: float | None = None    # 총공시/매매가(%)
    gongsi_ratio_max: float | None = None
    gongsi_up5_min: float | None = None      # 공시 상승률 5년(%)
    gongsi_up5_max: float | None = None
    gongsi_up10_min: float | None = None     # 공시 상승률 10년(%)
    gongsi_up10_max: float | None = None
    sale_pnl_min: float | None = None        # 실거래손익(%)
    sale_pnl_max: float | None = None
    sale_count_min: int | None = None        # 실거래횟수
    sale_count_max: int | None = None
    pop_day_min: float | None = None         # 유동인구(명) — 생활인구 250m 격자 주간 평균 실측
    pop_day_max: float | None = None
    # ── 업무(app.listings 오버레이) ──
    urgencies: list[str] | None = None       # 긴급도
    owner_types: list[str] | None = None     # 소유자타입
    relations: list[str] | None = None       # 관계
    cooperations: list[str] | None = None    # 협조도
    kindnesses: list[str] | None = None      # 친절도
    meongdos: list[str] | None = None        # 명도
    use_changes: list[str] | None = None     # 용도변경
    myeolsils: list[str] | None = None       # 멸실
    assignees: list[int] | None = None       # 담당자(account_id)
    owner_name: str | None = None            # 소유자명(부분일치)
    listing_no: str | None = None            # 매물번호(부분일치)
    intent: str | None = None                # 매수의향서 원함/원치않음
    has_phone: str | None = None             # 전화번호 있음/없음
    has_photo: str | None = None             # 사진 있음/없음
    received_from: str | None = None         # 접수일 YYYY-MM-DD
    received_to: str | None = None


class SearchIn(BaseModel):
    polygon: dict | None = None       # GeoJSON — 있으면 지역범위 대체(§3.6c)
    mine_only: bool = False           # 지역·영역 없이 '내 매물'만 — 첫 화면(로그인 직후) 기본 목록
    filters: Filters = Filters()
    # 접어두기(hidden)는 **화면이 거른다**(2026-08-29). 서버로 안 온다.
    # 조건에 딸린 값이라 저장 조건과 함께 다니고 다른 조건에선 다시 보이는데,
    # 그걸 질의 조건으로 두니 접을 때마다 전체를 다시 불러왔다 — 지도가 초기화되고
    # 작업 흐름이 끊겼다. 게다가 building_pk 는 최장 22자리 text 라 프론트가 숫자로
    # 바꿔 보내면 정밀도가 깨져(1e21) 검색 전체가 422 로 죽었다(11,270동이 해당).
    sort: str = "price"               # price|roi|addr
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


def _filter_sql(f: Filters, args: list) -> tuple[str, str]:
    """속성 필터 → (마스터 WHERE절, 외부 WHERE절). 마스터=classified 내부(b.·조인) / 외부=classified 계산값 필터.
    반환 두 절 모두 앞에 ' AND '가 붙어 바로 이어붙이기 가능(빈 문자열이면 없음)."""
    m: list[str] = []   # classified 내부(b. 컬럼·조인 l.)
    o: list[str] = []   # 외부(classified SELECT 계산값 별칭)

    def add(lst, cond, val):
        args.append(val)
        lst.append(cond.format(i=len(args)))
    def rng(lst, col, lo, hi):
        if lo is not None: add(lst, f"{col} >= ${{i}}", lo)
        if hi is not None: add(lst, f"{col} <= ${{i}}", hi)
    def anyof(lst, col, vals):
        if vals: add(lst, f"{col} = ANY(${{i}})", vals)

    # ── 마스터(b.) — classified WHERE ──
    if f.building_pk:
        add(m, "b.building_pk = ${i}", f.building_pk)
    if f.bjd_code:
        add(m, "b.bjd_code LIKE ${i} || '%'", f.bjd_code)
    anyof(m, "b.use_zone", f.use_zones)
    anyof(m, "b.jimok", f.jimoks)
    anyof(m, "b.road_frontage", f.road_frontages)
    anyof(m, "b.shape", f.shapes)
    anyof(m, "b.slope", f.slopes)
    anyof(m, "b.land_use", f.land_uses)
    anyof(m, "b.main_use_name", f.main_uses)   # UI=주용도명 · DB main_use_name과 직접 일치(코드매핑 불필요)
    if f.etc_use:
        add(m, "b.etc_use ILIKE '%' || ${i} || '%'", f.etc_use)
    rng(m, "b.land_area", f.land_area_min, f.land_area_max)
    rng(m, "b.total_area", f.total_area_min, f.total_area_max)
    rng(m, "COALESCE(b.build_area, bc.build_area_calc)", f.build_area_min, f.build_area_max)
    rng(m, "b.parcel_area", f.parcel_area_min, f.parcel_area_max)
    rng(m, "COALESCE(b.far_area, bc.far_area_calc)", f.far_area_min, f.far_area_max)
    rng(m, "b.floors_above", f.floors_above_min, f.floors_above_max)
    rng(m, "b.floors_below", f.floors_below_min, f.floors_below_max)
    # 건폐율·용적률·면적은 **거를 때만** 계산값을 얹는다(0143·0144).
    # **보여주는 값은 대장 그대로다**(아래 SELECT 는 b.bcr·b.far 를 낸다) — 화면 값이
    # 계약서·중개대상물 확인설명서·브리핑으로 그대로 이어지기 때문이다.
    # 대장이 비운 칸은 화면에서도 빈칸이고(0144), 그 빈칸 때문에 검색에서 사라지지는
    # 않는다: 용적률로 거르면 대장만으로는 36.5%가 통째로 빠지는데 계산값을 얹으면 16.1%다.
    rng(m, "COALESCE(b.bcr, bc.bcr_calc)", f.bcr_min, f.bcr_max)
    rng(m, "COALESCE(b.far, bc.far_calc)", f.far_min, f.far_max)
    rng(m, "b.elevator", f.elevator_min, f.elevator_max)
    rng(m, "b.parking", f.parking_min, f.parking_max)
    if f.station_dist_max is not None:
        add(m, "b.station_dist <= ${i}", f.station_dist_max)
    rng(m, "b.last_sale_price", f.last_sale_min, f.last_sale_max)
    if f.last_sale_years_max is not None:
        add(m, "b.last_sale_ym >= to_char(CURRENT_DATE - make_interval(years => ${i}), 'YYYYMM')", f.last_sale_years_max)
    if f.last_sale_years_min is not None:
        add(m, "b.last_sale_ym <= to_char(CURRENT_DATE - make_interval(years => ${i}), 'YYYYMM')", f.last_sale_years_min)
    rng(m, "b.gongsi_latest", f.gongsi_min, f.gongsi_max)
    if f.age_max is not None:
        add(m, "b.approval_ymd >= (CURRENT_DATE - make_interval(years => ${i}))", f.age_max)
    if f.age_min is not None:
        add(m, "b.approval_ymd <= (CURRENT_DATE - make_interval(years => ${i}))", f.age_min)
    if f.remodel_years_max is not None:
        add(m, "b.remodel_ymd >= (CURRENT_DATE - make_interval(years => ${i}))", f.remodel_years_max)
    if f.remodel_years_min is not None:
        add(m, "b.remodel_ymd <= (CURRENT_DATE - make_interval(years => ${i}))", f.remodel_years_min)

    # ── 외부(classified 계산값 별칭) ──
    rng(o, "legal_bcr", f.legal_bcr_min, f.legal_bcr_max)
    rng(o, "legal_far", f.legal_far_min, f.legal_far_max)
    rng(o, "bcr_slack", f.bcr_slack_min, f.bcr_slack_max)
    rng(o, "far_slack", f.far_slack_min, f.far_slack_max)
    rng(o, "team_price", f.price_min, f.price_max)   # 매매가 = 팀이 적은 값만
    rng(o, "roi", f.roi_min, f.roi_max)
    rng(o, "roi_est", f.roi_est_min, f.roi_est_max)
    rng(o, "sale_est", f.sale_est_min, f.sale_est_max)
    rng(o, "rent_est_m", f.rent_est_min, f.rent_est_max)
    rng(o, "deposit_est", f.deposit_est_min, f.deposit_est_max)
    rng(o, "roi_exvac", f.roi_exvac_min, f.roi_exvac_max)
    rng(o, "pp_land", f.pp_land_min, f.pp_land_max)
    rng(o, "pp_land_team", f.pp_land_team_min, f.pp_land_team_max)
    rng(o, "pp_total_team", f.pp_total_team_min, f.pp_total_team_max)
    rng(o, "gongsi_ratio_team", f.gongsi_ratio_team_min, f.gongsi_ratio_team_max)
    rng(o, "pp_total", f.pp_total_min, f.pp_total_max)
    rng(o, "deposit_total", f.deposit_total_min, f.deposit_total_max)
    rng(o, "rent_total", f.rent_total_min, f.rent_total_max)
    rng(o, "mgmt_total", f.mgmt_total_min, f.mgmt_total_max)
    if f.vacant == "있음": o.append("vacant_cnt > 0")
    elif f.vacant == "없음": o.append("COALESCE(vacant_cnt,0) = 0")
    rng(o, "gongsi_total", f.gongsi_total_min, f.gongsi_total_max)
    rng(o, "gongsi_ratio", f.gongsi_ratio_min, f.gongsi_ratio_max)
    rng(o, "gongsi_up5", f.gongsi_up5_min, f.gongsi_up5_max)
    rng(o, "gongsi_up10", f.gongsi_up10_min, f.gongsi_up10_max)
    rng(o, "sale_pnl", f.sale_pnl_min, f.sale_pnl_max)
    rng(o, "sale_cnt", f.sale_count_min, f.sale_count_max)
    rng(o, "float_pop", f.pop_day_min, f.pop_day_max)
    # 업무(listings) — classified가 별칭으로 SELECT
    anyof(o, "urgency", f.urgencies)
    anyof(o, "owner_type", f.owner_types)
    anyof(o, "relation", f.relations)
    anyof(o, "cooperation", f.cooperations)
    anyof(o, "kindness", f.kindnesses)
    anyof(o, "meongdo", f.meongdos)
    anyof(o, "use_change", f.use_changes)
    anyof(o, "myeolsil", f.myeolsils)
    if f.assignees:
        add(o, "assignee_account_id = ANY(${i})", f.assignees)
    if f.owner_name:
        add(o, "owner_name ILIKE '%' || ${i} || '%'", f.owner_name)
    if f.listing_no:
        add(o, "listing_no ILIKE '%' || ${i} || '%'", f.listing_no)
    if f.intent:
        add(o, "intent = ${i}", f.intent)
    if f.has_phone == "있음": o.append("(owner_phone IS NOT NULL AND owner_phone <> '')")
    elif f.has_phone == "없음": o.append("(owner_phone IS NULL OR owner_phone = '')")
    if f.has_photo == "있음": o.append("has_photo")
    elif f.has_photo == "없음": o.append("NOT has_photo")
    if f.received_from:
        add(o, "received_on >= ${i}::date", f.received_from)
    if f.received_to:
        add(o, "received_on <= ${i}::date", f.received_to)

    ms = (" AND " + " AND ".join(m)) if m else ""
    os_ = (" AND " + " AND ".join(o)) if o else ""
    return ms, os_


def _build_base(body: SearchIn, user: CurrentUser, col: str | None = None) -> tuple[str, list, str]:
    """raw(조인·원자료) → classified(계산값) CTE + args. 반환 (base, args, outer_sql).
    마스터 필터=raw WHERE / 계산값 필터=outer_sql(호출부가 classified SELECT에 이어붙임).

    col을 주면 열 조건을 raw WHERE에 직접 넣는다. classified 바깥의 col='mine'은
    CASE 식이라 플래너가 raw까지 밀어내지 못해, 담당 매물이 0건인 팀도 구 전체(2.4만행)를
    다 만들어놓고 버렸다(실측 117ms)."""
    args: list = [user.team_id]
    poly_sql = ""
    if body.polygon:
        args.append(json.dumps(body.polygon))
        poly_sql = f" AND ST_Within(b.geom, ST_MakeValid(ST_GeomFromGeoJSON(${len(args)}::text)))"
    master_filt, outer_sql = _filter_sql(body.filters, args)
    # 'mine'만 내린다. 'normal'에 IS NULL을 걸면 대다수 행이 통과하는 조건이라
    # 플래너가 조인 순서를 바꿔 되레 느려졌다(구 단위 615ms→1401ms 실측).
    col_filt = " AND l.assignee_account_id IS NOT NULL" if col == "mine" else ""
    # 내 매물만 볼 때는 listings 를 **INNER JOIN** 으로 바꿔 담당 매물(수십 건)에서 시작한다.
    # LEFT JOIN + WHERE 로 두면 플래너가 buildings_v2 58만 행을 먼저 다 만들고 마지막에
    # 5건으로 줄였다(2026-08-28 실측 2.1s). 지역·폴리곤이 있으면 그쪽이 이미 좁히므로
    # 기존 LEFT JOIN 을 유지한다 — 예전에 전면 적용했다가 되레 느려진 기록이 위 주석이다.
    narrow = col == "mine" and not body.polygon and not (body.filters and body.filters.bjd_code)
    listing_join = "JOIN" if narrow else "LEFT JOIN"
    # INNER JOIN 도, IN 서브쿼리도 플래너를 못 바꿨다 — b 가 뷰라 펼치고 나면 buildings_v2 가
    # base 가 되어 58만 행을 먼저 만든다. MATERIALIZED CTE 로 담당 매물 pk 를 **먼저 굳혀**
    # 그것과 조인해야 pkey 인덱스로 들어간다(2026-08-28).
    mine_cte = ""
    mine_join = ""
    if narrow:
        mine_cte = ("      mine_pk AS MATERIALIZED ("
                    "SELECT building_pk FROM app.listings"
                    " WHERE team_id = $1 AND assignee_account_id IS NOT NULL),\n")
        mine_join = "        JOIN mine_pk mp ON mp.building_pk = b.building_pk\n"

    # 유동인구 = **실측 명수 그대로**(서울 생활인구 250m 격자 주간 평균, master.building_pop · 0130).
    # 예전엔 (도로접면 점수 + 역거리 점수)/2 를 다섯 칸으로 잘라 「높음」이라 불렀다. 이름만
    # 유동인구고 실제로는 접근성이었다. 실측으로 갈아탄 뒤에도 다섯 칸 등급이 남아 있었는데,
    # 그 칸은 우리가 정한 분위라 「매우높음」이 몇 명인지 아무도 몰랐다(2026-08-28 제거).
    # 서울 분포: 최소 4 · 중앙 1,313 · 상위5% 3,903 · 최대 25,498 명/일.
    float_pop_case = "bp.day_avg"
    road_score = ("CASE b.road_frontage WHEN '광대소각' THEN 90 WHEN '광대세각' THEN 83 WHEN '광대로한면' THEN 76"
                  " WHEN '중로각지' THEN 69 WHEN '중로한면' THEN 54 WHEN '소로각지' THEN 51 WHEN '소로한면' THEN 32"
                  " WHEN '세로각지(가)' THEN 28 WHEN '세로한면(가)' THEN 17 WHEN '세로각지(불)' THEN 10"
                  " WHEN '세로한면(불)' THEN 3 WHEN '맹지' THEN 0 ELSE 0 END")
    # 용도지역별 법정 건폐율/용적률(서울시 도시계획조례 표준) — 여유분 계산용.
    legal_bcr = ("CASE b.use_zone WHEN '제1종전용주거지역' THEN 50 WHEN '제2종전용주거지역' THEN 40"
                 " WHEN '제1종일반주거지역' THEN 60 WHEN '제2종일반주거지역' THEN 60 WHEN '제3종일반주거지역' THEN 50"
                 " WHEN '일반주거지역' THEN 60 WHEN '주거지역' THEN 60"
                 " WHEN '준주거지역' THEN 60 WHEN '중심상업지역' THEN 60 WHEN '일반상업지역' THEN 60"
                 " WHEN '근린상업지역' THEN 60 WHEN '유통상업지역' THEN 60 WHEN '전용공업지역' THEN 60"
                 " WHEN '일반공업지역' THEN 60 WHEN '준공업지역' THEN 60 WHEN '보전녹지지역' THEN 20"
                 " WHEN '생산녹지지역' THEN 20 WHEN '자연녹지지역' THEN 20 ELSE NULL END")
    legal_far = ("CASE b.use_zone WHEN '제1종전용주거지역' THEN 100 WHEN '제2종전용주거지역' THEN 120"
                 " WHEN '제1종일반주거지역' THEN 150 WHEN '제2종일반주거지역' THEN 200 WHEN '제3종일반주거지역' THEN 250"
                 " WHEN '일반주거지역' THEN 200 WHEN '주거지역' THEN 200"
                 " WHEN '준주거지역' THEN 400 WHEN '중심상업지역' THEN 1000 WHEN '일반상업지역' THEN 800"
                 " WHEN '근린상업지역' THEN 600 WHEN '유통상업지역' THEN 600 WHEN '전용공업지역' THEN 200"
                 " WHEN '일반공업지역' THEN 200 WHEN '준공업지역' THEN 400 WHEN '보전녹지지역' THEN 80"
                 " WHEN '생산녹지지역' THEN 100 WHEN '자연녹지지역' THEN 100 ELSE NULL END")
    station_score = ("CASE WHEN b.station_dist IS NULL THEN 0"
                     " WHEN GREATEST(0, b.station_dist-100) <= 10 THEN 100 WHEN GREATEST(0, b.station_dist-100) <= 80 THEN 90"
                     " WHEN GREATEST(0, b.station_dist-100) <= 160 THEN 85 WHEN GREATEST(0, b.station_dist-100) <= 240 THEN 78"
                     " WHEN GREATEST(0, b.station_dist-100) <= 320 THEN 68 WHEN GREATEST(0, b.station_dist-100) <= 400 THEN 58"
                     " WHEN GREATEST(0, b.station_dist-100) <= 480 THEN 40 WHEN GREATEST(0, b.station_dist-100) <= 560 THEN 28"
                     " WHEN GREATEST(0, b.station_dist-100) <= 640 THEN 18 WHEN GREATEST(0, b.station_dist-100) <= 720 THEN 10"
                     " WHEN GREATEST(0, b.station_dist-100) <= 800 THEN 4 ELSE 0 END")

    base = f"""
      WITH {mine_cte}rent_agg AS (   -- 팀 층별임대 집계(임대료·보증금·관리비·공실)
        SELECT building_pk, SUM(rent) AS rent_total, SUM(deposit) AS deposit_total,
               SUM(maintenance) AS mgmt_total,
               SUM(rent) FILTER (WHERE is_vacant IS NOT TRUE) AS rent_nonvac,
               count(*) FILTER (WHERE is_vacant) AS vacant_cnt
        FROM app.floor_rents WHERE team_id = $1 AND deleted_at IS NULL GROUP BY building_pk
      ),
      -- (0134에서 하이브리드 폐지) 아래 touched·est_drop 는 대장 층별 추정에서 「팀이 손댄 층」을
      -- 빼내던 재료다. 수익률은 더 이상 이 값을 안 쓴다 — 추정을 총계에 섞지 않는다.
      touched AS (
        SELECT building_pk, floor FROM app.floor_rents
          WHERE team_id = $1 AND deleted_at IS NULL
        UNION
        SELECT building_pk, floor FROM app.floor_hidden WHERE team_id = $1
      ),
      est_drop AS (
        SELECT t.building_pk,
               SUM(fe.rent_est) AS rent_est, SUM(fe.deposit_est) AS deposit_est
        FROM touched t JOIN master.floor_est_by_floor fe
          ON fe.building_pk = t.building_pk
         AND app.signed_floor(fe.floor) = app.signed_floor(t.floor)   -- '3층'='3F' 동일 취급
        GROUP BY 1
      ),
      sale_ov AS (     -- 팀 수기 매매가(sale_price 오버레이)
        SELECT target_id AS building_pk, value::bigint AS sale_price
        FROM app.overlays
        WHERE team_id = $1 AND target_type = 'building' AND field = 'sale_price' AND value ~ '^[0-9]+$'
      ),
      photo_ex AS (SELECT DISTINCT building_pk FROM app.photos),
      raw AS (
        SELECT b.building_pk, b.addr, b.land_area, b.total_area, b.gongsi_latest,
               b.floors_above, b.floors_below, b.use_zone,
               ST_X(b.geom) AS lng, ST_Y(b.geom) AS lat,
               b.last_sale_price, b.last_sale_ym,
               so.sale_price, se.sale_est, re.annual_rent,
               re.monthly_rent AS rent_est_m, re.deposit_est,
               COALESCE(ra.rent_total, l.total_rent) AS rent_total,
               COALESCE(ra.deposit_total, l.total_deposit) AS deposit_total,
               COALESCE(ra.mgmt_total, l.total_mgmt) AS mgmt_total,
               ra.rent_nonvac, ra.vacant_cnt,
               -- 연임대 = **총임대료 × 12**(0134). 총임대료의 정본은 한 줄이다:
               --   층별 실측이 있으면 그 합계, 없으면 팀이 직접 적은 총액(app.listings.total_rent).
               -- 하이브리드(팀 입력 + 미입력층 대장 추정, 0030)는 폐지했다 — 한 숫자에 실측과
               -- 추정을 섞으면 그 값은 실측도 추정도 아니고, 층별 임대시세를 미리 안 채워두는
               -- 원칙과 정면으로 어긋난다. 추정 임대는 임대 탭에서 「추정」 배지를 달고 따로 선다.
               COALESCE(ra.rent_total, l.total_rent) * 12.0 AS rent_year,
               -- 공실제외는 **층별이 있을 때만** 있는 값이다 — 총액 직접 입력엔 공실 구분이 없다.
               CASE WHEN ra.rent_total IS NOT NULL THEN ra.rent_nonvac * 12.0 END AS rent_year_exvac,
               l.assignee_account_id, l.urgency, l.grade, l.ipji, ow.owner_type,
               ow.relation, ow.cooperation, ow.kindness, l.building_use, l.meongdo, l.use_change,
               l.myeolsil, l.nohudo, ow.phone AS owner_phone, ow.name AS owner_name,
               l.listing_no, l.intent, l.received_on,
               sa.sale_cnt, sa.p_last, sa.p_prev,
               (ph.building_pk IS NOT NULL) AS has_photo,
               g5.price AS g5, g10.price AS g10, b.bcr, b.far,
               -- 화면엔 대장값(b.bcr·b.far)을 내고, 여유분 계산엔 계산값을 얹은 쪽을 쓴다.
               -- 여유분은 대장 전사가 아니라 우리 분석값이라 계약서로 넘어가지 않는다.
               COALESCE(b.bcr, bc.bcr_calc) AS bcr_any, COALESCE(b.far, bc.far_calc) AS far_any,
               {legal_bcr} AS legal_bcr, {legal_far} AS legal_far,
               {road_score} AS road_score, {station_score} AS station_score,
               {float_pop_case} AS float_pop_calc
        FROM master.buildings b
{mine_join}        LEFT JOIN sale_ov so ON so.building_pk = b.building_pk
        LEFT JOIN master.building_sale_est se ON se.building_pk = b.building_pk
        LEFT JOIN master.building_rent_est re ON re.building_pk = b.building_pk
        LEFT JOIN rent_agg ra ON ra.building_pk = b.building_pk
        LEFT JOIN master.floor_est_total fet ON fet.building_pk = b.building_pk
        -- 유동인구 실측(0130) — 건물 좌표를 250m 격자로 접어 붙여 둔 표라 조인 한 번이다
        LEFT JOIN master.building_pop bp ON bp.building_pk = b.building_pk
        LEFT JOIN est_drop ed ON ed.building_pk = b.building_pk
        -- 검색 전용 계산값(0143) — 필터만 읽는다. SELECT 에는 안 싣는다(화면=대장)
        LEFT JOIN master.building_calc bc ON bc.building_pk = b.building_pk
        {listing_join} app.listings l ON l.building_pk = b.building_pk AND l.team_id = $1
        LEFT JOIN app.owners ow ON ow.id = l.owner_id AND ow.deleted_at IS NULL   -- 0058 · 소유자는 사람 표
        LEFT JOIN master.sales_agg sa ON sa.building_pk = b.building_pk   -- MV(0028): 매 검색마다 11.4만행 재집계하던 CTE 대체
        LEFT JOIN photo_ex ph ON ph.building_pk = b.building_pk
        LEFT JOIN master.gongsi_series g5 ON g5.pnu = b.pnu AND g5.year = EXTRACT(YEAR FROM CURRENT_DATE)::int - 5
        LEFT JOIN master.gongsi_series g10 ON g10.pnu = b.pnu AND g10.year = EXTRACT(YEAR FROM CURRENT_DATE)::int - 10
        WHERE TRUE {poly_sql} {master_filt} {col_filt}
      ),
      classified AS (
        SELECT building_pk, addr, land_area, total_area, floors_above, floors_below, use_zone,
               lng, lat, last_sale_price, last_sale_ym, sale_est, assignee_account_id,
               urgency, grade, ipji, owner_type, relation, cooperation, kindness,
               building_use, meongdo, use_change, myeolsil, nohudo,
               owner_phone, owner_name, listing_no, intent, received_on, has_photo,
               COALESCE(sale_cnt, 0) AS sale_cnt,
               CASE WHEN assignee_account_id IS NOT NULL THEN 'mine' ELSE 'normal' END AS col,
               COALESCE(sale_price, sale_est) AS price,
               (sale_price IS NULL) AS price_is_est,
               -- 실측 짝의 수익률 = 총임대료 ÷ **팀 매매가**(2026-08-27).
               -- 예전엔 분모가 COALESCE(매매가, 추정가)라, 매매가가 없는 매물은 실측 임대를
               -- 추정가로 나눈 값이 「수익률」로 섰다. 추정 분모는 아래 roi_est 가 맡는다.
               CASE WHEN rent_year > 0 AND sale_price > 0
                    THEN round(rent_year / sale_price * 100, 2) END AS roi,
               CASE WHEN rent_year_exvac > 0 AND sale_price > 0
                    THEN round(rent_year_exvac / sale_price * 100, 2) END AS roi_exvac,
               deposit_total, rent_total, mgmt_total, vacant_cnt,
               -- 추정 연임대 — 추정가와 짝지어 **순수 추정 수익률**을 만든다(0134).
               -- 실측(rent_total)과 섞지 않는다: 카드는 추정 짝·실측 짝을 갈라 보여준다.
               annual_rent AS est_annual_rent, rent_est_m, deposit_est,
               -- ::numeric 없으면 bigint 정수 나눗셈이라 전부 0% 가 된다
               CASE WHEN annual_rent > 0 AND sale_est > 0
                    THEN round(annual_rent::numeric / sale_est * 100, 2) END AS roi_est,
               sale_price AS team_price,   -- 필터용 팀 매매가(표시용 price 는 추정가 폴백이 섞인다)
               -- 팀 매매가로 나눈 파생. 추정가 쪽(pp_land·pp_total·gongsi_ratio)과 별개 컬럼이다.
               CASE WHEN land_area > 0 AND sale_price > 0 THEN round(sale_price * 3.305785 / land_area) END AS pp_land_team,
               CASE WHEN total_area > 0 AND sale_price > 0 THEN round(sale_price * 3.305785 / total_area) END AS pp_total_team,
               CASE WHEN sale_price > 0 THEN round((gongsi_latest * land_area) / sale_price::numeric * 100, 2) END AS gongsi_ratio_team,
               -- 평단가·공시비율의 분모는 **추정가**다(2026-08-27). 이름에도 「추정」을 박았다.
               -- 전 서울을 훑는 지표라 팀 매매가로 고정하면 거의 안 걸린다.
               CASE WHEN land_area > 0 AND sale_est > 0 THEN round(sale_est * 3.305785 / land_area) END AS pp_land,
               CASE WHEN total_area > 0 AND sale_est > 0 THEN round(sale_est * 3.305785 / total_area) END AS pp_total,
               (gongsi_latest * land_area) AS gongsi_total,
               CASE WHEN sale_est > 0 THEN round((gongsi_latest * land_area) / sale_est::numeric * 100, 2) END AS gongsi_ratio,
               CASE WHEN g5 > 0 THEN round((gongsi_latest - g5) / g5::numeric * 100, 2) END AS gongsi_up5,
               CASE WHEN g10 > 0 THEN round((gongsi_latest - g10) / g10::numeric * 100, 2) END AS gongsi_up10,
               CASE WHEN p_prev > 0 THEN round((p_last - p_prev) / p_prev::numeric * 100, 2) END AS sale_pnl,
               float_pop_calc AS float_pop,
               legal_bcr, legal_far,
               CASE WHEN legal_bcr IS NOT NULL AND bcr_any IS NOT NULL THEN GREATEST(0, legal_bcr - bcr_any) END AS bcr_slack,
               CASE WHEN legal_far IS NOT NULL AND far_any IS NOT NULL THEN GREATEST(0, legal_far - far_any) END AS far_slack
        FROM raw
      )
    """
    return base, args, outer_sql


@router.post("")
async def search(body: SearchIn, user: CurrentUser = Depends(current_user)):
    """2열 목록(내매물/일반) + 열별 독립 페이징. 무크레딧.

    분류(§3.4·상태 종속): 내매물 = 팀 담당자 지정 · 일반 = 나머지.
    매매가(§3.5): 내매물=팀 수기 sale_price / 일반=NULL(후순위).
    """
    # 정렬 = 매매가순 / 수익률순만(S01 §3.3). 값 없는 항목은 후순위(NULLS LAST).
    # 수익률순은 **추정 수익률**로 세운다 — 팀 매매가는 극소수라 그걸로 세우면 목록이 빈다.
    # 목록 줄에 뜨는 값도 팀 매매가가 없으면 추정 수익률이라 순서와 숫자가 맞는다.
    order = {
        "price": "price DESC NULLS LAST, addr",
        "roi": "roi_est DESC NULLS LAST, price DESC NULLS LAST",
    }.get(body.sort, "price DESC NULLS LAST, addr")

    async def column(name: str, page: int):
        # 열 조건을 raw WHERE로 내려 그 열에 속한 행만 만든다(내매물 0건 팀은 즉시 종료).
        base, args, outer_sql = _build_base(body, user, col=name)
        off = (page - 1) * body.per_page
        # count(*) OVER() 윈도우는 LIMIT 최적화를 막아 구 전체(2.4만+)에서 30s+ 행업(플래너가
        # 전 행 계산·nested-loop 폭발). rows(LIMIT)와 total(경량 count)을 분리하면 ~5s.
        rows, total = await asyncio.gather(
            pool().fetch(
                base + f"""SELECT * FROM classified
                           WHERE col = '{name}' {outer_sql} ORDER BY {order}
                           LIMIT {body.per_page} OFFSET {off}""",
                *args),
            pool().fetchval(
                base + f"SELECT count(*) FROM classified WHERE col = '{name}' {outer_sql}",
                *args),
        )
        return {"items": [dict(r) for r in rows], "total": total, "page": page,
                "pages": max(1, -(-total // body.per_page))}

    # 내 매물만 — 지역·영역이 없으면 '일반' 열은 서울 전체가 되어 의미도 없고 느리다.
    # 담당자 있는 행만 훑으므로(listings_claim 부분 인덱스) 범위 조건 없이도 가볍다.
    if body.mine_only:
        return {"mine": await column("mine", body.page_mine),
                "normal": {"items": [], "total": 0, "page": 1, "pages": 1}}

    # 두 열은 서로 독립 — 순차로 돌면 합계만큼 기다린다(구 단위 실측 합 0.83s → 최댓값 0.62s).
    mine, normal = await asyncio.gather(
        column("mine", body.page_mine), column("normal", body.page_normal))
    return {"mine": mine, "normal": normal}


@router.post("/count")
async def count_only(body: SearchIn, user: CurrentUser = Depends(current_user)):
    """조건에 맞는 건수만(2026-08-27) — 필터 창이 닫기 전에 결과 크기를 말하려고 쓴다.

    목록 조회는 두 열을 각각 페이징하고 값도 많이 실어 구 단위에서 초가 걸린다.
    여기서는 building_pk 하나만 세므로 같은 조건이라도 훨씬 가볍다."""
    base, args, outer_sql = _build_base(body, user, col="mine" if body.mine_only else None)
    n = await pool().fetchval(
        base + f"SELECT count(*) FROM classified WHERE TRUE {outer_sql}", *args)
    return {"total": int(n or 0)}


@router.post("/pins")
async def pins(body: SearchIn, user: CurrentUser = Depends(current_user)):
    """지도 핀 — 페이징 없이 조건에 맞는 매물(경량: 좌표·분류·가격).
    프론트가 뷰포트 컬링(화면 안 핀만 렌더)하므로 넉넉히 반환하되, 3000개 상한(응답 크기·극단 방지).
    가격 있는 매물 우선(NULLS LAST) → 상한에 걸려도 유의미한 핀부터."""
    base, args, outer_sql = _build_base(body, user, col="mine" if body.mine_only else None)
    rows = await pool().fetch(
        base + f"""SELECT building_pk, addr, lng, lat, col, price, roi,
                         price_is_est, roi_est,   -- 추정 짝·실측 짝을 가르는 재료(0134)
                         last_sale_price, sale_est
                  FROM classified WHERE lng IS NOT NULL {outer_sql}
                  ORDER BY price DESC NULLS LAST, building_pk LIMIT 3000""",
        *args,
    )
    return [dict(r) for r in rows]
