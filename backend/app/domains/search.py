"""검색: 주소 자동완성 + 2열 목록(내매물/일반) + 영역(폴리곤) 검색.
specs S01 §3.1a(자동완성)·§3.4(3열·열별 페이징)·§3.5(표시값)·§3.6c(영역).
"""
import asyncio
import difflib
import json
import re
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from ..core.db import pool
from ..core.hangul import from_qwerty, looks_latin
from ..core.deps import current_user, any_user, CurrentUser

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
    bjd_code: str | None = None        # 지역이면 법정동 코드 — 고르면 그 동이 지역 필터가 된다(2026-09-06)
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
    # **좌표 없는 동은 버린다.** region_index 는 avg(st_x(geom)) 인데, 그 동의 건물이
    # 전부 좌표가 없으면 NULL 이 된다(2026-09-02 실측: 종로구 교남동 3동 전부 · 주소가
    # 깨진 「강남구 194번지」 1동). 그 한 행 때문에 float + None 으로 죽어서
    # **주소 자동완성 전체가 500** 이었고, 화면은 「일치하는 결과가 없습니다」로 조용히
    # 넘어갔다. 좌표가 없으면 지도를 못 옮기니 후보로 내놔도 쓸모가 없다.
    regions = [r for r in regions if r["lng"] is not None and r["lat"] is not None]
    gus: dict[str, dict] = {}          # 구 단위(동 평균의 평균)
    for r in regions:
        g = gus.setdefault(r["gu"], {"gu": r["gu"], "lng": 0.0, "lat": 0.0, "cnt": 0, "n": 0,
                                     "bjd_code": (r["bjd_code"] or "")[:5] or None})
        g["lng"] += r["lng"]; g["lat"] += r["lat"]; g["cnt"] += (r["cnt"] or 0); g["n"] += 1
    # **구도 코드를 준다.** 동은 코드가 오는데 구는 null 이라, 「종로구」를 물은 모델이 코드를
    # 못 받고 11010·1101·1100000000 을 지어내며 열 바퀴를 돌았다(2026-09-09). 구 코드는 동 앞 5자리다
    gu_list = [{"gu": g["gu"], "lng": g["lng"]/g["n"], "lat": g["lat"]/g["n"], "cnt": g["cnt"],
                "bjd_code": g["bjd_code"]} for g in gus.values()]
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
           COALESCE(lv.sale_price, se.sale_est) AS price
      FROM ({cand}) b
      JOIN master.buildings bb ON bb.building_pk = b.building_pk
      LEFT JOIN app.listings l
        ON l.building_pk = b.building_pk AND l.team_id = $2 AND l.assignee_account_id IS NOT NULL
      LEFT JOIN app.listings lv ON lv.building_pk = b.building_pk AND lv.team_id = $2   -- 팀 매매가(0173)
      LEFT JOIN master.building_sale_est se ON se.building_pk = b.building_pk
     ORDER BY (l.assignee_account_id IS NOT NULL) DESC, length(b.addr), b.addr
     LIMIT $3
"""

@router.get("/suggest", response_model=list[Suggestion], openapi_extra={"x-ai": "read"})
async def suggest(q: str = Query(min_length=1), user: CurrentUser = Depends(any_user)):
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
    norm = re.sub(r"^[가-힣]{1,4}(구|군)(?=[가-힣0-9]{2,}(동|가|로|street)?)", "", norm)   # 종로5가 같은 숫자 낀 동도
    norm = norm.replace("번지", "")
    out: list[Suggestion] = []

    regions, stations = await _suggest_refs()
    # 지역: 동 접두 우선 → 구 접두 (예: '논현' → 강남구 논현동·논현1동…)
    for r in regions:
        if len(out) >= 3: break
        dong = r.get("dong")
        if dong and dong.startswith(norm):
            out.append(Suggestion(kind="region", addr=f"서울특별시 {r['gu']} {dong}",
                                  lng=r["lng"], lat=r["lat"], sub=f"매물 {r['cnt']:,}동", bjd_code=r.get("bjd_code")))
        elif not dong and r["gu"].startswith(norm):
            # 구 줄에도 코드를 실어 준다. 없으니 「종로구」를 물은 모델이 코드를 지어냈다(2026-09-09)
            out.append(Suggestion(kind="region", addr=f"서울특별시 {r['gu']}",
                                  lng=r["lng"], lat=r["lat"], sub=f"매물 {r['cnt']:,}동",
                                  bjd_code=r.get("bjd_code")))
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

    # 매물번호·소유자명 — 「1292 있잖아요」·「김영순씨 건물」로도 찾는다(2026-08-28).
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
async def regions(_: CurrentUser = Depends(any_user)):
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


# 추정치라 **조건으로는 안 건다**(2026-09-18). 화면은 쓴다 — 사람은 오차를 알고 건다.
# 모델은 산식의 결과(수익률·평단가)를 거르는 대신 재료(역거리·용도지역·연식·업종)를 걸어야 한다.
# 적정가(sale_est)만 예외다 — 값으로 찾는 유일한 통로라 빼면 값 검색이 죽는다.
_EST = {"x-model": False}
# 지금 값 셋(팀 매매가·추정가·매도희망가)은 모델에게 **따로 주지 않는다**(2026-09-19).
# 「100억 정도」가 어느 값인지는 사용자 말에 없는 것이라 108칸 설명에서 모델이 고르게 하면 틀린다 —
# 옛 계층도 같은 설명으로 말렸고 같은 자리에서 틀렸다. 모델은 value_min/max 하나를 걸고
# 서버가 셋 중 **어느 하나라도** 범위면 낸다. 어느 값이 걸렸는지는 줄에 셋이 다 나와 보인다.
# 실거래가는 넣지 않는다. 지난 거래지 지금 값이 아니다 — 넣어 봤더니 강남 90~110억에서
# 215동이 실거래로만 걸렸고 그중 150동이 5년 넘은 기록이었다(2006년에 110억, 지금 추정 551억).
_PRICE = {"x-model": False}
# 「뭐 하는 건물이냐」도 값과 같다(2026-09-19). 대장 주용도·기타용도·토지이용·카카오 업종이 한 물음에
# 넷으로 갈라져 있어 모델이 틀린 쪽을 골랐다 — 「병원」을 주용도 「의료시설」로 걸어 0동. 실제 병원이
# 든 종로구 33동은 대장이 전부 근생·업무시설이었다. 모델은 use 하나를 걸고 서버가 주용도 OR 업종으로
# 본다. 기타용도는 업종이 덮으니 뺀다. 토지이용은 용도지역과 겹쳐 뺀다. 용도지역만 따로 남긴다.
_USE = {"x-model": False}


class Filters(BaseModel):
    """S01b 속성 필터 — master.buildings 컬럼 매핑 필드. None/빈리스트=미적용.
    (UI엔 60필드지만 여기 없는 건 app레이어/미보유라 서버 필터 미지원 — 점진 확장)

    extra=forbid: 모르는 필드는 422로 거절한다. 기본값(ignore)이면 프론트가 필드명을 잘못
    보냈을 때 그 조건만 조용히 빠져 '필터를 걸었는데 전체가 나오는' 형태로만 드러난다.
    실제로 그 부류의 버그를 겪었다."""
    model_config = ConfigDict(extra="forbid")

    bjd_code: str | None = Field(None, description="법정동 코드(구 5자리·동 10자리). 이름을 알면 region 을 쓴다")       # 법정동(prefix: 구=5자리·동=10자리)
    # **지역을 이름으로 받는다**(2026-09-09). 코드를 모르는 쪽이 코드를 만들어 내는 것보다
    # 서버가 맞추는 게 싸고 정확하다 — AI 는 한 바퀴가 3,976토큰이고, 그 바퀴에서 코드를 지어냈다.
    # 여럿이면 서버가 고르지 않는다 — 후보를 담아 400 을 낸다(조용히 하나 고르면 그게 거짓말이다).
    # 여럿도 받는다. 「성수동」처럼 1가·2가로 갈린 곳을 두 번 부르게 두면 답이 반쪽이 되고,
    # 화면엔 마지막 것만 선다(2026-09-10 대표). 하나로 받아 OR 로 묶는다.
    region: str | list[str] | None = Field(None, description="지역 이름. 「종로구」 하나 또는 [「성수동1가」, 「성수동2가」]처럼 여럿. 코드가 아니라 이름으로 준다")   # 「종로구」 · 「성수동2가」 · ["성수동1가","성수동2가"]
    # 한 매물로 좁히기 — 매수자 조건에 이 매물이 걸리는지 볼 때 쓴다(S04 「맞는 매수자」).
    # 매칭용 쿼리를 따로 만들면 검색과 언젠가 어긋나므로, 같은 엔진을 한 행으로 좁혀 쓴다.
    # 하나여도 되고 목록이어도 된다(2026-09-21). 모델이 검색 줄에서 고른 몇 채를 한 바퀴에
    # 다시 물을 수 있어야 `building` 조회를 대신한다. 화면은 늘 하나를 준다.
    building_pk: str | list[str] | None = Field(None, description="건물 하나 또는 여럿으로 좁힌다")
    # 나대지 하나로 좁힌다. 건물의 `building_pk` 자리다 — 없으면 모델이 나대지 한 필지를
    # 집을 길이 없어 검색이 조회를 대신할 수 없다(2026-09-21). 건물 검색에선 안 쓴다.
    pnu: str | list[str] | None = Field(None, description="나대지 하나 또는 여럿으로 좁힌다. 19자리")
    # 지번으로 한 채(2026-09-22). 이게 없어 「종로5가 104-8」을 물으면 모델이 지역 검색을 가격 구간으로
    # 잘라 가며 13바퀴를 돌고도 못 찾았다(입력 114만 토큰). 색인 master.dong_jibun 과 같은 규칙으로
    # 다듬어 정확 일치. 같은 지번의 여러 동(104-8 은 둘)이 다 나온다. 나대지도 같은 이름으로 걸린다.
    addr: str | None = Field(None, description="지번 주소 하나로 좁힌다. 「종로5가 104-8」·「강남구 삼성동 160-22」처럼 동과 지번. 같은 지번의 동이 여럿이면 다 나온다")
    # 다중선택(= ANY)
    use_zones: list[str] | None = Field(None, description="용도지역. 값은 GET /enums 의 use_zone")       # 용도지역
    jimoks: list[str] | None = Field(None, description="지목. 값은 GET /enums 의 jimok")          # 지목
    road_frontages: list[str] | None = Field(None, description="도로접면. 값은 GET /enums 의 road_frontage")  # 도로접면
    shapes: list[str] | None = Field(None, description="지형 형상")          # 지형형상
    slopes: list[str] | None = Field(None, description="지세")          # 지세
    # 규제(토지이용계획) — 필지 하나라도 그 규제가 포함·저촉·접함이면 걸린다. 정비구역·재정비촉진지구도
    # 여기 든다(정비 129,153동 중 99.9%가 필지 규제에 「정비」로 적혀 있다, 2026-09-22 실측).
    regulations: list[str] | None = Field(None, description="토지이용계획의 규제 이름(지구단위계획구역·정비구역·재정비촉진지구·개발제한구역 등). 필지 하나라도 걸리면")
    land_uses: list[str] | None = Field(None, description="토지이용상황(상업용·단독 등)", json_schema_extra=_USE)       # 토지이용상황(land_use) — 값=명(상업용·단독 등)
    # 목록의 목록이다 — 바깥은 「또는」, 안쪽은 「그리고」. [["제1종","근린생활"],["업무시설"]] =
    # (제1종 AND 근린생활) OR 업무시설. 맨 목록은 tools 가 [[A],[B]] 로 펴서 준다.
    use: list[list[str]] | None = Field(None, description="건축물대장 주용도 부분일치. 건물이 **허가 받을 때 당시의 용도**다. 즉 지금 용도와는 다를 수 있다. 지금 무엇이 들어와 있는지는 「입주업체」로 찾는다. 「근린생활시설」이면 제1종·제2종이 다 걸린다")
    main_uses: list[str] | None = Field(None, description="건축물대장 주용도명. 「제1종근린생활시설」·「제2종근린생활시설」·「업무시설」·「공장」 등", json_schema_extra=_USE)       # 주용도(코드 저장 — 매핑 전까지 미연결)
    etc_use: str | None = Field(None, description="기타 용도 부분일치(대장의 자유 기재란)", json_schema_extra=_USE)               # 기타용도(부분일치)
    # 업종·상호로 건물 찾기 — **카카오 키워드 검색**(2026-09-16). 대장 용도도 인허가 업종도 아니다.
    # 카카오가 분류한 장소를 검색 범위(rect)에서 찾아 좌표를 건물에 25m 로 맞춘다. 「피부과」로 물으면
    # 상호에 피부과가 없는 「모리스의원」도 나온다(카카오 category_name 「병원 > 피부과」). 우리 원천은
    # 인허가가 「의원」, 상가정보가 「기타 교육」으로 뭉개져 있어 못 하던 일이다. 그래서 갈래 사전도
    # 업종 목록(/search/trades)도 없앴다 — 낱말은 업체 이름이나 업종 낱말 그대로 준다(업종 나무로 조상까지 걸린다).
    # 여럿(AND)·없음(NOT)은 **서버가 집합으로 낸다.** biz 하나뿐이던 때 모델이 두 번 부르고 목록을
    # 눈으로 대조했고, 화면엔 첫 검색(113동)이 서고 답은 5곳이라 화면과 답이 어긋났다(2026-09-09).
    biz: str | None = Field(None, description="업종이나 상호 한 낱말. 업체 이름이나 업종 낱말로 준다(피부과·카페·스타벅스·발레학원). 「병원」이면 피부과·치과까지 걸린다. 그 업체가 든 건물만 남는다", json_schema_extra=_USE)
    biz_min: int | None = Field(None, description="biz 장소가 최소 몇 곳 든 건물만(기본 1)", json_schema_extra=_USE)
    biz_dnf: list[list[str]] | None = Field(None, description="지금 **실제로 들어와 있는** 업체. 업체 이름이나 업종 낱말로 준다. [\"병원\",\"카페\"] = 둘 중 하나, [[\"병원\",\"카페\"]] = 둘 다. 서버가 집합으로 내니 따로 여러 번 부르지 않는다")
    # 모델에겐 `입주업체` 의 {"없음": [...]} 으로 보인다. tools 가 여기로 옮긴다.
    biz_not: list[str] | None = Field(None, description="그 업체가 하나도 없는 건물", json_schema_extra=_USE)
    # 범위 (min/max)
    land_area_min: float | None = Field(None, description="대지면적 ㎡ 이상")
    land_area_max: float | None = Field(None, description="대지면적 ㎡ 이하")
    total_area_min: float | None = Field(None, description="연면적 ㎡ 이상")
    total_area_max: float | None = Field(None, description="연면적 ㎡ 이하")
    build_area_min: float | None = Field(None, description="건축면적 ㎡ 이상")
    build_area_max: float | None = Field(None, description="건축면적 ㎡ 이하")
    # 실측 도로폭(master.building_road, 도로명주소 도로구간 폭원). 08-07 브리핑용으로 만들고
    # 검색엔 안 붙였던 것(2026-09-22). 전면 판정이 큰 대지·넓은 길에서 틀리는 건 할일에 있다.
    road_front_min: float | None = Field(None, description="전면 도로폭 m 이상(실측)")
    road_front_max: float | None = Field(None, description="전면 도로폭 m 이하(실측)")
    floors_above_min: int | None = Field(None, description="지상 층수 이상")
    floors_above_max: int | None = Field(None, description="지상 층수 이하")
    floors_below_min: int | None = Field(None, description="지하 층수 이상")
    floors_below_max: int | None = Field(None, description="지하 층수 이하")
    bcr_min: float | None = Field(None, description="건폐율 % 이상(대장)")
    bcr_max: float | None = Field(None, description="건폐율 % 이하(대장)")
    far_min: float | None = Field(None, description="용적률 % 이상(대장)")
    far_max: float | None = Field(None, description="용적률 % 이하(대장)")
    elevator_min: int | None = Field(None, description="승강기 대수 이상")
    elevator_max: int | None = Field(None, description="승강기 대수 이하")
    parking_min: int | None = Field(None, description="주차 대수 이상")
    parking_max: int | None = Field(None, description="주차 대수 이하")
    station_dist_max: int | None = Field(None, description="가까운 지하철역까지 m 이내")
    last_sale_min: int | None = Field(None, description="최근 실거래가 원 이상", json_schema_extra=_PRICE)         # 실거래가(원)
    last_sale_max: int | None = Field(None, description="최근 실거래가 원 이하", json_schema_extra=_PRICE)
    last_sale_years_min: int | None = Field(None, description="최근 실거래가 **N년 이상 지난** 건물")   # 실거래일(최근 N년) — 사용승인일과 동일 시맨틱
    last_sale_years_max: int | None = Field(None, description="최근 **N년 안에** 거래된 건물")
    gongsi_min: int | None = Field(None, description="공시지가 원/㎡ 이상")            # 최신 공시지가(원/㎡)
    gongsi_max: int | None = Field(None, description="공시지가 원/㎡ 이하")
    age_min: int | None = Field(None, description="사용승인 후 **N년 이상** 지난 건물(오래된 것)")               # 연식(년) — 사용승인일 기준
    age_max: int | None = Field(None, description="사용승인 후 **N년 이내**(새 건물)")
    # ── 추가 마스터 컬럼 ──
    parcel_area_min: float | None = Field(None, description="필지면적 ㎡ 이상")     # 토지면적(㎡)
    parcel_area_max: float | None = Field(None, description="필지면적 ㎡ 이하")
    far_area_min: float | None = Field(None, description="용적률 산정 연면적 ㎡ 이상")        # 용적률산정용연면적(㎡)
    far_area_max: float | None = Field(None, description="용적률 산정 연면적 ㎡ 이하")
    remodel_years_min: int | None = Field(None, description="리모델링 후 N년 이상 지난 건물")     # 대수선 경과연수
    remodel_years_max: int | None = Field(None, description="리모델링 후 **N년 이내**(최근 고친 건물). 리모델링 기록이 없는 건물은 안 걸린다")
    # **용도지역에서 어림하지 않아도 되는 값이다.** 모델이 「일반상업지역이니 통상 800% 내외」라고
    # 제 지식으로 메우고 이 칸을 안 불렀다(2026-09-24 실측). 설명에 「법정 용적률 %」만 적혀 있어
    # 용도지역으로 파생시킬 수 있다고 여길 이유만 있고 우리 값을 부를 이유가 없었다.
    # 실제로는 필지 원장에서 토지이음 산식으로 낸 값이라 용도지역 어림과 서울 2.9%가 어긋난다
    # (554,369동 중 16,223동). 일반상업지역만 보면 6.2%, 값이 357가지다(지구단위계획·걸침 필지).
    _LEGAL = "토지이음 산식으로 계산한 법정치. 용도지역으로 어림한 값보다 정확하다"
    legal_bcr_min: float | None = Field(None, description=f"법정 건폐율 % 이상. {_LEGAL}")
    legal_bcr_max: float | None = Field(None, description="법정 건폐율 % 이하")
    legal_far_min: float | None = Field(None, description=f"법정 용적률 % 이상. {_LEGAL}")
    legal_far_max: float | None = Field(None, description="법정 용적률 % 이하")
    bcr_slack_min: float | None = Field(None, description="건폐율 여유(법정 − 현재) 이상. 클수록 더 지을 수 있다")
    bcr_slack_max: float | None = Field(None, description="건폐율 여유 이하")
    far_slack_min: float | None = Field(None, description="용적률 여유(법정 − 현재) 이상. 클수록 더 지을 수 있다")
    far_slack_max: float | None = Field(None, description="용적률 여유 이하")
    # ── classified 계산값(매매가·수익률·평단가·공시·실거래·집계) ──
    value_min: int | None = Field(None, description="가격 원 이상. 추정가·매매가·매도희망가 **어느 하나라도** 이 범위면 나온다. 어느 값이 걸렸는지는 줄에 다 나온다. 지난 실거래가는 안 본다")
    value_max: int | None = Field(None, description="가격 원 이하. 위와 같다")
    price_min: int | None = Field(None, description="내 팀이 적은 매매가 원 이상", json_schema_extra=_PRICE)             # 매매가(원)
    price_max: int | None = Field(None, description="내 팀이 적은 매매가 원 이하", json_schema_extra=_PRICE)
    # 팀 값과 추정값은 **다른 항목**이다(2026-08-27). 예전엔 매매가 칸에 추정가를 채워 넣어
    # 매매가로 검색했는데, 추정가가 제 칸을 가졌으니 각자 걸린다.
    sale_est_min: int | None = Field(None, description="빌탐정 추정가 원 이상", json_schema_extra=_PRICE)          # 빌탐정 추정가(원)
    sale_est_max: int | None = Field(None, description="빌탐정 추정가 원 이하", json_schema_extra=_PRICE)
    roi_est_min: float | None = Field(None, description="추정 수익률 % 이상(추정 연임대 ÷ 추정가). 중위 오차 임대 29%", json_schema_extra=_EST)         # 추정 수익률(%) = 추정임대 ÷ 추정가
    roi_est_max: float | None = Field(None, description="추정 수익률 % 이하", json_schema_extra=_EST)
    # 추정 임대(master.building_rent_est) — 20.1만동에 값이 있는데 필터로는 못 찾고 있었다
    rent_est_min: int | None = Field(None, description="추정 월임대료 원 이상", json_schema_extra=_EST)          # 추정 월임대료(원)
    rent_est_max: int | None = Field(None, description="추정 월임대료 원 이하", json_schema_extra=_EST)
    deposit_est_min: int | None = Field(None, description="추정 보증금 원 이상", json_schema_extra=_EST)       # 추정 보증금(원)
    deposit_est_max: int | None = Field(None, description="추정 보증금 원 이하", json_schema_extra=_EST)
    # 팀 매매가로 나눈 파생 — 추정가로 나눈 것과 다른 컬럼이다(같은 이름으로 부르지 않는다)
    pp_land_team_min: int | None = Field(None, description="**팀 매매가** ÷ 대지 원/평 이상. 추정가로 나눈 pp_land 와 다른 칸이다")
    pp_land_team_max: int | None = Field(None, description="팀 매매가 ÷ 대지 원/평 이하")
    pp_total_team_min: int | None = Field(None, description="팀 매매가 ÷ 연면적 원/평 이상")
    pp_total_team_max: int | None = Field(None, description="팀 매매가 ÷ 연면적 원/평 이하")
    gongsi_ratio_team_min: float | None = Field(None, description="공시총액 ÷ **팀 매매가** % 이상. 높을수록 땅값이 값을 받친다")
    gongsi_ratio_team_max: float | None = Field(None, description="공시총액 ÷ 팀 매매가 % 이하")
    roi_min: float | None = Field(None, description="팀 수익률 % 이상. 팀이 임대와 매매가를 **둘 다** 적은 건물만 걸린다")             # 수익률(%) = 총임대료 ÷ 팀 매매가
    roi_max: float | None = Field(None, description="팀 수익률 % 이하. 위와 같은 주의")
    ask_min: int | None = Field(None, description="매도희망가 원 이상. 건물주가 부른 값", json_schema_extra=_PRICE)
    ask_max: int | None = Field(None, description="매도희망가 원 이하", json_schema_extra=_PRICE)
    sell_vagues: list[str] | None = Field(None, description="막연한 매도 시점. 값은 「이달 안」·「올해 안」·「상반기」·「하반기」·「연말」·「내년 초」·「봄」·「가을」")
    pp_land_min: int | None = Field(None, description="추정가 ÷ 대지 원/평 이상", json_schema_extra=_EST)           # 평단가 대지(원/평)
    pp_land_max: int | None = Field(None, description="추정가 ÷ 대지 원/평 이하", json_schema_extra=_EST)
    pp_total_min: int | None = Field(None, description="추정가 ÷ 연면적 원/평 이상", json_schema_extra=_EST)          # 평단가 연면적(원/평)
    pp_total_max: int | None = Field(None, description="추정가 ÷ 연면적 원/평 이하", json_schema_extra=_EST)
    deposit_total_min: int | None = Field(None, description="팀 보증금 합 원 이상")     # 총보증금(원)
    deposit_total_max: int | None = Field(None, description="팀 보증금 합 원 이하")
    rent_total_min: int | None = Field(None, description="팀이 적은 월임대 합 원 이상")        # 총임대료(월, 원)
    rent_total_max: int | None = Field(None, description="팀이 적은 월임대 합 원 이하")
    mgmt_total_min: int | None = Field(None, description="팀 관리비 합 원 이상")        # 총관리비(월, 원)
    mgmt_total_max: int | None = Field(None, description="팀 관리비 합 원 이하")
    # 공실은 **면적**이다(0180). 칸 수는 건물주가 어떻게 쪼개 내놓느냐일 뿐이라 뜻이 없다.
    # 공실뺀월임대·공실뺀수익률은 뺐다 — 층별 줄에 공실이 없으니 총월임대·수익률과 같아졌다.
    vacant: str | None = Field(None, description="「있음」 또는 「없음」. **팀이 층마다 공실면적을 적은 건물에만** 뜻이 있다")                # 공실 있음/없음
    vacant_area_min: float | None = Field(None, description="팀이 적은 공실면적 ㎡ 이상")
    vacant_area_max: float | None = Field(None, description="팀이 적은 공실면적 ㎡ 이하")
    # 만실(0181) — 공실이 다 찼다고 가정한 수익률. 공실 평당가가 없는 층은 층별 추정으로 채워서
    # 추정이 섞일 수 있다(줄에선 이름 앞에 「추정」이 붙는다)
    roi_full_min: float | None = Field(None, description="만실 수익률 % 이상. 공실이 다 찼다고 가정한 값이다. 공실 층의 평당가를 모르면 층별 추정으로 채운다")
    roi_full_max: float | None = Field(None, description="만실 수익률 % 이하")
    gongsi_total_min: int | None = Field(None, description="공시지가 총액(㎡단가 × 대지) 원 이상")      # 공시지가 총액(원)
    gongsi_total_max: int | None = Field(None, description="공시지가 총액 원 이하")
    gongsi_ratio_min: float | None = Field(None, description="공시총액 ÷ 추정가 % 이상. 높을수록 땅값이 값을 받친다", json_schema_extra=_EST)    # 총공시/매매가(%)
    gongsi_ratio_max: float | None = Field(None, description="공시총액 ÷ 추정가 % 이하", json_schema_extra=_EST)
    gongsi_up5_min: float | None = Field(None, description="공시지가 5년 상승률 % 이상")      # 공시 상승률 5년(%)
    gongsi_up5_max: float | None = Field(None, description="공시지가 5년 상승률 % 이하")
    gongsi_up10_min: float | None = Field(None, description="공시지가 10년 상승률 % 이상")     # 공시 상승률 10년(%)
    gongsi_up10_max: float | None = Field(None, description="공시지가 10년 상승률 % 이하")
    sale_pnl_min: float | None = Field(None, description="최근 실거래 vs 직전 % 이상")        # 실거래손익(%)
    sale_pnl_max: float | None = Field(None, description="최근 실거래 vs 직전 % 이하")
    sale_count_min: int | None = Field(None, description="실거래 건수 이상")        # 실거래횟수
    sale_count_max: int | None = Field(None, description="실거래 건수 이하")
    pop_day_min: float | None = Field(None, description="주간 유동인구 명/일 이상", json_schema_extra=_EST)         # 유동인구(명) — 생활인구 250m 격자 주간 평균 실측
    pop_day_max: float | None = Field(None, description="주간 유동인구 명/일 이하", json_schema_extra=_EST)
    # ── 업무(app.listings 오버레이) ──
    urgencies: list[str] | None = Field(None, description="팀이 적은 매도 급함 정도. **우리 매물에만 있다**")       # 긴급도
    owner_types: list[str] | None = Field(None, description="소유자가 개인인가 법인인가. 우리 매물에만 있다")     # 소유자타입
    relations: list[str] | None = Field(None, description="연락 닿는 사람과 소유자의 관계. 우리 매물에만 있다")       # 관계
    cooperations: list[str] | None = Field(None, description="소유자가 협조적인가. 우리 매물에만 있다")    # 협조도
    kindnesses: list[str] | None = Field(None, description="소유자가 친절한가. 우리 매물에만 있다")      # 친절도
    meongdos: list[str] | None = Field(None, description="명도(임차인 내보내기) 가능 여부. 우리 매물에만 있다")        # 명도
    use_changes: list[str] | None = Field(None, description="용도변경 가능 여부. 우리 매물에만 있다")     # 용도변경
    myeolsils: list[str] | None = Field(None, description="멸실(헐기) 가능 여부. 우리 매물에만 있다")       # 멸실
    assignees: list[int] | None = Field(None, description="담당자 account_id. 우리 매물에만 있다")       # 담당자(account_id)
    owner_name: str | None = Field(None, description="소유자 이름 부분일치. 우리 매물에만 있다")            # 소유자명(부분일치)
    listing_no: str | None = Field(None, description="매물번호 부분일치(숫자, 예 1295). 우리 매물에만 있다")            # 매물번호(부분일치)
    intent: str | None = Field(None, description="매도 의사. 우리 매물에만 있다")                # 매수의향서 원함/원치않음
    has_phone: str | None = Field(None, description="「있음」 또는 「없음」. 소유자 전화를 아는가. 우리 매물에만 있다")             # 전화번호 있음/없음
    has_photo: str | None = Field(None, description="「있음」 또는 「없음」. 사진이 있는가. **건물을 고르는 조건이 아니다**")             # 사진 있음/없음
    received_from: str | None = Field(None, description="매물 접수일 이후(YYYY-MM-DD). 우리 매물에만 있다")         # 접수일 YYYY-MM-DD
    # 「아님」 — 조건 이름 → 뺄 값들. 모델의 {"없음": [...]} 이 여기로 온다(tools 가 옮긴다).
    # **NULL 은 남긴다.** 안 적힌 것은 「그 값이 아님」이 아니라 「모름」이다(미지정은 null 원칙).
    nots: dict[str, list[str]] | None = Field(None, json_schema_extra=_EST)
    received_to: str | None = Field(None, description="매물 접수일 이전. 우리 매물에만 있다")


class SearchIn(BaseModel):
    polygon: dict | None = None       # GeoJSON — 있으면 지역범위 대체(§3.6c)
    mine_only: bool = False           # 지역·영역 없이 '내 매물'만 — 첫 화면(로그인 직후) 기본 목록
    filters: Filters = Filters()
    # 접어두기(hidden)는 **화면이 거른다**(2026-08-29). 서버로 안 온다.
    # 조건에 딸린 값이라 저장 조건과 함께 다니고 다른 조건에선 다시 보이는데,
    # 그걸 질의 조건으로 두니 접을 때마다 전체를 다시 불러왔다 — 지도가 초기화되고
    # 작업 흐름이 끊겼다. 게다가 building_pk 는 최장 22자리 text 라 프론트가 숫자로
    # 바꿔 보내면 정밀도가 깨져(1e21) 검색 전체가 422 로 죽었다(11,270동이 해당).
    # 걸지는 않지만 결과 줄에 보고 싶은 칸(2026-09-18). 건 조건의 값은 말 안 해도 따라온다.
    fields: list[str] | None = None
    # 정렬 — 별칭 둘(price·roi)은 화면이 쓰고, 그 밖엔 **칸 이름**을 그대로 받는다(모델).
    sort: str = "price"               # price|roi|<칸 이름>
    sort_asc: bool = False            # 작은 것부터
    page_mine: int = 1                # 열별 독립 페이징(§3.4)
    page_normal: int = 1
    per_page: int = 20
    # 모델용 방언. 화면은 안 준다(기본 False). **둘을 따로 두면 반쪽만 켜는 사고가 난다.**
    #   · 팀 조건을 mine 열에만 건다. 두 열에 다 걸면 normal 이 통째로 죽는다
    #     (화면이 그리 되면 「매매가 5억 이상」 칩에 58만 동이 다 나온다 — 기본은 그대로)
    #   · 내매물 = **우리 팀 매물 전부.** 화면의 「내 담당 매물」과 다르다 — 담당자를 안 붙인
    #     매물까지 우리 것이라고 말해야 모델이 「제 매물 중에」를 제대로 답한다
    for_model: bool = False
    # 무엇을 찾는가. 「건물」이 기본이고 「나대지」는 master.vacant_parcels 를 본다.
    # **화면은 안 준다** — 자동완성에만 나대지를 띄우고 목록은 건물만 세운다.
    target: str = "building"          # building | vacant
    # 어느 열만 낼지. "" 면 둘 다. 모델의 `범위` 다 — 화면은 mine_only 를 쓴다.
    only: str = ""                    # "" | mine | normal
    # 검색 탭(S05 §2, 2026-09-28) — 화면은 하나, 탭은 셋. 기본 all 이라 모델 · 옛 호출은 그대로다.
    #   all  전 건물 추정가
    #   deal 실거래 — 기간(sale_years) 안에 거래가 있는 건물만
    #   ad   매매 — 광고(노출 · 거래완료)가 있는 건물 ∪ 내 매물(중개사). chip 으로 좁힌다
    tab: str = "all"                  # all | deal | ad
    chip: str = ""                    # ad 탭: "" 전체 | mine 내 매물 | ads 광고만
    sale_years: int = 3               # deal 탭 기간(대표 09-28 기본 3년)


class SnapIn(BaseModel):
    polygon: dict                     # GeoJSON — 손으로 그린 영역


@router.post("/snap")
async def snap_parcels(body: SnapIn, _: CurrentUser = Depends(any_user)):
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
async def parcel_at_point(lng: float, lat: float, _: CurrentUser = Depends(any_user)):
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
async def parcel_for_building(building_pk: str, _: CurrentUser = Depends(any_user)):
    """한 건물의 필지 합집합(선택 시 분류색 오버레이용). 멀티필지는 union.
    나대지는 'P'+pnu 로 온다(listings 와 같은 약속) — 그 필지 하나."""
    if building_pk.startswith("P"):
        gj = await pool().fetchval(
            "SELECT ST_AsGeoJSON(geom) FROM master.vacant_parcels WHERE pnu=$1", building_pk[1:])
    else:
        gj = await pool().fetchval(
            "SELECT ST_AsGeoJSON(ST_Union(geom)) FROM master.parcels WHERE building_pk=$1",
            building_pk,
        )
    return {"polygon": json.loads(gj) if gj else None}




# 고르는 자가 받는 값. 뜰 때 한 번 읽는다.
# **없는 값은 조용히 걸러지면 안 된다** — 모델이 「광대각지」(실제는 광대세각·광대소각)를 지어내
# 28동이 4동이 됐고, 그게 답으로 나갔다(2026-09-09 대표). 조용한 축소도 거짓말이다.
_ENUM: dict[str, set[str]] = {}
# 있는 지역 코드 접두 전부(시 2 · 구 5 · 동 10 자리). region_index 466줄에서 만든다
_REGION: set[str] = set()
# 이름 → 코드. 「종로구」·「성수동2가」·「강남구 논현동」을 다 받는다
_REGION_NAME: dict[str, list[tuple[str, str]]] = {}   # 낱말 → [(코드, 보여 줄 이름)]


async def load_guards() -> None:
    """막이가 쓸 목록을 채운다. **처음 쓸 때** 채운다 —
    시작할 때만 채우면 그 길을 안 거치는 판(잣대·스크립트)에서 조용히 꺼져 있었다(2026-09-09)."""
    if _REGION and _ENUM:
        return
    # 고르는 자가 받는 값 — **막이가 반만 살아 있으면 없는 것보다 나쁘다.**
    # 「광대로각지」가 조용히 걸러져 12동이 7동이 되어 답으로 나갔다(2026-09-09)
    for fld, col in (("road_frontages", "road_frontage"), ("shapes", "shape"), ("slopes", "slope")):
        try:
            rows = await pool().fetch(
                f"SELECT DISTINCT {col} AS v FROM master.parcels WHERE {col} IS NOT NULL")  # noqa: S608
            _ENUM[fld] = {r["v"] for r in rows if r["v"]}
        except Exception:  # noqa: BLE001 — 못 읽었으면 그 자만 검사를 안 한다
            _ENUM.pop(fld, None)
    try:
        _ENUM["regulations"] = {n for n, _c in await regulation_names()}
    except Exception:  # noqa: BLE001
        _ENUM.pop("regulations", None)
    if _REGION:
        return
    try:
        rows = await pool().fetch(
            "SELECT bjd_code, gu, dong FROM master.region_index WHERE bjd_code IS NOT NULL")
        for r in rows:
            c = r["bjd_code"] or ""
            for n in (2, 5, 10):
                if len(c) >= n:
                    _REGION.add(c[:n])
            gu, dong = r["gu"], r["dong"]
            if gu:
                _REGION_NAME.setdefault(gu, [])
                if not any(x[0] == c[:5] for x in _REGION_NAME[gu]):
                    _REGION_NAME[gu].append((c[:5], f"서울 {gu}"))
            if gu and dong:
                full = f"서울 {gu} {dong}"
                _REGION_NAME.setdefault(dong, []).append((c, full))
                _REGION_NAME.setdefault(f"{gu} {dong}", []).append((c, full))
    except Exception:  # noqa: BLE001 — 못 읽었으면 검사를 안 한다
        _REGION.clear()



def resolve_region(text: str) -> tuple[str, str]:
    """지역 이름 → (코드, 보여 줄 이름). 여럿이면 **고르지 않고** 후보를 담아 400.

    코드를 모르는 쪽이 코드를 만들어 내는 것보다 서버가 맞추는 게 싸고 정확하다 —
    모델은 한 바퀴가 4천 토큰이고, 그 바퀴에서 「1100000000」 같은 걸 지어냈다(2026-09-09).
    """
    want = " ".join(text.replace("서울특별시", "").replace("서울시", "").replace("서울", "").split())
    hit = _REGION_NAME.get(want) or _REGION_NAME.get(want.replace(" ", ""))
    if not hit:
        hit = sorted({(c, nm) for k, v in _REGION_NAME.items() if k.startswith(want) for c, nm in v})
        if not hit:
            raise HTTPException(400, f"「{text}」은 우리 자료에 없다. 우리 판은 **서울시**다")
    if len({c for c, _ in hit}) > 1:
        # **오류가 답을 들고 온다.** 「하나를 골라라」라고만 하니 모델이 사용자에게 되물었다 —
        # 이제 region 이 목록을 받으니 그냥 다 넣으면 된다(2026-09-10 대표).
        names = " / ".join(f"{nm}({c})" for c, nm in hit[:8])
        picks = ", ".join(f'"{nm.replace("서울 ", "")}"' for _, nm in hit[:8])
        raise HTTPException(400, f"「{text}」은 여럿이다: {names}. "
                                 f"다 보려면 region:[{picks}], 하나만 보려면 그 이름 하나를 준다")
    return hit[0]


_REG_NAMES: list[tuple[str, int]] = []


async def regulation_names() -> list[tuple[str, int]]:
    """필지 규제 이름과 그 규제가 걸린 건물 수, 많은 것부터. `master.regulation_names`(0176)를
    읽는다 — 898k 필지 × 규제 열 개를 그때그때 세면 statement_timeout 에 걸린다(2026-09-22 실측).
    필지를 다시 적재하면 그 표도 다시 센다(0176 의 INSERT 그대로). 막이(`_check_enum`)와
    모델 스키마의 값 목록이 같은 표에서 나온다."""
    if not _REG_NAMES:
        rows = await pool().fetch(
            "SELECT name, buildings FROM master.regulation_names ORDER BY buildings DESC, name")
        _REG_NAMES.extend((r["name"], int(r["buildings"])) for r in rows)
    return list(_REG_NAMES)


def _check_enum(field: str, vals: list[str] | None) -> None:
    known = _ENUM.get(field)
    if not vals or not known:
        return
    bad = [v for v in vals if v not in known]
    if bad:
        if len(known) > 40:
            # 규제처럼 값이 수백이면 다 나열하지 않는다 — 틀린 것마다 가까운 이름 셋(2026-09-22)
            near = {b: difflib.get_close_matches(b, known, n=3, cutoff=0.4) for b in bad}
            hint = " · ".join(f"「{b}」→ {n or '비슷한 것 없음'}" for b, n in near.items())
            raise HTTPException(400, f"{field} 에 없는 값: {', '.join(bad)}. 가까운 이름: {hint}")
        raise HTTPException(400, f"{field} 에 없는 값: {', '.join(bad)}. "
                                 f"되는 값: {' · '.join(sorted(known))}")


def _check_bjd(raw: str) -> str:
    """bjd_code 를 검사해 깨끗한 코드로. **없는 지역 코드는 0건이 아니라 오류다.** 조용한 0 을 모델은
    「그런 건물이 없다」로 읽는다. 실제로 나온 것들: 「11-00-06-00-13」(지어냄) · 「1100%」(접두 LIKE 라는
    말에 % 를 붙임) · 「1100000000」(서울시 코드에 0 을 채워 열 자리로 만듦). 셋 다 조용히 0동이 됐다
    (2026-09-09). 자릿수만 보면 셋째가 통과하므로 **실제로 있는 지역인지**를 본다.
    _filter_sql 이 이걸 써서 400 을 낸다."""
    code = raw.rstrip("%").strip()
    if not code.isdigit() or len(code) > 10:
        raise HTTPException(400, f"bjd_code 「{raw}」는 코드가 아니다. "
                                 "숫자만 쓴다(구 5자리 · 동 10자리). % 는 붙이지 않는다. "
                                 "지역 이름으로 찾으려면 /search/suggest 를 먼저 부른다")
    if _REGION and code not in _REGION:
        # **오류가 답을 들고 온다.** 「가서 찾아라」라고만 하니 모델이 코드를 계속 지어내며
        # 열 바퀴를 돌았다(2026-09-09). 가까운 후보를 같이 준다 — 한 바퀴가 1만 토큰이다
        near = sorted(c for c in _REGION if len(c) == 5 and c[:4] == code[:4])[:6] \
            or sorted(c for c in _REGION if len(c) == 5 and c[:2] == code[:2])[:6]
        tip = f" 가까운 구 코드: {' · '.join(near)}" if near else ""
        raise HTTPException(400, f"bjd_code 「{code}」로 시작하는 지역이 없다.{tip} "
                                 "지역 이름을 알면 /search/suggest 가 코드를 준다")
    return code


def _jibun_key(text: str) -> str:
    """지번 주소 → 색인 `master.dong_jibun` 의 열쇠(동+지번, 띄어쓰기·「번지」 없음).
    「서울특별시 종로구 종로5가 104-8번지」·「종로구 종로5가 104-8」·「종로5가 104-8」 → 「종로5가104-8」."""
    norm = text.replace(" ", "")
    norm = re.sub(r"^서울(특별시|시)?", "", norm)
    # 동 이름에 숫자가 낀다(종로5가 · 을지로3가). [가-힣]만 보면 구가 안 떨어져 0건이 났다(2026-09-22)
    norm = re.sub(r"^[가-힣]{1,4}(구|군)(?=[가-힣0-9]{2,}(동|가|로))", "", norm)
    return norm.replace("번지", "")


def _addr_cond(col: str, key: str) -> str:   # noqa: ARG001 — 산 지번도 「우이동산68-1」로 붙어 있어 같은 길이다
    """지번 조건 SQL. 색인(master.dong_jibun)과 정확 일치."""
    return f"master.dong_jibun({col}) = ${{i}}"


def _filter_sql(f: Filters, args: list, with_team: bool = True) -> tuple[str, str, str]:
    """속성 필터 → (마스터 WHERE절, 외부 WHERE절, 팀 WHERE절). 마스터=classified 내부(b.·조인) /
    외부=classified 계산값 필터 / 팀=계산값 중 **listings 에서 온 것**.
    셋 모두 앞에 ' AND '가 붙어 바로 이어붙이기 가능(빈 문자열이면 없음).
    `with_team=False` 면 팀 조건을 **아예 안 만든다** — 절만 버리면 값은 args 에 남아
    「인자 2개를 기대하는데 3개가 왔다」로 죽는다.

    팀 절을 갈라 내는 이유: 이 함수는 mine·normal 열마다 한 번씩 불리는데, `normal` 쪽은
    listings 칸이 전부 NULL 이라 팀 조건 하나에 58만 동이 통째로 죽는다(명도를 걸면 서울에서
    후보가 4동이 된다). 어느 절을 붙일지는 `_build_base` 가 열을 보고 정한다."""
    m: list[str] = []   # classified 내부(b. 컬럼·조인 l.)
    matched: list[str] = []   # 이름으로 받은 것을 무엇으로 읽었는지 — 응답에 실어 돌려준다
    o: list[str] = []   # 외부(classified SELECT 계산값 별칭) — 마스터
    t: list[str] = []   # 외부 중 팀이 적은 값(listings). normal 열엔 안 붙일 수 있다

    def add(lst, cond, val):
        if lst is t and not with_team:
            return
        args.append(val)
        lst.append(cond.format(i=len(args)))
    def rng(lst, col, lo, hi):
        if lo is not None: add(lst, f"{col} >= ${{i}}", lo)
        if hi is not None: add(lst, f"{col} <= ${{i}}", hi)
    def anyof(lst, col, vals):
        if vals: add(lst, f"{col} = ANY(${{i}})", vals)

    # ── 마스터(b.) — classified WHERE ──
    if f.building_pk:
        one = isinstance(f.building_pk, str)
        add(m, "b.building_pk = ${i}" if one else "b.building_pk = ANY(${i}::text[])",
            f.building_pk)
    if f.region and not f.bjd_code:
        wants = f.region if isinstance(f.region, list) else [f.region]
        ors = []
        for w in wants[:10]:
            code, name = resolve_region(w)
            args.append(code)
            ors.append(f"b.bjd_code LIKE ${len(args)} || '%'")
            matched.append(name)
        if ors:
            m.append("(" + " OR ".join(ors) + ")")

    if f.bjd_code:
        add(m, "b.bjd_code LIKE ${i} || '%'", _check_bjd(f.bjd_code))
    if f.addr:
        key = _jibun_key(f.addr)
        add(m, _addr_cond("b.addr", key), key)
    anyof(m, "b.use_zone", f.use_zones)
    anyof(m, "b.jimok", f.jimoks)
    for _fld, _vals in (("road_frontages", f.road_frontages), ("shapes", f.shapes), ("slopes", f.slopes)):
        _check_enum(_fld, _vals)
    anyof(m, "b.road_frontage", f.road_frontages)
    anyof(m, "b.shape", f.shapes)
    anyof(m, "b.slope", f.slopes)
    rng(m, "br.front_m", f.road_front_min, f.road_front_max)   # 도로폭 원장(building_road) 조인
    if f.regulations:
        _check_enum("regulations", f.regulations)
        add(m, "EXISTS (SELECT 1 FROM master.parcels p, jsonb_array_elements(p.regulations) e"
               " WHERE p.building_pk = b.building_pk AND e->>0 = ANY(${i}::text[]))", f.regulations)
    anyof(m, "b.land_use", f.land_uses)
    anyof(m, "b.main_use_name", f.main_uses)   # UI=주용도명 · DB main_use_name과 직접 일치(코드매핑 불필요)
    if f.etc_use:
        add(m, "b.etc_use ILIKE '%' || ${i} || '%'", f.etc_use)
    # 업종·상호 — **카카오**(2026-09-16). 이 함수는 동기라 핸들러가 resolve_biz() 로 먼저 카카오를
    # 불러 pk 집합을 filters.__dict__['_biz'] 에 둔다. 여기서는 그 집합만 SQL 에 싣는다.
    # 집합이 비면 = ANY('{}') 로 0건인데 그게 맞다 — 그 범위에 그 업종이 없다는 답이다.
    if f.use:
        # 주용도 **부분일치**. 「근린생활시설」 한 낱말로 제1종·제2종을 다 잡아야 한다 —
        # main_uses 처럼 이름을 통째로 맞추면 못 잡는다(그쪽은 화면의 다중선택이다).
        # 목록의 목록: 바깥 OR · 안쪽 AND. 부분일치라 안쪽 AND 가 뜻을 갖는다 —
        # [["제1종","근린생활"]] 이 「제1종근린생활시설」 하나를 짚는다.
        ors = []
        for g in f.use:
            ands = []
            for w in (g if isinstance(g, list) else [g]):
                if str(w).strip():
                    args.append(str(w).strip())
                    ands.append(f"b.main_use_name ILIKE '%' || ${len(args)} || '%'")
            if ands:
                ors.append("(" + " AND ".join(ands) + ")")
        if ors:
            m.append("(" + " OR ".join(ors) + ")")

    # 「아님」 — 이름이 어느 목록·어느 칸인지는 _NOT_COL 이 안다.
    # **NULL 은 남긴다.** 안 적힌 것은 그 값이 아니라 「모름」이다.
    for fname, vals in (f.nots or {}).items():
        vals = [str(v).strip() for v in (vals or []) if str(v).strip()]
        if fname == "regulations":            # 필지 여럿의 배열이라 = ANY 가 아니라 NOT EXISTS
            if vals:
                _check_enum("regulations", vals)
                add(m, "NOT EXISTS (SELECT 1 FROM master.parcels p, jsonb_array_elements(p.regulations) e"
                       " WHERE p.building_pk = b.building_pk AND e->>0 = ANY(${i}::text[]))", vals)
            continue
        where, col = _NOT_COL.get(fname, (None, None))
        if not col or not vals:
            continue
        lst = m if where == "m" else t
        if fname in _NOT_LIKE:
            for w in vals:
                add(lst, f"COALESCE({col},'') NOT ILIKE '%' || ${{i}} || '%'", w)
        else:
            add(lst, f"({col} IS NULL OR NOT ({col} = ANY(${{i}})))", vals)
    biz = f.__dict__.get("_biz")
    rest_and = list(biz["and"]) if biz else []
    if biz:
        for pks in rest_and:
            add(m, "b.building_pk = ANY(${i})", sorted(pks))
        for pks in biz["not"]:
            if pks:
                add(m, "NOT (b.building_pk = ANY(${i}))", sorted(pks))
    elif f.biz or f.biz_dnf or f.biz_not:
        # **조용히 빼지 않는다.** 필터가 빠진 채 전체가 나가면 모델은 「그 업종이 다 있다」로 읽는다.
        raise HTTPException(500, "biz 필터가 준비되지 않았다 — 핸들러가 resolve_biz(body) 를 먼저 부른다")
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
    rng(t, "team_price", f.price_min, f.price_max)   # 매매가 = 팀이 적은 값만
    # 모델용 「값」 — 넷 중 어느 하나라도 범위면. 각 열은 NULL 이면 그 항만 거짓이라 OR 로 묶으면 된다
    if f.value_min is not None or f.value_max is not None:
        parts = []
        for col in ("team_price", "sale_est", "ask_price"):
            c = []
            if f.value_min is not None: add(c, f"{col} >= ${{i}}", f.value_min)
            if f.value_max is not None: add(c, f"{col} <= ${{i}}", f.value_max)
            parts.append("(" + " AND ".join(c) + ")")
        o.append("(" + " OR ".join(parts) + ")")
    rng(t, "roi", f.roi_min, f.roi_max)
    rng(o, "roi_est", f.roi_est_min, f.roi_est_max)
    rng(o, "sale_est", f.sale_est_min, f.sale_est_max)
    rng(o, "rent_est_m", f.rent_est_min, f.rent_est_max)
    rng(o, "deposit_est", f.deposit_est_min, f.deposit_est_max)
    rng(t, "ask_price", f.ask_min, f.ask_max)          # 매도희망가 — 건물주가 부른 값
    rng(o, "pp_land", f.pp_land_min, f.pp_land_max)
    rng(t, "pp_land_team", f.pp_land_team_min, f.pp_land_team_max)
    rng(t, "pp_total_team", f.pp_total_team_min, f.pp_total_team_max)
    rng(t, "gongsi_ratio_team", f.gongsi_ratio_team_min, f.gongsi_ratio_team_max)
    rng(o, "pp_total", f.pp_total_min, f.pp_total_max)
    rng(t, "deposit_total", f.deposit_total_min, f.deposit_total_max)
    rng(t, "rent_total", f.rent_total_min, f.rent_total_max)
    rng(t, "mgmt_total", f.mgmt_total_min, f.mgmt_total_max)
    rng(t, "vacant_area", f.vacant_area_min, f.vacant_area_max)
    rng(t, "roi_full", f.roi_full_min, f.roi_full_max)
    if f.vacant == "있음": t.append("vacant_area > 0")
    # **COALESCE 를 쓰지 않는다.** 공실면적은 NULL(모름)·0(만실)·값 셋이다. NULL 을 0으로 메우면
    # 한 층도 안 적은 건물이 전부 「공실 없음」으로 걸린다(2026-09-25 · 0179 · 0180).
    elif f.vacant == "없음": t.append("vacant_area = 0")
    rng(o, "gongsi_total", f.gongsi_total_min, f.gongsi_total_max)
    rng(o, "gongsi_ratio", f.gongsi_ratio_min, f.gongsi_ratio_max)
    rng(o, "gongsi_up5", f.gongsi_up5_min, f.gongsi_up5_max)
    rng(o, "gongsi_up10", f.gongsi_up10_min, f.gongsi_up10_max)
    rng(o, "sale_pnl", f.sale_pnl_min, f.sale_pnl_max)
    rng(o, "sale_cnt", f.sale_count_min, f.sale_count_max)
    rng(o, "float_pop", f.pop_day_min, f.pop_day_max)
    # 업무(listings) — classified가 별칭으로 SELECT
    anyof(t, "urgency", f.urgencies)
    anyof(t, "owner_type", f.owner_types)
    anyof(t, "relation", f.relations)
    anyof(t, "cooperation", f.cooperations)
    anyof(t, "kindness", f.kindnesses)
    anyof(t, "sell_vague", f.sell_vagues)
    anyof(t, "meongdo", f.meongdos)
    anyof(t, "use_change", f.use_changes)
    anyof(t, "myeolsil", f.myeolsils)
    if f.assignees:
        add(t, "assignee_account_id = ANY(${i})", f.assignees)
    if f.owner_name:
        add(t, "owner_name ILIKE '%' || ${i} || '%'", f.owner_name)
    if f.listing_no:
        add(t, "listing_no ILIKE '%' || ${i} || '%'", f.listing_no)
    if f.intent:
        add(t, "intent = ${i}", f.intent)
    if f.has_phone == "있음": t.append("(owner_phone IS NOT NULL AND owner_phone <> '')")
    elif f.has_phone == "없음": t.append("(owner_phone IS NULL OR owner_phone = '')")
    if f.has_photo == "있음": t.append("has_photo")
    elif f.has_photo == "없음": t.append("NOT has_photo")
    if f.received_from:
        add(t, "received_on >= ${i}::date", f.received_from)
    if f.received_to:
        add(t, "received_on <= ${i}::date", f.received_to)

    ms = (" AND " + " AND ".join(m)) if m else ""
    os_ = (" AND " + " AND ".join(o)) if o else ""
    ts = (" AND " + " AND ".join(t)) if (t and with_team) else ""
    f.__dict__["_matched"] = matched      # 무엇으로 읽었는지 — 핸들러가 응답에 싣는다
    return ms, os_, ts


def _tab_sql(body: SearchIn, args: list, mine_is: str) -> str:
    """검색 탭 → raw WHERE 조건(S05 §2). all 은 아무것도 안 붙인다.
    raw 에서 거른다 — classified 바깥에 두면 서울 전역 매매 탭이 58만 행을 다 만들고 버린다.
    ad_agg 에 줄이 있으면 광고(노출 · 거래완료)가 있는 건물이다."""
    if body.tab == "deal":
        args.append(max(1, min(body.sale_years or 3, 30)))
        return (f" AND b.last_sale_price IS NOT NULL AND b.last_sale_ym >= "
                f"to_char(now() - make_interval(years => ${len(args)}::int), 'YYYYMM')")
    if body.tab == "ad":
        if body.chip == "mine":
            return f" AND {mine_is}"
        if body.chip == "ads":
            return " AND aa.building_pk IS NOT NULL"
        return f" AND (aa.building_pk IS NOT NULL OR {mine_is})"
    return ""


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
    # 팀 절은 기본으로 두 열에 다 붙는다(화면). for_model 이면 normal 에는 안 붙여,
    # 「우리 매물 중 조건 맞는 것 + 일반 건물 전부」가 나온다(모델). 그 뜻은 도구 설명에 있다.
    # 고객(팀 없음)에게는 팀 조건을 아예 안 만든다 — 팀 칸은 이름부터 없다(S05 §1)
    with_team = not (body.for_model and col == "normal") and user.team_id is not None
    master_filt, outer_sql, team_sql = _filter_sql(body.filters, args, with_team)
    outer_sql += team_sql
    # 'mine'만 내린다. 'normal'에 IS NULL을 걸면 대다수 행이 통과하는 조건이라
    # 플래너가 조인 순서를 바꿔 되레 느려졌다(구 단위 615ms→1401ms 실측).
    # 모델에겐 팀 매물 전부가 내 매물이다(SearchIn.for_model). 화면은 담당 배정된 것만.
    # l 은 이미 team_id = $1 로 조인돼 있으므로 모델 쪽은 「줄이 있으면」이 곧 우리 것이다.
    # **두 자리에 같이 써야 한다** — raw 의 WHERE 는 훑을 행을 줄이는 것이고, 열을 실제로
    # 가르는 것은 classified 의 CASE 다. 한쪽만 고쳤다가 13건이 5건으로 나왔다(2026-09-19).
    mine_is = "l.id IS NOT NULL" if body.for_model else "l.assignee_account_id IS NOT NULL"
    mine_is_out = "has_listing" if body.for_model else "assignee_account_id IS NOT NULL"
    col_filt = f" AND {mine_is}" if col == "mine" else ""
    col_filt += _tab_sql(body, args, mine_is)
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
        _mine_w = "" if body.for_model else " AND assignee_account_id IS NOT NULL"
        mine_cte = ("      mine_pk AS MATERIALIZED ("
                    "SELECT building_pk FROM app.listings"
                    f" WHERE team_id = $1{_mine_w}),\n")
        mine_join = "        JOIN mine_pk mp ON mp.building_pk = b.building_pk\n"

    # 유동인구 = **실측 명수 그대로**(서울 생활인구 250m 격자 주간 평균, master.building_pop · 0130).
    # 예전엔 (도로접면 점수 + 역거리 점수)/2 를 다섯 칸으로 잘라 「높음」이라 불렀다. 이름만
    # 유동인구고 실제로는 접근성이었다. 실측으로 갈아탄 뒤에도 다섯 칸 등급이 남아 있었는데,
    # 그 칸은 우리가 정한 분위라 「매우높음」이 몇 명인지 아무도 몰랐다(2026-08-28 제거).
    # 서울 분포: 최소 4 · 중앙 1,313 · 상위5% 3,903 · 최대 25,498 명/일.
    # 유동인구 = 실측 명수 그대로(master.building_pop · 0130). 점수·파생은 전부 저장된 칸을 읽는다(0174).
    float_pop_case = "bp.day_avg"
    # 규제 이름 배열 — 조건으로 걸었거나 칸으로 달라고 했을 때만 모은다(줄마다 하위질의)
    _f = body.filters
    need_reg = bool(_f.regulations or (_f.nots and "regulations" in _f.nots)
                    or ("reg_names" in (body.fields or [])))
    reg_col = ("(SELECT array_agg(DISTINCT e->>0) FROM master.parcels p, jsonb_array_elements(p.regulations) e"
               " WHERE p.building_pk = b.building_pk)") if need_reg else "NULL::text[]"

    base = f"""
      WITH {mine_cte}      photo_ex AS (SELECT DISTINCT building_pk FROM app.photos),
      -- 광고(0191) — 건물마다 노출 중 건수 · 공개된 최저가 · 거래완료가 있었나. 누구나 본다
      ad_agg AS (
        SELECT building_pk,
               count(*) FILTER (WHERE state = '노출' AND expires_on >= current_date) AS ad_n,
               min(price) FILTER (WHERE state = '노출' AND expires_on >= current_date AND price_open) AS ad_price_min,
               bool_or(state = '거래완료') AS ad_sold
          FROM app.ads WHERE state IN ('노출','거래완료') GROUP BY building_pk),
      raw AS (
        SELECT b.building_pk, b.addr, b.land_area, b.total_area, b.gongsi_latest,
               b.floors_above, b.floors_below, b.use_zone,
               -- 되비침용 대장 칸(2026-09-18) — 모델이 조건으로 건 값을 결과 줄에 같이 낸다.
               -- 안 걸면 SELECT 에 안 실리므로 응답은 안 커진다.
               b.jimok, b.land_use, b.road_frontage, b.shape, b.slope,
               -- 조회(building) 대장에만 있던 넷(2026-09-21). 검색 줄에서도 고를 수 있어야
               -- 「건물번호로 한 채」가 조회를 대신한다. 걸 조건이 없으니 fields 로만 나간다.
               b.structure, b.height, b.road_addr, b.bjd_code,
               b.main_use_name, b.etc_use, b.build_area, b.far_area, b.parcel_area,
               b.elevator, b.parking, b.station_dist, b.approval_ymd, b.remodel_ymd,
               -- 실측 도로폭 셋(building_road)과 필지 규제 이름들(2026-09-22). 규제는 필지마다
               -- jsonb 목록이라 걸거나 달랄 때만 모은다 — 안 그러면 줄마다 하위질의가 돈다.
               br.front_m AS road_front, br.side_m AS road_side, br.rear_m AS road_rear,
               {reg_col} AS reg_names,
               ST_X(b.geom) AS lng, ST_Y(b.geom) AS lat,
               b.last_sale_price, b.last_sale_ym,
               -- 팀이 적은 값은 **매물 줄 한 곳**(app.listings, 0173)에서 온다. 매매가·매도희망가·
               -- 임대 합계·수익률 전부. 층별(floor_rents)은 쓸 때 mirror 가 여기로 접어 두므로
               -- 검색은 조인도 나눗셈도 안 한다. 예전엔 overlays·floor_rents 를 CTE 로 매번 모았다.
               l.sale_price, l.ask_price, se.sale_est, re.annual_rent,
               re.monthly_rent AS rent_est_m, re.deposit_est,
               l.total_rent AS rent_total, l.total_deposit AS deposit_total, l.total_mgmt AS mgmt_total,
               l.vacant_area, l.roi AS team_roi, l.sell_vague,
               l.rent_full, l.roi_full, l.full_est,      -- 만실(0181) · full_est 면 추정이 섞였다
               (l.id IS NOT NULL) AS has_listing,   -- 「우리 팀 매물인가」 · 담당 배정과 다르다
               l.assignee_account_id, l.urgency, l.grade, l.ipji, ow.owner_type,
               ow.relation, ow.cooperation, ow.kindness, l.building_major, l.building_use, l.price_vs_market, l.meongdo, l.use_change,
               l.myeolsil, l.nohudo, ow.phone AS owner_phone, ow.name AS owner_name,
               l.listing_no, l.intent, l.received_on,
               sa.sale_cnt,
               (ph.building_pk IS NOT NULL) AS has_photo,
               b.bcr, b.far,
               -- 법정 건폐·용적은 **필지 원장**에서 온다(master.building_legal · 토지이음 산식 0153).
               bl.legal_bcr, bl.legal_far,
               -- **읽을 때 계산하는 값은 없다**(0174). 추정 수익률·평단가·공시비율·공시 상승·실거래 등락·
               -- 건폐/용적 여유·도로/역 점수는 파이프라인이 master.building_derived 에 채운 칸이고,
               -- 팀 매매가로 나눈 셋은 매물 줄(listings)에 접혀 있다. 산식은 DB 함수 한 벌뿐이다.
               bd.roi_est, bd.pp_land, bd.pp_total, bd.gongsi_total, bd.gongsi_ratio,
               bd.gongsi_up5, bd.gongsi_up10, bd.sale_pnl, bd.bcr_slack, bd.far_slack,
               bd.road_score, bd.station_score,
               l.pp_land_team, l.pp_total_team, l.gongsi_ratio_team,
               COALESCE(aa.ad_n, 0) AS ad_n, aa.ad_price_min, COALESCE(aa.ad_sold, false) AS ad_sold,
               {float_pop_case} AS float_pop_calc,
               bp.night_avg AS float_pop_night     -- 모델 칸 「유동인구」는 주간·야간 두 수(2026-09-22)
        FROM master.buildings b
{mine_join}        LEFT JOIN master.building_sale_est se ON se.building_pk = b.building_pk
        LEFT JOIN master.building_rent_est re ON re.building_pk = b.building_pk
        -- 유동인구 실측(0130) — 건물 좌표를 250m 격자로 접어 붙여 둔 표라 조인 한 번이다
        LEFT JOIN master.building_pop bp ON bp.building_pk = b.building_pk
        LEFT JOIN master.building_legal bl ON bl.building_pk = b.building_pk
        LEFT JOIN master.building_road br ON br.building_pk = b.building_pk     -- 실측 도로폭(08-07)
        -- 검색 전용 계산값(0143) — 필터만 읽는다. SELECT 에는 안 싣는다(화면=대장)
        LEFT JOIN master.building_calc bc ON bc.building_pk = b.building_pk
        LEFT JOIN master.building_derived bd ON bd.building_pk = b.building_pk   -- 파생값(0174)
        {listing_join} app.listings l ON l.building_pk = b.building_pk AND l.team_id = $1
        LEFT JOIN app.owners ow ON ow.id = l.owner_id AND ow.deleted_at IS NULL   -- 0058 · 소유자는 사람 표
        LEFT JOIN master.sales_agg sa ON sa.building_pk = b.building_pk   -- MV(0028): 매 검색마다 11.4만행 재집계하던 CTE 대체
        LEFT JOIN photo_ex ph ON ph.building_pk = b.building_pk
        LEFT JOIN ad_agg aa ON aa.building_pk = b.building_pk
        WHERE TRUE {poly_sql} {master_filt} {col_filt}
      ),
      classified AS (
        SELECT building_pk, addr, land_area, total_area, floors_above, floors_below, use_zone,
               jimok, land_use, road_frontage, shape, slope, main_use_name, etc_use,
               structure, height, road_addr, bjd_code,          -- 조회 대장에만 있던 넷(2026-09-21)
               build_area, far_area, parcel_area, elevator, parking, station_dist,
               road_front, road_side, road_rear, reg_names,
               approval_ymd, remodel_ymd, bcr, far, gongsi_latest,
               lng, lat, last_sale_price, last_sale_ym, sale_est, assignee_account_id,
               urgency, grade, ipji, owner_type, relation, cooperation, kindness,
               building_major, building_use, price_vs_market, meongdo, use_change, myeolsil, nohudo,
               owner_phone, owner_name, listing_no, intent, received_on, has_photo,
               COALESCE(sale_cnt, 0) AS sale_cnt,
               CASE WHEN {mine_is_out} THEN 'mine' ELSE 'normal' END AS col,
               COALESCE(sale_price, sale_est) AS price,
               (sale_price IS NULL) AS price_is_est,
               -- 실측 짝의 수익률 = 총임대료 ÷ **팀 매매가**. 매물 줄에 접어 둔 값이다(0173).
               team_roi AS roi,
               deposit_total, rent_total, mgmt_total, vacant_area, rent_full, roi_full, full_est,
               ask_price, sell_vague,   -- 0000 매도희망가·매도 시점
               -- 추정 연임대 — 추정가와 짝. 실측(rent_total)과 섞지 않는다: 카드는 추정 짝·실측 짝을 갈라 보여준다.
               annual_rent AS est_annual_rent, rent_est_m, deposit_est,
               roi_est,                    -- 추정 연임대 ÷ 추정가 — building_derived(0174)
               sale_price AS team_price,   -- 필터용 팀 매매가(표시용 price 는 추정가 폴백이 섞인다)
               pp_land_team, pp_total_team, gongsi_ratio_team,   -- 팀 매매가로 나눈 셋 — listings(0173·0174)
               pp_land, pp_total, gongsi_total, gongsi_ratio,    -- 추정가·공시 — building_derived
               gongsi_up5, gongsi_up10, sale_pnl,
               float_pop_calc AS float_pop, float_pop_night,
               legal_bcr, legal_far,
               -- **여기 부호는 건물 상세와 반대다. 일부러 그렇다.**
               -- 건물 상세는 「법정 대비」 = 현재 − 법정 을 낸다(넘었으면 +, 빨강).
               -- 검색은 「얼마나 더 지을 수 있나」를 묻는 필터라 법정 − 현재 이고 0에서 끊는다.
               -- 법정치는 이제 둘 다 같은 원장(building_legal)에서 온다 — 다른 것은 부호뿐이다.
               bcr_slack, far_slack,   -- 법정 − 현재, 0에서 끊음 — building_derived(0174)
               ad_n, ad_price_min, ad_sold,
               -- 핀 종류(S05 §2) — 내 매물 파랑 · 광고 검정 · 거래완료 회색 · 그 밖은 일반
               CASE WHEN {mine_is_out} THEN 'mine' WHEN ad_n > 0 THEN 'ad'
                    WHEN ad_sold THEN 'sold' ELSE 'normal' END AS kind
        FROM raw
      )
    """
    return base, args, outer_sql


# 카카오 지번 → PNU. 「서울 성동구 성수동2가 317-20」·「… 산 12-3」·「… 864」
_JIBUN = re.compile(r"^서울 (\S+) (\S+?) (산 )?(\d+)(?:-(\d+))?$")


def _pnu_of(addr: str | None) -> str | None:
    """카카오 address_name → 19자리 PNU. 못 읽으면 None(조용히 지어내지 않는다).
    구·동 → 법정동 코드는 load_guards 가 채운 _REGION_NAME 에서 **단 하나로 풀릴 때만** 쓴다."""
    m = _JIBUN.match(addr or "")
    if not m:
        return None
    hit = _REGION_NAME.get(f"{m[1]} {m[2]}") or []
    codes = {c for c, _ in hit if len(c) == 10}
    if len(codes) != 1:
        return None
    return f"{codes.pop()}{'2' if m[3] else '1'}{int(m[4]):04d}{int(m[5] or 0):04d}"


async def resolve_biz(body: SearchIn) -> None:
    """biz 계열(biz·biz_dnf·biz_not·biz_min) → **우리 업체 표(master.biz)** 에서 건물 pk 집합.

    2026-09-27 카카오 키워드 검색 → 크롤링 적재로 바꿨다(스펙 11 §8-2). 업체가 이미 건물번호를 달고 있어
    카카오 주소 풀기·사각형 범위·타일 쪼개기·45건 상한이 다 필요 없다. 범위는 검색이 원래 거는
    지역·영역 조건으로 먼저 좁혀 뽑는다(같은 조건을 본 SQL 이 한 번 더 건다).
    낱말은 **상호명 부분일치** 또는 **업종 마디**(「병원」이면 피부과·치과까지, ref.biz_cat 조상 펼침)로 건다.
    건물은 필지로 붙였다(building_pks) — 한 필지에 건물이 여럿이면 그 필지 건물을 다 남긴다(주소로 못 가른다).
    결과는 filters.__dict__['_biz'] 에 두고 _filter_sql(동기)이 SQL 로 싣는다. 응답엔 낱말별 업체·건물 수를
    _biz_meta 로 밝힌다."""
    from .tenants import norm_name
    f = body.filters
    dnf = [[str(w).strip() for w in (g if isinstance(g, list) else [g]) if str(w).strip()]
           for g in (f.biz_dnf or [])]
    dnf = [g for g in dnf if g]
    words_and = ([f.biz] if f.biz else []) + [w for g in dnf for w in g]
    words_not = list(f.biz_not or [])
    words = list(dict.fromkeys(w.strip() for w in words_and + words_not if w and w.strip()))
    if not words:
        return
    # 범위 — 검색에 건 영역 > 건물 > 지역으로 먼저 좁힌다. 서울 전체에서 뽑으면 「병원」이 2만 동이라
    # 3초가 넘고, 그 큰 집합을 본 SQL 에 또 싣는다(2026-09-27 실측 3.3초 → 동 제한 0.36초)
    scope, sargs = "", []
    if body.polygon:
        scope = ("JOIN master.buildings bb ON bb.building_pk = b.pk"
                 " AND ST_Intersects(bb.geom, ST_MakeValid(ST_GeomFromGeoJSON($3::text)))")
        sargs = [json.dumps(body.polygon)]
    elif f.building_pk:
        scope = "WHERE b.pk = ANY($3::text[])"
        sargs = [[f.building_pk] if isinstance(f.building_pk, str) else list(f.building_pk)]
    elif f.bjd_code or f.region:
        codes = [_check_bjd(f.bjd_code)] if f.bjd_code else \
                [resolve_region(w)[0] for w in (f.region if isinstance(f.region, list) else [f.region])[:10]]
        scope = "JOIN master.buildings bb ON bb.building_pk = b.pk AND bb.bjd_code LIKE ANY($3::text[])"
        sargs = [[c + "%" for c in codes]]
    counts: list[dict[str, int]] = [{} for _ in words]
    hit_names: list[dict[str, list[str]]] = [{} for _ in words]
    places_n = [0] * len(words)
    for i, w in enumerate(words):
        nk = norm_name(w)
        # 상호명(트라이그램 색인) ∪ 업종 마디(GIN) — 한 질의에 OR 로 묶으면 색인을 못 탄다
        rows = await pool().fetch("""
            WITH z AS (
              SELECT id, name, building_pks FROM master.biz
               WHERE gone_on IS NULL AND $2 <> '' AND name_norm LIKE '%' || $2 || '%'
              UNION
              SELECT id, name, building_pks FROM master.biz
               WHERE gone_on IS NULL AND cat_nodes @> ARRAY[$1::text])
            SELECT b.pk AS building_pk, count(*)::int AS n,
                   array_agg(DISTINCT z.name) FILTER (WHERE z.name <> '') AS nms,
                   (SELECT count(*) FROM z)::int AS total
              FROM z CROSS JOIN LATERAL unnest(z.building_pks) AS b(pk) """ + scope + """
             GROUP BY b.pk""", w, nk, *sargs)
        for r in rows:
            counts[i][r["building_pk"]] = r["n"]
            if r["nms"]:
                # 상호명을 같이 들고 간다 — 줄에 「병원: [일등플란트치과의원]」이 붙으면 모델이
                # 건물을 열어 층별에서 확인하는 바퀴를 안 돈다(2026-09-19 실측 왕복 4 중 2가 그것)
                hit_names[i][r["building_pk"]] = sorted(r["nms"])[:5]
        places_n[i] = rows[0]["total"] if rows else 0
    idx = {w: i for i, w in enumerate(words)}
    need_and: list[set[str]] = []
    if f.biz:
        m = max(1, f.biz_min or 1)
        need_and.append({pk for pk, n in counts[idx[f.biz.strip()]].items() if n >= m})
    # 목록의 목록 — 안쪽은 교집합, 바깥은 합집합. 파이썬에서 다 접어 **집합 하나**로 만든다.
    # SQL 에는 pk 배열 한 번만 실린다.
    if dnf:
        pos: set[str] = set()
        for g in dnf:
            inner = set(counts[idx[g[0]]])
            for w in g[1:]:
                inner &= set(counts[idx[w]])
            pos |= inner
        need_and.append(pos)
    need_not = [set(counts[idx[w.strip()]]) for w in words_not if w.strip()]
    f.__dict__["_biz"] = {"and": need_and, "not": need_not}
    # 대표 낱말(biz)의 건물별 개수 — 응답 줄의 biz_n 이 된다(화면)
    if f.biz and f.biz.strip():
        f.__dict__["_biz_n"] = counts[idx[f.biz.strip()]]
    # 낱말별 상호명 — 모델 응답 줄이 「병원: [일등플란트치과의원]」으로 낸다
    f.__dict__["_biz_names"] = {w: hit_names[idx[w]] for g in dnf for w in g}
    # 업체 수는 서울 전체(낱말이 얼마나 흔한가) · 건물 수는 범위 안
    f.__dict__["_biz_meta"] = [{"낱말": w, "업체": places_n[i], "건물": len(counts[i])}
                               for i, w in enumerate(words)]


# ── 줄에 무엇을 싣나(2026-09-18) ─────────────────────────────────────────────
#
# **안 물은 값은 주지 않는다.** 61키를 통째로 주던 때 모델은 안 물어본 칸으로 이상한 견줌을 만들었다
# (「공시지가 대비 8.68%라 저평가」 — 아무도 안 물었고 그 숫자 하나로는 알 수도 없다).
# 열다섯으로 줄여도 같은 병이다. 무엇을 견줄지는 **모델이 조건을 세우며 정한다**(조건 세우기 스킬).
#
#   늘        pk · 주소 · 값 둘(팀 매매가 · 추정가)          — 없으면 가리킬 수도, 값을 말할 수도 없다
#   따라옴    이번에 건 조건의 값                            — 자기가 건 조건은 결과에서 보여야 설명이 된다
#   고른 것   fields 로 달라고 한 칸                         — 걸지는 않지만 답에 쓸 값
#
# 값을 한 칸(price)에 섞지 않는다. sale_price 는 팀이 적은 것, sale_est 는 우리 추정이고, 둘을
# COALESCE 로 합치면 모델이 사실과 추정을 못 가른다 — 지난번 estimate·등급이 거기서 나왔다.
_BASE_COLS = ("building_pk", "addr", "team_price AS sale_price", "sale_est")

# 필터 → 결과 줄에 되비칠 칸. 여기 없는 필터는 되비치지 않는다(지역·영역처럼 값이 아닌 것).
# 「아님」이 되는 조건 — 이름 → (어느 목록, SQL 칸). m=classified 안쪽(b.) · t=팀 계산값.
# 입주업체는 여기 없다 — 카카오라 SQL 이 아니라 resolve_biz 가 집합으로 뺀다.
_NOT_COL: dict[str, tuple[str, str]] = {
    "use_zones": ("m", "b.use_zone"), "jimoks": ("m", "b.jimok"),
    "road_frontages": ("m", "b.road_frontage"), "shapes": ("m", "b.shape"),
    "slopes": ("m", "b.slope"), "land_uses": ("m", "b.land_use"),
    "use": ("m", "b.main_use_name"), "etc_use": ("m", "b.etc_use"),
    "urgencies": ("t", "urgency"), "owner_types": ("t", "owner_type"),
    "relations": ("t", "relation"), "cooperations": ("t", "cooperation"),
    "kindnesses": ("t", "kindness"), "sell_vagues": ("t", "sell_vague"),
    "meongdos": ("t", "meongdo"), "use_changes": ("t", "use_change"),
    "myeolsils": ("t", "myeolsil"),
    "regulations": ("m", "regulations"),   # 값은 안 쓴다 — _filter_sql 이 NOT EXISTS 로 따로 뺀다
}
_NOT_LIKE = frozenset({"use", "etc_use"})     # 부분일치라 = ANY 가 아니라 NOT ILIKE

# 정렬 별칭 — 화면이 쓰는 둘. 값 없는 항목은 후순위(NULLS LAST).
# 수익률순은 **추정 수익률**로 세운다 — 팀 매매가는 극소수라 그걸로 세우면 목록이 빈다.
# 별칭 둘은 방향을 받는다(2026-09-21). 전엔 DESC 가 박혀 있어 모델이 「가격 오름차순」을
# 달래도 내림차순이 나갔다 — 잘린 꼬리가 싼 쪽이라 「80억쯤」을 묻고 싼 것을 못 봤다.
# 화면은 sort_asc 를 안 보내므로(기본 False) 화면 순서는 그대로다.
_SORT_ALIAS = {
    "price": "price {d} NULLS LAST, addr",
    "roi": "roi_est {d} NULLS LAST, price {d} NULLS LAST",
}

_ECHO: dict[str, str] = {
    "land_area_min": "land_area", "land_area_max": "land_area",
    "total_area_min": "total_area", "total_area_max": "total_area",
    "build_area_min": "build_area", "build_area_max": "build_area",
    "far_area_min": "far_area", "far_area_max": "far_area",
    "parcel_area_min": "parcel_area", "parcel_area_max": "parcel_area",
    "floors_above_min": "floors_above", "floors_above_max": "floors_above",
    "floors_below_min": "floors_below", "floors_below_max": "floors_below",
    "elevator_min": "elevator", "elevator_max": "elevator",
    "parking_min": "parking", "parking_max": "parking",
    "station_dist_max": "station_dist",
    "age_min": "approval_ymd", "age_max": "approval_ymd",
    "remodel_years_min": "remodel_ymd", "remodel_years_max": "remodel_ymd",
    "bcr_min": "bcr", "bcr_max": "bcr", "far_min": "far", "far_max": "far",
    "legal_bcr_min": "legal_bcr", "legal_bcr_max": "legal_bcr",
    "legal_far_min": "legal_far", "legal_far_max": "legal_far",
    "bcr_slack_min": "bcr_slack", "bcr_slack_max": "bcr_slack",
    "far_slack_min": "far_slack", "far_slack_max": "far_slack",
    "use_zones": "use_zone", "jimoks": "jimok", "land_uses": "land_use",
    "road_frontages": "road_frontage", "shapes": "shape", "slopes": "slope",
    "use": "main_use_name", "main_uses": "main_use_name", "etc_use": "etc_use",
    "gongsi_min": "gongsi_latest", "gongsi_max": "gongsi_latest",
    "gongsi_total_min": "gongsi_total", "gongsi_total_max": "gongsi_total",
    "gongsi_ratio_min": "gongsi_ratio", "gongsi_ratio_max": "gongsi_ratio",
    "gongsi_up5_min": "gongsi_up5", "gongsi_up5_max": "gongsi_up5",
    "gongsi_up10_min": "gongsi_up10", "gongsi_up10_max": "gongsi_up10",
    "value_min": ("team_price AS sale_price", "sale_est", "ask_price"),
    "value_max": ("team_price AS sale_price", "sale_est", "ask_price"),
    "price_min": "team_price AS sale_price", "price_max": "team_price AS sale_price",
    "ask_min": "ask_price", "ask_max": "ask_price",
    "sell_vagues": "sell_vague",
    "sale_est_min": "sale_est", "sale_est_max": "sale_est",
    "roi_min": "roi", "roi_max": "roi",
    "roi_est_min": "roi_est", "roi_est_max": "roi_est",
    "rent_est_min": "rent_est_m", "rent_est_max": "rent_est_m",
    "deposit_est_min": "deposit_est", "deposit_est_max": "deposit_est",
    "rent_total_min": "rent_total", "rent_total_max": "rent_total",
    "deposit_total_min": "deposit_total", "deposit_total_max": "deposit_total",
    "mgmt_total_min": "mgmt_total", "mgmt_total_max": "mgmt_total",
    "pp_land_min": "pp_land", "pp_land_max": "pp_land",
    "pp_total_min": "pp_total", "pp_total_max": "pp_total",
    "pp_land_team_min": "pp_land_team", "pp_land_team_max": "pp_land_team",
    "pp_total_team_min": "pp_total_team", "pp_total_team_max": "pp_total_team",
    "gongsi_ratio_team_min": "gongsi_ratio_team", "gongsi_ratio_team_max": "gongsi_ratio_team",
    "sale_pnl_min": "sale_pnl", "sale_pnl_max": "sale_pnl",
    "sale_count_min": "sale_cnt", "sale_count_max": "sale_cnt",
    "last_sale_min": "last_sale_price", "last_sale_max": "last_sale_price",
    "last_sale_years_min": "last_sale_ym", "last_sale_years_max": "last_sale_ym",
    "pop_day_min": "float_pop", "pop_day_max": "float_pop",
    "road_front_min": "road_front", "road_front_max": "road_front",
    "regulations": "reg_names",
    "vacant": "vacant_area",
    "vacant_area_min": "vacant_area", "vacant_area_max": "vacant_area",
    # 만실 월임대는 조건이 없고 만실 수익률에 딸려 나간다. full_est 는 이름을 가르는 데 쓴다
    "roi_full_min": ("roi_full", "rent_full", "full_est"), "roi_full_max": ("roi_full", "rent_full", "full_est"),
    "urgencies": "urgency", "owner_types": "owner_type", "relations": "relation",
    "cooperations": "cooperation", "kindnesses": "kindness", "meongdos": "meongdo",
    "use_changes": "use_change", "myeolsils": "myeolsil",
    "assignees": "assignee_account_id", "owner_name": "owner_name",
    "listing_no": "listing_no", "intent": "intent", "received_from": "received_on",
    "received_to": "received_on", "has_photo": "has_photo",
}
# fields 로 고를 수 있는 칸 — 되비칠 수 있는 것 전부 + 늘 나가는 것
_FIELDS_OK = ({c.split(" AS ")[0] for v in _ECHO.values() for c in (v if isinstance(v, tuple) else (v,))}
              | {"lng", "lat", "col", "price_is_est", "owner_phone", "grade", "ipji",
                 "building_major", "building_use", "price_vs_market", "nohudo", "est_annual_rent"}
              # 조회 대장에만 있던 넷. 조건으로는 못 걸고 **보기만** 한다(2026-09-21).
              | {"structure", "height", "road_addr", "bjd_code"}
              # 측면·후면 도로폭은 조건은 없고 보기만(2026-09-22). 전면은 조건이 된다
              | {"road_side", "road_rear"}
              # 야간 유동인구 — 모델은 「유동인구」 한 이름으로 주간·야간을 같이 받는다(names.DROP 에도)
              | {"float_pop_night"})
# road_score·station_score 는 뺐다(2026-09-19). 적정가 산식이 쓰는 내부 점수표라 화면에도 안 나오고,
# 안쪽 질의에만 있고 바깥 SELECT 에 없어서 fields 로 부르면 UndefinedColumnError 로 죽었다.


def _row_cols(body: "SearchIn") -> tuple[list[str], list[str]]:
    """이 요청의 줄 칸 = 기본 + 건 조건의 값 + fields 로 고른 것. 반환 (칸, 모르는 이름).

    fields 는 **너그럽게 받는다**(2026-09-18 실측). 모델이 `addr`(이미 늘 나가는 칸)이나
    `main_uses`(칸 이름이 아니라 필터 이름)를 적어 422 가 났고, 오류가 후보를 들고 오니
    다음 바퀴에 고치긴 했지만 한 바퀴를 버렸다. 이미 있는 칸이면 조용히 넘기고,
    필터 이름이면 그 필터가 되비치는 칸으로 바꾼다. 그래도 모르면 그때 말한다."""
    cols = list(_BASE_COLS)
    seen = {c.split(" AS ")[-1] for c in cols}
    f = body.filters
    for name, col in _ECHO.items():
        if getattr(f, name, None) in (None, [], ""):
            continue
        for c in (col if isinstance(col, tuple) else (col,)):   # 값 필터 하나가 열 넷을 되비친다
            alias = c.split(" AS ")[-1]
            if alias not in seen:
                cols.append(c); seen.add(alias)
    unknown: list[str] = []
    for name in (body.fields or []):
        if name in seen:                                           # 이미 나가는 칸 — 조용히 넘긴다
            continue
        col = name if name in _FIELDS_OK else _ECHO.get(name)      # 필터 이름으로 적었으면 그 칸으로
        if col is None:
            unknown.append(name); continue
        # value_min 처럼 되비침이 여러 칸인 필터 이름을 fields 에 적으면 튜플이 온다(2026-09-19 실측 AttributeError)
        for c in (col if isinstance(col, tuple) else (col,)):
            alias = c.split(" AS ")[-1]
            if alias not in seen:
                cols.append(c); seen.add(alias)
    # 만실 값이 나가면 **추정이 섞였는지**도 같이 나가야 한다(0181). 안 그러면 추정값이 실측
    # 이름으로 나간다 — 모델은 칸만 달라고 하고 조건은 안 거는 일이 흔하다
    if ({"rent_full", "roi_full"} & seen) and "full_est" not in seen:
        cols.append("full_est"); seen.add("full_est")
    return cols, unknown


# ── 나대지 ──────────────────────────────────────────────────────────────────
#
# **나대지 = 지목이 「대」이고 건물이 안 붙은 필지.** 서울 107,432개.
#
# `master.vacant_parcels` 는 지목을 안 거른 「건물 없는 필지 전부」라 332,025개이고 그 42%가
# 도로, 4.4%가 하천·구거다. 신축을 볼 때 그것들은 보지 않는다(2026-09-20 확인). 그래서
# 여기서 「대」로 좁힌다 — 자료가 넓은 것이지 낱말이 넓은 게 아니다.
#
# 자동완성에는 진작 떴는데
# **검색에는 없었다** — 「종로구에 100평 넘는 빈 땅」을 아예 못 물었다(2026-09-20).
#
# 칸 열넷이 전부 건물 조건에 이미 있는 것이라 조건을 새로 파지 않는다. 대신 **건물에만 있는
# 조건을 걸면 짚어 준다** — 조용히 0을 내면 「그런 땅이 없다」로 읽힌다.
_VACANT_COL: dict[str, str] = {
    # 나대지 하나를 집는 길. 건물의 `building_pk` 에 해당한다 — 없으면 검색이
    # `building` 조회를 대신할 수 없다(2026-09-21).
    "pnu": "v.pnu = ANY({}::text[])",
    "addr": "master.dong_jibun(v.addr) = {}",     # 실제 SQL 은 위 루프가 _addr_cond 로 바꾼다
    "land_area_min": "v.area >= {}", "land_area_max": "v.area <= {}",
    "parcel_area_min": "v.area >= {}", "parcel_area_max": "v.area <= {}",
    "gongsi_min": "v.gongsi_latest >= {}", "gongsi_max": "v.gongsi_latest <= {}",
}
_VACANT_ANY: dict[str, str] = {
    "jimoks": "v.jimok", "land_uses": "v.land_use", "use_zones": "v.use_zone",
    "slopes": "v.slope", "shapes": "v.shape", "road_frontages": "v.road_frontage",
}
# 나대지 줄에 낼 수 있는 칸. **건물 칸 이름 → 나대지 표의 칸**이다 — 들어오는 fields 가
# 이미 건물 영문명으로 바뀐 채 오고(_FIELDS_MODEL), 나가는 이름도 건물과 같아야 한다.
_VACANT_FIELDS: dict[str, str] = {
    "land_area": "area AS land_area", "parcel_area": "area AS parcel_area",
    "jimok": "jimok", "land_use": "land_use", "use_zone": "use_zone",
    "slope": "slope", "shape": "shape", "road_frontage": "road_frontage",
    "gongsi_latest": "gongsi_latest", "legal_bcr": "legal_bcr", "legal_far": "legal_far",
}


async def search_vacant(body: SearchIn, user: CurrentUser) -> dict:
    """나대지 목록. 건물 검색과 **같은 모양**을 돌려준다 — `내매물` 은 늘 비어 있다
    (나대지는 매물로 등록되지 않는다). 모양이 갈리면 모델이 두 벌을 외워야 한다."""
    f = body.filters
    args: list = []
    where: list[str] = ["v.jimok = '대'"]      # 나대지의 뜻 그대로
    matched: list[str] = []

    def add(cond: str, val) -> None:
        args.append(val)
        where.append(cond.format(len(args)))

    if f.region and not f.bjd_code:
        ors = []
        for w in (f.region if isinstance(f.region, list) else [f.region])[:10]:
            code, name = resolve_region(w)
            args.append(code)
            ors.append(f"v.bjd_code LIKE ${len(args)} || '%'")
            matched.append(name)
        if ors:
            where.append("(" + " OR ".join(ors) + ")")
    if f.bjd_code:
        add("v.bjd_code LIKE ${} || '%'", _check_bjd(f.bjd_code))

    for name, col in _VACANT_ANY.items():
        vals = getattr(f, name, None)
        if vals:
            _check_enum(name, vals)
            add(f"{col} = ANY(${{}})", vals)
    for name, tmpl in _VACANT_COL.items():
        v = getattr(f, name, None)
        if v is not None:
            if name == "pnu" and isinstance(v, str):
                v = [v]                       # 하나를 줘도 목록으로 건다
            if name == "addr":                # 지번 열쇠로 다듬고, 산 지번은 주소 전체로
                v = _jibun_key(v); tmpl = _addr_cond("v.addr", v).replace("${i}", "{}")
            add(tmpl.replace("{}", "${}"), v)
    for fname, vals in (f.nots or {}).items():
        col = _VACANT_ANY.get(fname)
        if col and vals:
            add(f"({col} IS NULL OR NOT ({col} = ANY(${{}})))", list(vals))

    ws = " WHERE " + " AND ".join(where)
    # 좌표는 늘 뽑는다(2026-09-21). 모델용 답에서는 걷히고(names.DROP) 화면 지도 핀에만 쓴다.
    cols = ["v.pnu", "v.addr",
            "ST_X(ST_PointOnSurface(v.geom)) AS lng", "ST_Y(ST_PointOnSurface(v.geom)) AS lat"] \
           + sorted({f"v.{_VACANT_FIELDS[x]}"
                     for x in (body.fields or []) if x in _VACANT_FIELDS})
    srt = (_VACANT_FIELDS.get(body.sort) or "area").split(" AS ")[0]
    order = f"v.{srt} {'ASC' if body.sort_asc else 'DESC'} NULLS LAST, v.pnu"
    rows, total = await asyncio.gather(
        # DISTINCT 를 안 쓴다 — pnu 가 유일키고, 쓰면 ORDER BY 칸을 SELECT 에 다 실어야 한다
        pool().fetch(f"SELECT {', '.join(cols)} FROM master.vacant_parcels v{ws}"
                     f" ORDER BY {order} LIMIT {body.per_page}", *args),
        pool().fetchval(f"SELECT count(*) FROM master.vacant_parcels v{ws}", *args),
    )
    out = {"mine": {"items": [], "total": 0, "page": 1, "pages": 1},
           "normal": {"items": [dict(r) for r in rows], "total": total, "page": 1,
                      "pages": max(1, -(-total // body.per_page))}}
    if matched:
        out["matched"] = matched
    return out


def _with_match(body: SearchIn, out: dict) -> dict:
    """이름으로 받은 지역을 **무엇으로 읽었는지 응답이 말한다**(2026-09-09).
    서버가 조용히 고르면 그게 거짓말이다 — 골랐으면 골랐다고 밝힌다."""
    got = getattr(body.filters, "__dict__", {}).get("_matched") or []
    if got:
        out["matched"] = got
    meta = getattr(body.filters, "__dict__", {}).get("_biz_meta")
    if meta:
        out["biz"] = meta      # 낱말별 카카오 건수·건물 동수 — 무엇으로 걸렀는지 답이 말한다
    nm = getattr(body.filters, "__dict__", {}).get("_biz_names")
    if nm:
        # 낱말별 {건물: [상호명]} — 모델 응답이 줄에 접어 낸다. 화면은 안 읽는다.
        out["biz_names"] = nm
    return out


@router.post("", openapi_extra={"x-ai": "read"})   # AI 가 부를 수 있다(10-AI §3-3). 화면과 같은 답
async def search(body: SearchIn, user: CurrentUser = Depends(any_user)):
    """2열 목록(내매물/일반) + 열별 독립 페이징.

    분류(§3.4·상태 종속): 내매물 = 팀 담당자 지정 · 일반 = 나머지.
    매매가(§3.5): 내매물=팀 수기 sale_price / 일반=NULL(후순위).
    """
    await load_guards()          # 막이 목록(있는 지역 코드)을 처음 쓸 때 채운다
    if body.target == "vacant":  # 나대지는 표가 다르다. 모양은 같게 돌려준다
        return await search_vacant(body, user)
    await resolve_biz(body)      # 업종·상호 → 카카오 → pk 집합(동기 _filter_sql 앞에서)
    # 별칭 둘은 화면 것. 그 밖엔 **칸 이름**으로 세운다 — 모델이 「주차 넓은 순」을 걸 수 있어야
    # 임의 문턱(`주차대수_이상: 5`)을 안 만든다. 칸 이름은 _FIELDS_OK 를 거친 것만 들어오므로
    # 바깥 글자가 SQL 에 닿지 않는다. NULLS LAST 는 필수다 — 팀 칸은 대개 비어 있다.
    d = "ASC" if body.sort_asc else "DESC"
    if body.sort in _SORT_ALIAS:
        order = _SORT_ALIAS[body.sort].format(d=d)
    elif body.sort in _FIELDS_OK:
        order = f"{body.sort} {d} NULLS LAST, building_pk"
    elif body.for_model:
        # 모델 층은 이름을 다 검사해서 보내므로 여기 오면 우리 표가 어긋난 것이다.
        # 조용히 기본으로 떨어뜨리면 「오름차순」이 내림차순으로 나가도 아무도 모른다.
        raise HTTPException(422, f"정렬 칸을 모른다: {body.sort}")
    else:
        order = _SORT_ALIAS["price"].format(d=d)

    cols, bad = _row_cols(body)
    if bad:
        # **오류가 답을 들고 온다** — 무엇을 고를 수 있는지 같이 말한다
        raise HTTPException(422, f"fields 에 없는 칸: {bad}. 고를 수 있는 칸: {sorted(_FIELDS_OK)}")
    # 업종은 통과 여부가 아니라 **개수**로 낸다 — 「병원 3곳 이상」을 걸었으면 몇 곳인지 말해야
    # 「5곳이라 이미 검증된 건물」이라고 쓸 수 있다. resolve_biz 가 세어 둔 것을 줄에 붙인다.
    biz_n: dict[str, int] = body.filters.__dict__.get("_biz_n") or {}

    async def column(name: str, page: int):
        # 열 조건을 raw WHERE로 내려 그 열에 속한 행만 만든다(내매물 0건 팀은 즉시 종료).
        base, args, outer_sql = _build_base(body, user, col=name)
        off = (page - 1) * body.per_page
        # count(*) OVER() 윈도우는 LIMIT 최적화를 막아 구 전체(2.4만+)에서 30s+ 행업(플래너가
        # 전 행 계산·nested-loop 폭발). rows(LIMIT)와 total(경량 count)을 분리하면 ~5s.
        rows, total = await asyncio.gather(
            pool().fetch(
                base + f"""SELECT {", ".join(cols)} FROM classified
                           WHERE col = '{name}' {outer_sql} ORDER BY {order}
                           LIMIT {body.per_page} OFFSET {off}""",
                *args),
            pool().fetchval(
                base + f"SELECT count(*) FROM classified WHERE col = '{name}' {outer_sql}",
                *args),
        )
        items = [dict(r) for r in rows]
        # 규제는 줄마다 열 개쯤 붙고 절반은 서울 전역 공통(허가구역·과밀억제권역)이라, 걸었을 땐
        # **건 값만** 되비친다. 전부는 「필지」 묶음이 준다.
        if body.filters.regulations:
            asked = set(body.filters.regulations)
            for it in items:
                if it.get("reg_names") is not None:
                    it["reg_names"] = [x for x in it["reg_names"] if x in asked]
        elif body.filters.nots and "regulations" in body.filters.nots:
            for it in items:                      # 「없음」만 걸었으면 되비칠 값이 없다 — 빈 칸은 안 나간다
                it.pop("reg_names", None)
        if biz_n:
            for it in items:
                it["biz_n"] = biz_n.get(it["building_pk"], 0)
        return {"items": items, "total": total, "page": page,
                "pages": max(1, -(-total // body.per_page))}

    # 내 매물만 — 지역·영역이 없으면 '일반' 열은 서울 전체가 되어 의미도 없고 느리다.
    # 담당자 있는 행만 훑으므로(listings_claim 부분 인덱스) 범위 조건 없이도 가볍다.
    _empty = {"items": [], "total": 0, "page": 1, "pages": 1}
    if body.mine_only or body.only == "mine":
        return {"mine": await column("mine", body.page_mine), "normal": _empty}
    if body.only == "normal":      # 모델의 `범위:"일반"` — 「내 매물 아닌 것 중에」
        return {"mine": _empty, "normal": await column("normal", body.page_normal)}

    # 두 열은 서로 독립 — 순차로 돌면 합계만큼 기다린다(구 단위 실측 합 0.83s → 최댓값 0.62s).
    mine, normal = await asyncio.gather(
        column("mine", body.page_mine), column("normal", body.page_normal))
    return _with_match(body, {"mine": mine, "normal": normal})


@router.post("/count")
async def count_only(body: SearchIn, user: CurrentUser = Depends(any_user)):
    """조건에 맞는 건수만(2026-08-27) — 필터 창이 닫기 전에 결과 크기를 말하려고 쓴다.

    목록 조회는 두 열을 각각 페이징하고 값도 많이 실어 구 단위에서 초가 걸린다.
    여기서는 building_pk 하나만 세므로 같은 조건이라도 훨씬 가볍다."""
    await load_guards()
    await resolve_biz(body)
    base, args, outer_sql = _build_base(body, user, col="mine" if body.mine_only else None)
    n = await pool().fetchval(
        base + f"SELECT count(*) FROM classified WHERE TRUE {outer_sql}", *args)
    return {"total": int(n or 0)}


@router.post("/pins")
async def pins(body: SearchIn, user: CurrentUser = Depends(any_user)):
    """지도 핀 — 페이징 없이 조건에 맞는 매물(경량: 좌표·분류·가격).
    프론트가 뷰포트 컬링(화면 안 핀만 렌더)하므로 넉넉히 반환하되, 3000개 상한(응답 크기·극단 방지).
    가격 있는 매물 우선(NULLS LAST) → 상한에 걸려도 유의미한 핀부터."""
    await load_guards()
    await resolve_biz(body)
    base, args, outer_sql = _build_base(body, user, col="mine" if body.mine_only else None)
    rows = await pool().fetch(
        base + f"""SELECT building_pk, addr, lng, lat, col, price, roi,
                         price_is_est, roi_est,   -- 추정 짝·실측 짝을 가르는 재료(0134)
                         last_sale_price, sale_est,
                         -- 지도에서 실거래를 총액·단가로 견주는 데 쓴다(밸류맵식).
                         -- 단가는 대지면적이 기본이고 연면적은 토글이라 둘 다 내려보낸다.
                         last_sale_ym, land_area, total_area,
                         kind, ad_n, ad_price_min     -- 광고(0191)
                  FROM classified WHERE lng IS NOT NULL {outer_sql}
                  ORDER BY (kind IN ('mine','ad')) DESC, price DESC NULLS LAST, building_pk LIMIT 3000""",
        *args,
    )
    return [dict(r) for r in rows]
