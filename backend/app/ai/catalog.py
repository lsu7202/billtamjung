"""건물 조회 이름 사전 — **이름 하나에 선언 한 줄**(11b 근본 정리, 2026-10-04 대표 승인).

전엔 이름 하나가 표 다섯 장(names.KO · _FILTER_RANGE/PLAIN · search._ECHO · _FIELDS_OK · _ENUM_OF)에
흩어져 있었고 값 목록은 손으로 적었다. 그래서 사진/사진있음이 겹치고, 소유자가 목록 갈래로 나가고,
초과 값이 줄에 안 실리고, 고객 출처 값을 지어내는 일이 생겼다. 이제 이 표 한 장에서 전부 나온다:

    스키마(모드별) · 조건 → Filters 옮기기 · 줄에 실을 칸 · 정렬 · 모드 열림 · 11c 문서

**값 목록은 여기 적지 않는다.** 정본에서 읽는다(V_* 표시): ref.enums · 사무소 상태 사전 · 팀원 · 저장조건 ·
master.region_index. 고정 값은 칸이 불리언이라 뜻이 정해진 것(있음/없음 · 전속/일반)뿐이다.

갈래
  수      {"이상", "이하"}           lo/hi = Filters 칸(한쪽만 있을 수 있다)
  날짜    {"이후", "이전"}           YYYY-MM-DD
  목록    {"값": [...], "없음": [...]}   값 중 하나라도 · 「없음」은 그 값이 아닌 것(NULL 은 남긴다)
  하나    {"값": "…"}                값 하나(불리언 · 단일값 칸)
  글      {"값": "…"}                부분일치
  보기만  {}                         거르지 않고 줄에 싣는다
  묶음    {} 또는 {손잡이…}            줄마다 목록을 붙인다
열림
  public  누구나 · team  중개사만, 내매물 줄에만 · broker  중개사만(네이버 · 크롤링)
"""
from __future__ import annotations

import difflib
from dataclasses import dataclass, field
from typing import Any

from ..core.db import pool
from ..core.deps import CurrentUser
from ..domains.search import _NOT_COL

# 값의 정본
def V_ENUM(key: str) -> tuple:  # noqa: N802 — 표에서 읽기 쉽게
    return ("enum", key)


V_STATUS = ("team", "statuses")      # 그 사무소의 매물 상태 이름
V_MEMBER = ("team", "members")       # 그 사무소 팀원 이름
V_YESNO = ("fixed", ("있음", "없음"))
V_EXCL = ("fixed", ("전속", "일반"))  # listings.exclusive 불리언
V_TARGET = ("fixed", ("건물", "나대지"))
V_SCOPE = ("scope", None)             # 매물 범위 — 중개사 「내 매물 · 매물 · 전체」, 고객 「매물 · 전체」


@dataclass(frozen=True)
class Name:
    ko: str
    kind: str                         # 수 · 날짜 · 목록 · 하나 · 글 · 보기만 · 묶음 · 어디
    lo: str | None = None             # 수 · 날짜: 아래쪽 Filters 칸 / 목록 · 하나 · 글 · 어디: 그 Filters 칸
    hi: str | None = None             # 수 · 날짜: 위쪽 Filters 칸
    col: str | None = None            # 줄에 실리는 칸(search classified 별칭)
    unit: str = ""
    values: tuple | None = None       # 값의 정본(V_*). None = 자유
    scope: str = "public"             # public · team · broker
    desc: str = ""
    dnf: bool = False                 # 안쪽 「그리고」가 뜻을 갖는가(주용도 · 입주업체)
    sort: bool = True                 # 정렬로 세울 수 있나
    age: bool = False                 # 나이 이름 — 날짜 칸을 거꾸로 읽는다(연식 내림차순 = 오래된 것부터)
    knobs: dict = field(default_factory=dict)   # 묶음 손잡이 이름 → JSON 형


N = Name
_INT = {"type": "integer"}

TABLE: tuple[Name, ...] = (
    # ── 어디 · 대상 ──
    N("대상", "어디", values=V_TARGET, sort=False,
      desc="이 조건이 무엇을 찾나. 안 주면 건물. 나대지는 지목이 「대」이고 건물이 안 붙은 필지다. 연면적·층수·주용도·입주업체·매매가를 못 건다"),
    N("매물", "어디", values=V_SCOPE, sort=False,
      desc="어느 줄까지 볼지. 안 주면 「매물」(보이는 매물 전부 · 매물마다 한 줄). 「내 매물」은 내 사무소 매물만. 「전체」는 매물이 아닌 건물까지 — 어디(지역 · 주소)가 있어야 한다"),
    N("지역", "어디", lo="region", sort=False,
      desc="지역 이름. 구부터 고른다(「종로구」). 여럿이면 목록([「성수동1가」, 「성수동2가」])"),
    N("법정동코드", "어디", lo="bjd_code", col="bjd_code", desc="법정동 코드(구 5자리 · 동 10자리)"),
    N("주소", "어디", lo="addr", sort=False,
      desc="한 채를 짚는다. 지번(「종로구 누상동 94」)이나 도로명(「필운대로5가길 53」). 같은 지번의 건물이 여럿이면 다 나온다 — 주용도 · 연면적 같은 조건을 더 걸어 좁힌다"),
    # ── 건물 · 땅(공개) ──
    N("대지면적", "수", "land_area_min", "land_area_max", "land_area", "㎡"),
    N("필지면적", "수", "parcel_area_min", "parcel_area_max", "parcel_area", "㎡"),
    N("연면적", "수", "total_area_min", "total_area_max", "total_area", "㎡"),
    N("건축면적", "수", "build_area_min", "build_area_max", "build_area", "㎡"),
    N("용적산정연면적", "수", "far_area_min", "far_area_max", "far_area", "㎡"),
    N("지상층수", "수", "floors_above_min", "floors_above_max", "floors_above", "층"),
    N("지하층수", "수", "floors_below_min", "floors_below_max", "floors_below", "층"),
    N("높이", "보기만", col="height", unit="m"),
    N("구조", "보기만", col="structure"),
    N("건폐율", "수", "bcr_min", "bcr_max", "bcr", "%", desc="대장"),
    N("용적률", "수", "far_min", "far_max", "far", "%", desc="대장"),
    N("법정건폐율", "수", "legal_bcr_min", "legal_bcr_max", "legal_bcr", "%",
      desc="필지 원장에서 토지이음 산식으로 낸 법정치. 용도지역으로 어림하지 말고 이 값을 본다"),
    N("법정용적률", "수", "legal_far_min", "legal_far_max", "legal_far", "%",
      desc="필지 원장에서 토지이음 산식으로 낸 법정치. 용도지역으로 어림하지 말고 이 값을 본다"),
    N("건폐여유", "수", "bcr_slack_min", "bcr_slack_max", "bcr_slack", "%", desc="법정 − 현재, 0에서 끊음. 클수록 더 지을 수 있다"),
    N("용적여유", "수", "far_slack_min", "far_slack_max", "far_slack", "%", desc="법정 − 현재, 0에서 끊음. 클수록 더 지을 수 있다"),
    N("건폐초과", "수", "bcr_over_min", "bcr_over_max", "bcr_over", "%", desc="현재 − 법정. +면 법정보다 넘게 지어져 있다"),
    N("용적초과", "수", "far_over_min", "far_over_max", "far_over", "%", desc="현재 − 법정. +면 법정보다 넘게 지어져 있다"),
    N("승강기", "수", "elevator_min", "elevator_max", "elevator", "대"),
    N("주차대수", "수", "parking_min", "parking_max", "parking", "대"),
    N("연식", "수", "age_min", "age_max", "approval_ymd", "년", age=True,
      desc="사용승인 뒤 지난 햇수. 걸면 줄엔 「사용승인일」이 실린다"),
    N("사용승인일", "보기만", col="approval_ymd"),
    N("리모델링경과", "수", "remodel_years_min", "remodel_years_max", "remodel_ymd", "년", age=True,
      desc="리모델링 뒤 지난 햇수. 기록이 없는 건물은 안 걸린다. 걸면 줄엔 「리모델링일」이 실린다"),
    N("리모델링일", "보기만", col="remodel_ymd"),
    N("역거리", "수", None, "station_dist_max", "station_dist", "m", desc="가까운 지하철역까지"),
    N("전면도로폭", "수", "road_front_min", "road_front_max", "road_front", "m", desc="실측"),
    N("측면도로폭", "보기만", col="road_side", unit="m", desc="실측"),
    N("후면도로폭", "보기만", col="road_rear", unit="m", desc="실측"),
    N("용도지역", "목록", "use_zones", col="use_zone", values=V_ENUM("use_zone")),
    N("지목", "목록", "jimoks", col="jimok", values=V_ENUM("jimok"),
      desc="안 걸면 공원·도로·하천·제방·구거·유지·철도용지·묘지·수도용지·사적지는 뺀다(팔 수 없는 땅). 보려면 여기에 건다"),
    N("도로접면", "목록", "road_frontages", col="road_frontage", values=V_ENUM("road_frontage"),
      desc="대장 분류. 광대 25m 이상 · 중로 12~25 · 소로 8~12 · 세로 8 미만, 각지=두 면 접함. 실측 m 는 「전면도로폭」"),
    N("지형형상", "목록", "shapes", col="shape", values=V_ENUM("shape")),
    N("지세", "목록", "slopes", col="slope", values=V_ENUM("slope")),
    N("토지이용", "보기만", col="land_use"),
    N("규제", "목록", "regulations", col="reg_names",
      desc="토지이용계획확인서 이름 그대로(지구단위계획구역 · 정비구역 · 재정비촉진지구 · 개발제한구역 · 역사문화환경보존지역 · "
           "상대보호구역 · 가로구역별 최고높이 제한지역 · 건축허가·착공제한지역 등 311가지). 필지 하나라도 걸리면. 모르는 이름이면 가까운 이름을 알려 준다"),
    N("주용도", "목록", "use", col="main_use_name", dnf=True,
      desc="건축물대장 주용도 부분일치. 허가 받을 때 당시 용도라 지금과 다를 수 있다. 지금 든 업체는 「입주업체」. 「근린생활시설」이면 제1종·제2종이 다 걸린다"),
    N("기타용도", "보기만", col="etc_use"),
    N("입주업체", "목록", "biz_dnf", dnf=True, sort=False,
      desc="지금 실제로 들어와 있는 업체. 업체 이름이나 업종 낱말(병원 · 카페 · 스타벅스). 「병원」이면 피부과 · 치과까지 걸린다. 값이 꼭 있어야 한다"),
    N("매물유형", "목록", "kinds", col="listing_kind", values=V_ENUM("building_major"),
      desc="팀이 고른 대분류, 없으면 네이버 매물 유형. 매물이 아니거나 유형을 안 골랐으면 비어 있다. 실거래 유형과 다른 값이다"),
    N("도로명주소", "보기만", col="road_addr"),
    N("유동인구", "보기만", col="float_pop", sort=False, unit="명/일",
      desc="주간 · 야간 두 수(생활인구 250m 격자 2주 평균). 조건 · 정렬은 없다"),
    # ── 공시 · 실거래(공개) ──
    N("공시지가", "수", "gongsi_min", "gongsi_max", "gongsi_latest", "원/㎡"),
    N("공시총액", "수", "gongsi_total_min", "gongsi_total_max", "gongsi_total", "원", desc="㎡단가 × 대지"),
    N("공시5년상승", "수", "gongsi_up5_min", "gongsi_up5_max", "gongsi_up5", "%"),
    N("공시10년상승", "수", "gongsi_up10_min", "gongsi_up10_max", "gongsi_up10", "%"),
    N("최근실거래가", "보기만", col="last_sale_price", unit="원"),
    N("최근실거래월", "보기만", col="last_sale_ym"),
    N("실거래경과", "수", "last_sale_years_min", "last_sale_years_max", "last_sale_ym", "년", age=True,
      desc="최근 실거래 뒤 지난 햇수. 걸면 줄엔 「최근실거래월」이 실린다"),
    N("실거래등락", "수", "sale_pnl_min", "sale_pnl_max", "sale_pnl", "%", desc="최근 실거래 ÷ 직전"),
    N("실거래횟수", "수", "sale_count_min", "sale_count_max", "sale_cnt", "건"),
    # ── 매매가(0226) — 매물 하나에 하나. 줄의 뼈대(주인 · 주소 · 매매가)에 늘 실린다 ──
    N("매매가", "수", "price_min", "price_max", "price", "원",
      desc="그 매물의 매매가로 건다. 추정가는 매매가가 아니다 — 「추정가」로 따로 건다. 지난 실거래가도 아니다"),
    N("평단가대지", "수", "pp_land_sale_min", "pp_land_sale_max", "pp_land_sale", "원/평", desc="매매가 ÷ 대지"),
    N("평단가연면적", "수", "pp_total_sale_min", "pp_total_sale_max", "pp_total_sale", "원/평", desc="매매가 ÷ 연면적"),
    N("공시비율", "수", "gongsi_ratio_sale_min", "gongsi_ratio_sale_max", "gongsi_ratio_sale", "%", desc="공시총액 ÷ 매매가"),
    N("추정가", "수", "sale_est_min", "sale_est_max", "sale_est", "원",
      desc="빌탐정 추정 · 매매가가 아니다. **사람이 추정가를 물을 때만** 부른다(평단가 · 공시비율 함께)"),
    # ── 임대료 — 실제 값(내 매물 임대 · 네이버 임대시세) ──
    N("임대료", "수", "rent_ppm_min", "rent_ppm_max", None, "원/㎡", scope="broker", sort=False,
      desc="㎡당 월세로 건다 — 내 매물 층별 실제 임대료 · 네이버 임대시세 가운데 하나라도 범위면. "
           "줄엔 임대료 목록(출처 · 범위(건물 전체 · 층) · 보증금 · 월세 · ㎡당월세)이 실린다."),
    # ── 팀이 적은 값(중개사만 · 내매물 줄에만) ──
    N("매물번호", "글", "listing_no", col="listing_no", scope="team"),
    N("담당자", "목록", "assignees", col="assignee_account_id", values=V_MEMBER, scope="team", desc="팀원 이름"),
    N("접수일", "날짜", "received_from", "received_to", "received_on", scope="team"),
    N("상태", "목록", "statuses", col="status_name", values=V_STATUS, scope="team", desc="사무소가 만든 매물 상태"),
    N("보류사유", "목록", "hold_reasons", col="hold_reason", values=V_ENUM("hold_reason_listing"), scope="team"),
    N("매각일", "보기만", col="sold_on", scope="team"),
    N("매각금액", "보기만", col="sold_price", unit="원", scope="team"),
    N("전속", "목록", "exclusive", col="exclusive_word", values=V_EXCL, scope="team"),
    N("확인일", "날짜", "checked_from", "checked_to", "checked_on", scope="team", desc="마지막으로 확인한 날"),
    N("매도희망가", "수", "ask_min", "ask_max", "ask_price", "원", scope="team", desc="건물주가 부른 값. 매매가가 아니다"),
    N("수익률", "수", "roi_min", "roi_max", "roi", "%", scope="team",
      desc="총월임대 × 12 ÷ 매매가. 내 매물에 총월임대와 매매가가 있어야 선다"),
    N("만실수익률", "수", "roi_full_min", "roi_full_max", "roi_full", "%", scope="team",
      desc="공실이 다 찼다고 가정. 공실 층은 같은 층 실제 임대료 평당가로 채운다"),
    N("만실월임대", "보기만", col="rent_full", unit="원", scope="team"),
    N("총월임대", "수", "rent_total_min", "rent_total_max", "rent_total", "원", scope="team"),
    N("총보증금", "수", "deposit_total_min", "deposit_total_max", "deposit_total", "원", scope="team"),
    N("총관리비", "수", "mgmt_total_min", "mgmt_total_max", "mgmt_total", "원", scope="team"),
    N("공실면적", "수", "vacant_area_min", "vacant_area_max", "vacant_area", "㎡", scope="team"),
    N("공실", "하나", "vacant", col="vacant_area", values=V_YESNO, scope="team", desc="층마다 공실면적을 적은 매물에만 뜻이 있다"),
    N("급함", "목록", "urgencies", col="urgency", values=V_ENUM("urgency"), scope="team"),
    N("매도의사", "하나", "intent", col="intent", values=V_ENUM("intent"), scope="team"),
    N("매도시점", "목록", "sell_vagues", col="sell_vague", values=V_ENUM("sell_vague"), scope="team"),
    N("명도", "목록", "meongdos", col="meongdo", values=V_ENUM("meongdo"), scope="team"),
    N("용도변경", "목록", "use_changes", col="use_change", values=V_ENUM("use_change"), scope="team"),
    N("멸실", "목록", "myeolsils", col="myeolsil", values=V_ENUM("myeolsil"), scope="team"),
    N("등급", "목록", "grades", col="grade", values=V_ENUM("grade"), scope="team"),
    N("입지", "목록", "ipjis", col="ipji", values=V_ENUM("ipji"), scope="team"),
    N("노후도", "목록", "nohudos", col="nohudo", values=V_ENUM("nohudo"), scope="team"),
    N("시세대비", "목록", "price_vs_markets", col="price_vs_market", values=V_ENUM("price_vs_market"), scope="team"),
    N("대분류", "목록", "building_majors", col="building_major", values=V_ENUM("building_major"), scope="team"),
    N("소분류", "목록", "building_uses", col="building_use", values=V_ENUM("building_use"), scope="team"),
    N("융자", "보기만", col="loan", unit="원", scope="team", desc="공개한 것만"),
    N("입주", "보기만", col="move_in", scope="team"),
    N("입주일", "보기만", col="move_in_on", scope="team"),
    N("사진있음", "하나", "has_photo", col="has_photo", values=V_YESNO, scope="team"),
    N("소유자", "글", "owner_name", col="owner_name", scope="team"),
    N("소유자유형", "목록", "owner_types", col="owner_type", values=V_ENUM("owner_type"), scope="team"),
    N("관계", "목록", "relations", col="relation", values=V_ENUM("relation"), scope="team", desc="연락 닿는 사람과 소유자의 관계"),
    N("협조", "목록", "cooperations", col="cooperation", values=V_ENUM("cooperation"), scope="team"),
    N("친절", "목록", "kindnesses", col="kindness", values=V_ENUM("kindness"), scope="team"),
    N("전화있음", "하나", "has_phone", values=V_YESNO, scope="team", sort=False, desc="소유자 전화를 아는가(번호는 안 온다)"),
    # ── 묶음 ──
    N("층별", "묶음", sort=False, desc="층별개요(대장) · 전유부 · 업체"),
    N("필지", "묶음", sort=False),
    N("주변실거래", "묶음", sort=False, knobs={"반경": _INT, "연수": _INT}),
    N("주변매각", "묶음", sort=False, knobs={"반경": _INT}, desc="반경 안 매물당 최근 실거래 1건"),
    N("주변동향", "묶음", sort=False, knobs={"반경": _INT, "연수": _INT, "갈래": {"type": "string", "x-values": "event_kind"}}),
    N("입주이력", "묶음", sort=False),
    N("시간대별유동인구", "묶음", sort=False),
    N("버스정류장", "묶음", sort=False, knobs={"반경": _INT, "줄수": _INT}),
    N("지하철역", "묶음", sort=False, knobs={"반경": _INT, "줄수": _INT}),
    N("공시지가추이", "묶음", sort=False, knobs={"연수": _INT, "줄수": _INT}),
    N("실거래이력", "묶음", sort=False, knobs={"연수": _INT, "줄수": _INT}),
    N("짝", "묶음", sort=False, scope="team", desc="이 매물에 담긴 우리 고객 · 매수희망가 · 채택 · 계약"),
)

BY_KO: dict[str, Name] = {n.ko: n for n in TABLE}
assert len(BY_KO) == len(TABLE), "이름이 겹친다"
# 거는 Filters 칸 → 이름(오류를 이름으로 말하려고)
BY_FILTER: dict[str, str] = {f: n.ko for n in TABLE for f in (n.lo, n.hi) if f}
TEAM_FILTERS = frozenset(f for n in TABLE if n.scope != "public" for f in (n.lo, n.hi) if f)
TEAM_COLS = frozenset(n.col for n in TABLE if n.scope == "team" and n.col) | {"owner_phone"}
WHERE = ("지역", "법정동코드", "주소")


def allowed(ko: str, mode: str) -> bool:
    """이 이름이 이 모드 스키마에 있나. 고객 모드엔 team · broker 이름이 **없다**."""
    n = BY_KO.get(ko)
    return n is not None and (mode == "broker" or n.scope == "public")


def names_for(mode: str) -> list[Name]:
    return [n for n in TABLE if allowed(n.ko, mode)]


def sortable(mode: str) -> dict[str, str]:
    """정렬로 세울 수 있는 이름 → 칸. 「매매가」는 그 매물의 매매가(price)로 세운다 — 매매가 없는 매물은 뒤로(0226)."""
    out = {n.ko: (n.col or "") for n in names_for(mode) if n.sort and n.kind not in ("묶음", "어디") and n.col}
    out["법정동코드"] = "bjd_code"
    return out


# ── 값의 정본 읽기 ──────────────────────────────────────────────
async def context(user: CurrentUser, mode: str) -> dict[str, Any]:
    """스키마를 만드는 데 드는 값 — 전부 정본에서 읽는다. 사무소 · 사람마다 달라진다(상태 · 팀원 · 저장조건)."""
    keys = sorted({n.values[1] for n in TABLE if n.values and n.values[0] == "enum"}
                  | {"buyer_source", "customer_goal", "customer_timing", "customer_experience", "build_intent"})
    enums: dict[str, list[str]] = {}
    for r in await pool().fetch(
            "SELECT enum_key, label FROM ref.enums WHERE active AND enum_key = ANY($1::text[]) ORDER BY enum_key, sort_order", keys):
        enums.setdefault(r["enum_key"], []).append(r["label"])
    ctx: dict[str, Any] = {"mode": mode, "enums": enums,
                           "event_kind": [r["kind"] for r in await pool().fetch(
                               "SELECT kind, count(*) n FROM master.area_event WHERE kind IS NOT NULL GROUP BY 1 ORDER BY n DESC")],
                           "regions": [r["gu"] for r in await pool().fetch(
                               "SELECT gu FROM master.region_index GROUP BY gu ORDER BY gu")]}
    tid = user.team_id if mode == "broker" else None
    ctx["statuses"] = [r["name"] for r in await pool().fetch(
        "SELECT name FROM app.statuses WHERE team_id = $1 ORDER BY sort, id", tid)] if tid else []
    ctx["members"] = [r["name"] for r in await pool().fetch(
        "SELECT a.name FROM app.team_members m JOIN app.accounts a ON a.id = m.account_id"
        " WHERE m.team_id = $1 AND m.left_at IS NULL ORDER BY a.name", tid)] if tid else []
    ctx["saved"] = sorted({r["name"] for r in await pool().fetch(
        """SELECT name FROM app.saved_searches WHERE closed_at IS NULL
             AND (account_id = $1 OR ($2::bigint IS NOT NULL AND team_id = $2 AND buyer_id IS NULL))""",
        user.account_id, tid)})
    return ctx


def values_of(n: Name, ctx: dict) -> list[str] | None:
    if not n.values:
        return None
    src, key = n.values
    if src == "enum":
        return ctx["enums"].get(key) or None
    if src == "team":
        return ctx.get(key) or None
    if src == "fixed":
        return list(key)
    if src == "scope":
        return (["내 매물"] if ctx.get("mode") == "broker" else []) + ["매물", "전체"]
    return None


# ── 스키마 ──────────────────────────────────────────────────────
def _desc(n: Name) -> str:
    return " · ".join(x for x in (n.unit, n.desc) if x)


def schema_props(mode: str, ctx: dict) -> dict[str, dict]:
    props: dict[str, dict] = {}
    for n in names_for(mode):
        vals = values_of(n, ctx)
        s: dict[str, Any]
        if n.kind == "어디":
            if n.ko in ("지역", "법정동코드"):
                s = {"anyOf": [{"type": "string"}, {"type": "array", "items": {"type": "string"}}]}
            elif n.ko == "매물":
                s = {"type": "string", "enum": vals}
            else:
                s = {"type": "string", **({"enum": vals} if vals else {})}
        elif n.kind == "수":
            p = {}
            if n.lo:
                p["이상"] = {"type": "number"}
            if n.hi:
                p["이하"] = {"type": "number"}
            s = {"type": "object", "properties": p}
        elif n.kind == "날짜":
            s = {"type": "object", "properties": {"이후": {"type": "string"}, "이전": {"type": "string"}}}
        elif n.kind == "목록":
            item = {"type": "string", **({"enum": vals} if vals else {})}
            val = ({"anyOf": [{"type": "array", "items": item},
                              {"type": "array", "items": {"type": "array", "items": {"type": "string"}}}]}
                   if n.dnf else {"type": "array", "items": item})
            p = {"값": val}
            if n.lo in _NOT_COL or n.lo == "biz_dnf":      # 「없음」은 거를 칸이 있는 것만
                p["없음"] = {"type": "array", "items": item if not n.dnf else {"type": "string"}}
            s = {"type": "object", "properties": p}
            if n.ko == "입주업체":
                s["required"] = ["값"]
        elif n.kind in ("하나", "글"):
            s = {"type": "object", "properties": {"값": {"type": "string", **({"enum": vals} if vals else {})}}}
        elif n.kind == "묶음":
            kp = {}
            for k, t in n.knobs.items():
                t = dict(t)
                if (vk := t.pop("x-values", None)) and ctx.get(vk):
                    t["enum"] = ctx[vk]
                kp[k] = t
            s = {"type": "object", "properties": kp}
        else:                                       # 보기만
            s = {"type": "object", "properties": {}}
        if (d := _desc(n)):
            s["description"] = d
        props[n.ko] = s
    return props


# ── 조건 하나 → Filters 인자 ──────────────────────────────────────
SCOPE = {"내 매물": "mine", "매물": "any", "전체": "all"}


def parse(cond: dict[str, Any], mode: str, ctx: dict, need_where: bool = True
          ) -> tuple[dict, dict, list[str], str, dict, list[str]]:
    """반환 (Filters 인자, 아님, 줄에 실을 칸, 대상, 묶음, 손잡이 단 칸).
    대상은 「building」 · 「vacant」, 매물 범위는 flat["_scope"](mine · any · all)로 온다.
    **이름을 대면 보이고, 손잡이를 달면 걸린다.** 사전에 없는 이름은 「없다」고 말한다 — 고객 모드의 팀 이름도 같은 말."""
    flat: dict[str, Any] = {}
    nots: dict[str, list[str]] = {}
    fields: list[str] = []
    cond_cols: list[str] = []
    secs: dict[str, dict] = {}
    target = "building"
    seen_where = False
    for name, v in cond.items():
        n = BY_KO.get(name) if allowed(name, mode) else None
        if n is None:
            near = difflib.get_close_matches(name, [x.ko for x in names_for(mode)], n=3, cutoff=0.5)
            raise ValueError(f"그런 이름은 없다: 「{name}」." + (f" 혹시 {' · '.join(near)}?" if near else ""))
        if n.kind == "어디":
            if name == "대상":
                target = {"나대지": "vacant"}.get(str(v or ""), "building")
                continue
            if name == "매물":
                if (sc := SCOPE.get(str(v or ""))) is None or str(v) not in (values_of(n, ctx) or []):
                    raise ValueError(f"「매물」 값은 {values_of(n, ctx)} 중 하나다. 받은 것: {v}")
                flat["_scope"] = sc
                continue
            if isinstance(v, dict):                 # 「주소」를 {} 로 달라고만 한 것 — 늘 실리는 칸이다
                continue
            if name == "주소" and not str(v).strip():
                raise ValueError("「주소」가 비었다")
            flat[n.lo] = v
            seen_where = True
            if n.col:
                fields.append(n.col)
            continue
        if name in ("임대료", "추정가"):
            secs.setdefault(name, {})          # 줄에 붙는 목록 · 부를 때만 붙는 묶음(tools)
        if n.kind == "묶음":
            if not isinstance(v, dict):
                raise ValueError(f"「{name}」은 묶음으로 준다. 그냥 볼 거면 {{}}")
            if bad := [k for k in v if k not in n.knobs]:
                raise ValueError(f"「{name}」이 받는 손잡이는 {list(n.knobs) or '없다'}. 받은 것: {bad}")
            secs[name] = v
            continue
        if not isinstance(v, dict):
            raise ValueError(f"「{name}」은 묶음으로 준다. 보기만 할 거면 {{}}")
        if n.col:
            fields.append(n.col)
        if not v:
            if name == "입주업체":
                raise ValueError("「입주업체」는 보기만 할 수 없다. 찾을 낱말을 준다: {\"값\": [\"병원\"]}")
            continue
        if n.kind == "보기만":
            raise ValueError(f"「{name}」은 보기만 한다 — 조건이 없다. {{}} 로 달라고만 한다")
        if n.col:
            cond_cols.append(n.col)
        if n.kind in ("수", "날짜"):
            lo_k, hi_k = ("이상", "이하") if n.kind == "수" else ("이후", "이전")
            if bad := [k for k in v if k not in (lo_k, hi_k) or (k == lo_k and not n.lo) or (k == hi_k and not n.hi)]:
                raise ValueError(f"「{name}」이 받는 손잡이는 {[k for k, f in ((lo_k, n.lo), (hi_k, n.hi)) if f]} 뿐이다. 받은 것: {bad}")
            if v.get(lo_k) is not None:
                flat[n.lo] = v[lo_k]
            if v.get(hi_k) is not None:
                flat[n.hi] = v[hi_k]
            continue
        if n.kind in ("하나", "글"):
            if bad := [k for k in v if k != "값"]:
                raise ValueError(f"「{name}」이 받는 손잡이는 ['값'] 뿐이다. 받은 것: {bad}")
            val = v.get("값")
            if isinstance(val, list):
                val = val[0] if len(val) == 1 else val
            if isinstance(val, list):
                raise ValueError(f"「{name}」은 값 하나만 받는다")
            vals = values_of(n, ctx)
            if vals and val not in vals:
                raise ValueError(f"「{name}」 값은 {vals} 중 하나다. 받은 것: {val}")
            flat[n.lo] = val
            continue
        # 목록
        if bad := [k for k in v if k not in ("값", "없음")]:
            raise ValueError(f"「{name}」이 받는 손잡이는 ['값', '없음'] 뿐이다. 받은 것: {bad}")
        has, no = v.get("값"), v.get("없음")
        vals = values_of(n, ctx)

        def check(xs):
            if vals and (bad := [x for x in xs if x not in vals]):
                raise ValueError(f"「{name}」에 없는 값: {bad}. 고를 수 있는 값: {vals}")
        if no:
            no = [str(x) for x in (no if isinstance(no, list) else [no])]
            check(no)
            if n.lo == "biz_dnf":
                flat["biz_not"] = no
            else:
                nots[n.lo] = no
        if has not in (None, []):
            groups = ([[str(w) for w in g] for g in has] if isinstance(has, list) and has and all(isinstance(g, list) for g in has)
                      else [[str(x)] for x in (has if isinstance(has, list) else [has])])
            check([w for g in groups for w in g])
            if n.dnf:
                flat[n.lo] = groups
            else:
                if any(len(g) > 1 for g in groups):
                    raise ValueError(f"「{name}」는 한 건물에 값이 하나뿐이라 안쪽 묶음에 둘을 넣을 수 없다. 「또는」으로 나열한다: {{\"값\": [\"A\",\"B\"]}}")
                flat[n.lo] = [g[0] for g in groups]
    if not seen_where and need_where:
        raise ValueError("어디를 볼지가 없다. 「지역」·「주소」·「법정동코드」 중 하나는 조건마다 있어야 한다. "
                         "지역은 구부터 고른다(「강남구」). 아직 어디인지 모르면 찾지 말고 되묻는다")
    return flat, nots, fields, target, secs, cond_cols
