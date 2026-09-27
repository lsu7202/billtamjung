"""모델에게 나가는 칸 이름 — 한국어로 바꾼다.

## 왜 한국어인가

실측(2026-09-19, 종로구 20줄 · claude-haiku-4-5 count_tokens):

    지금 (단위 없음)     3,179 토큰   줄당 159
    영어 + 단위 접미사    3,759 토큰   줄당 188   +18.2%
    한국어              3,439 토큰   줄당 172    +8.2%

`land_area_m2` 는 글자가 짧아도 `_m2` 가 토큰을 쪼갠다. 「대지면적」은 글자가 길어도
한 낱말로 붙는다. 단위를 이름에 담을 거면 한국어가 싸다. 게다가 모델이 답을 한국어로
쓰므로 옮길 일이 없고, 화면 라벨과도 같은 말이 된다.

## 단위는 이름이 아니라 머리줄에

「대지면적」이 ㎡ 인지 평인지, 「추정가」가 원인지 억인지는 이름만으로 안 갈린다.
그렇다고 `대지면적_㎡` 로 쓰면 다시 토큰이 쪼개진다. 그래서 응답 맨 앞에 `단위` 한 줄을
두고 줄마다 반복하지 않는다. 한 번에 20 토큰이다.

## 바꾸는 자리

**내보내기 직전 한 곳에서만** 갈아 끼운다. `search()` 와 SQL 과 화면은 영어 이름 그대로다.
"""
from __future__ import annotations

# 결과 줄의 칸 이름. ref.fields 에 있는 16개는 그 label 을 따르고 나머지는 여기 적는다
# (등록률 21%라 사전을 원천으로 못 쓴다 — tools.py 의 _ENUM_OF 주석과 같은 사정).
KO: dict[str, str] = {
    # 신원
    "building_pk": "건물번호", "addr": "주소", "pnu": "필지번호", "road_addr": "도로명주소",
    # 땅
    "land_area": "대지면적", "parcel_area": "필지면적", "jimok": "지목", "land_use": "토지이용",
    "use_zone": "용도지역", "shape": "지형형상", "slope": "지세", "road_frontage": "도로접면",
    # 건물
    "total_area": "연면적", "build_area": "건축면적", "far_area": "용적산정연면적",
    "floors_above": "지상층수", "floors_below": "지하층수", "height": "높이",
    "structure": "구조", "main_use_name": "주용도", "etc_use": "기타용도",
    "approval_ymd": "사용승인일", "remodel_ymd": "리모델링일",
    "elevator": "승강기", "parking": "주차대수", "station_dist": "역거리",
    # 실측 도로폭(building_road). 검색에 08-07 이후 안 붙어 있던 것(2026-09-22)
    "road_front": "전면도로폭", "road_side": "측면도로폭", "road_rear": "후면도로폭",
    # 필지 규제 이름들. 나대지 대장의 reg_all 과 같은 이름으로 나간다
    "reg_names": "규제",
    # 건폐·용적
    "bcr": "건폐율", "legal_bcr": "법정건폐율", "bcr_slack": "건폐여유",
    "far": "용적률", "legal_far": "법정용적률", "far_slack": "용적여유",
    # 공시지가
    "gongsi_latest": "공시지가", "gongsi_total": "공시총액",
    # 공시총액 ÷ **추정가**. 팀 매매가로 나눈 gongsi_ratio_team 과 이름이 겹치면 안 된다
    # (평단가가 pp_land「추정평단가대지」/ pp_land_team「평단가대지」로 갈리는 것과 같다)
    "gongsi_ratio": "추정공시비율",
    "gongsi_up5": "공시5년상승", "gongsi_up10": "공시10년상승",
    # 실거래
    "last_sale_price": "최근실거래가", "last_sale_ym": "최근실거래월",
    "sale_cnt": "실거래횟수", "sale_pnl": "실거래등락",
    # 빌탐정 추정 — 조건으로는 못 걸고 여기로만 본다
    "sale_est": "추정가", "roi_est": "추정수익률", "rent_est_m": "추정월임대",
    "deposit_est": "추정보증금", "est_annual_rent": "추정연임대",
    "pp_land": "추정평단가대지", "pp_total": "추정평단가연면적",
    # 유동인구
    "float_pop": "유동인구",
    # 업종
    "biz_n": "업종수",
    # 대장에만 있는 칸
    "bjd_code": "법정동코드",
    # 나대지 대장(master.vacant_parcels) — 건물과 이름이 같아야 모델이 안 헷갈린다
    "area": "대지면적", "reg_all": "규제",
    # 걸침 필지 — 대장은 큰 쪽 하나만 준다. 둘째 비중이 10% 넘는 건물이 12,281동이고
    # 그런 땅은 법정 건폐·용적이 갈려 답이 달라진다.
    "use_zone_mix": "용도지역 비중", "gongsi_series": "공시지가추이",
    "bus_json": "버스정류장", "subway_json": "지하철역", "sales_history": "실거래이력",
    # 팀 값 — listing 안으로 들어간다
    "listing_no": "매물번호", "team_price": "매매가", "sale_price": "매매가", "ask_price": "매도희망가",
    "rent_total": "총월임대", "deposit_total": "총보증금",
    # 건물 대장의 층별 합계 — 검색의 rent_total 과 **같은 뜻인데 이름이 다르게 온다**
    "total_rent": "총월임대", "total_deposit": "총보증금", "total_mgmt": "총관리비",
    "mgmt_total": "총관리비", "vacant_area": "공실면적",   # 공실은 수가 아니라 넓이(0180)
    # 만실(0181). full_est 가 참이면 _shape 가 이름 앞에 「추정」을 붙인다 — 칸 자체는 안 보낸다
    "rent_full": "만실월임대", "roi_full": "만실수익률",
    "roi": "수익률",
    "pp_land_team": "평단가대지", "pp_total_team": "평단가연면적", "gongsi_ratio_team": "공시비율",
    "urgency": "급함", "intent": "매도의사", "meongdo": "명도", "use_change": "용도변경",
    "myeolsil": "멸실", "nohudo": "노후도", "building_major": "대분류", "building_use": "소분류", "price_vs_market": "시세대비",
    "grade": "등급", "ipji": "입지", "sell_vague": "매도시점",
    "received_on": "접수일", "assignee_account_id": "담당자", "has_photo": "사진",
    # 소유자
    "owner_name": "소유자", "owner_phone": "전화", "owner_type": "소유자유형",
    "relation": "관계", "cooperation": "협조", "kindness": "친절",
}

# 줄마다 되풀이하지 않고 응답 맨 앞에 한 번 둔다.
UNITS = "면적 ㎡ · 금액 원 · 평단가 원/평 · 공시지가 원/㎡ · 거리 m · 비율 % · 층수 층 · 유동인구 명/일"

# 모델에게 안 보낸다 — 화면 전용이거나 내부 판정값이다.
DROP = frozenset({
    "col",            # mine/normal 가름. 줄의 「내매물」로 대신한다
    "float_pop_night",  # 「유동인구」 칸이 주간과 함께 낸다(tools._shape). 따로 이름을 안 만든다
    "full_est",       # 만실 값 이름에 「추정」을 붙이는 데만 쓴다(tools._shape). 칸으로는 안 보낸다
    "lat", "lng",     # 지도용. 주소가 있다
    "price_is_est",   # 화면이 「추정」 꼬리표를 붙일지 정하는 값
    "price",          # sale_price 없으면 sale_est 로 채운 혼합값. 섞인 값을 모델에게 주지 않는다
})

# listing 묶음으로 내려갈 칸 — 팀이 적은 값이다. 우리 매물이 아니면 이 묶음 자체가 없다.
LISTING = (
    "listing_no", "team_price", "sale_price", "ask_price",
    "rent_total", "deposit_total", "mgmt_total", "vacant_area",
    "roi", "rent_full", "roi_full", "full_est", "pp_land_team", "pp_total_team", "gongsi_ratio_team",
    "urgency", "intent", "meongdo", "use_change", "myeolsil", "nohudo",
    "building_major", "building_use", "price_vs_market", "grade", "ipji", "sell_vague", "received_on",
    "assignee_account_id", "has_photo",
    "owner_name", "owner_phone", "owner_type", "relation", "cooperation", "kindness",
)


# 건물 한 채의 묶음 이름 — `include` 로 고르는 갈래다.
SECTIONS = {
    "층별": "floors", "필지": "parcels", "주변실거래": "sales",
    # 「유동인구」는 칸(주간·야간 두 수)의 이름이다. 묶음이 같은 이름을 쓰다 사전에서 칸을
    # 덮어써 모델이 그 수를 못 봤다(2026-09-22). 묶음은 든 것을 이름으로 말한다 —
    # 시간대별유동인구(24개 수·정점시각·집계일수) · 상권구성(반경 600m 업체 수 7갈래, 소상공인 원장).
    "시간대별유동인구": "pop_hourly", "상권구성": "market_mix", "주변동향": "events",
    "임대추이": "rent_series",      # 부동산원 임대동향으로 역산한 해마다의 임대료
    # 입주 이력(2026-09-25) — 누가 언제 들어왔다 나갔나(LOCALDATA). 임대료는 없다
    "입주이력": "tenancy_history",
    # 임대 내역(2026-09-26) — **우리 매물일 때만** 있다. 호실(업체 단위)·임대료·공실면적은 팀이 확인한
    # 기록이라 층별(대장·원장)과 나눴다. 우리 매물이 아니면 이 묶음은 오지 않는다 — 추정 임대만 쓴다
    "임대내역": "rent_ledger",
    "주변매각": "comps",            # 반경 내 매물당 최근 1건 — 연면적 평단가 축(04 슬라이드)
    # 아래 넷은 **대장에 실려 있던 목록**이다. 「한 줄은 대장, 여러 줄은 함께」가 규칙인데
    # 이 넷만 눌러앉아 안 달라고 해도 왔다 — 건물 대장 2,548자의 65%, 나대지의 43%였다
    # (2026-09-21 실측). 한 줄짜리 대응값은 대장에 그대로 있다(역거리·공시지가·최근실거래가).
    "버스정류장": "bus", "지하철역": "subway",
    "공시지가추이": "gongsi_series", "실거래이력": "sales_history",
}

# 대장에서 모델에게 안 보내는 칸(위 DROP 에 더해).
LEDGER_DROP = frozenset({
    "_edited", "parcel_geom", "main_use",
    "sgg_code",     # 「법정동코드」 앞 다섯 자리다
    "buildable",    # 나대지 대장의 빈 칸. 화면이 계산해 채우는 자리
    "elevator_ext", # 아래 _ref 로 옮겨 낸다(이름을 갈라야 대장값과 안 섞인다)
})

# 대장이 비었을 때 곁에 서는 값. **대장값과 이름을 갈라 둔다** — 확인설명서·계약서로
# 나가는 자리엔 안 서는 값이라 섞이면 안 된다(화면은 「계산 58%」·「승강기공단 1대」로 쓴다).
# 건폐율 없음 214,004동 · 용적률 없음 213,287동 · 승강기 없음 507,979동.
REF_KO: dict[str, str] = {
    "bcr_calc": "건폐율 계산값", "far_calc": "용적률 계산값", "elevator_ext": "승강기공단",
}

# 목록 안쪽 칸 이름 — 층별·필지·주변실거래·유동인구가 쓴다.
KO_NESTED: dict[str, str] = {
    # 층별
    "floor": "층", "floor_area": "바닥면적", "unit_no": "호실", "tenant_name": "상호명",
    # **면적이 넷이다.** 눈금이 달라 한 이름으로 부르면 섞인다(2026-09-25).
    #   바닥면적   층별개요. 그 층 전체 · 공용 포함
    #   전용면적   전유부. 호실 전용 (공용면적과 짝)
    #   계약면적   팀이 적은 것. 계약서에 적히는 면적
    #   영업장면적 인허가. 그 가게가 쓰는 넓이
    "contract_area": "계약면적", "area": "영업장면적",
    "rent": "월 임대료", "maintenance": "월 관리비",
    "name": "상호명", "url": "링크",
    "deposit": "보증금", "use": "용도",      # 둘이 빠져 영어 그대로 나갔다(2026-09-25)
    # 필지
    "role": "역할", "pnu": "필지번호", "gongsi": "공시지가",
    # 주변 실거래
    "radius_m": "반경", "years": "연수", "total": "건수", "excluded": "제외",
    "median_per_area": "중위평단가", "median_price": "중위가", "sales": "목록",
    "dist_m": "거리", "contract_ym": "계약월", "price": "가격", "per_area": "평단가",
    "is_outlier": "이상치",
    # 유동인구
    "day": "주간", "night": "야간", "peak_hour": "정점시각", "hourly": "시간대",
    "days": "집계일수", "mix": "구성",     # days 는 요일이 아니라 평균 낸 날 수다(14)
    # 주변 동향 — 뉴스 제목에 「상호명」이 붙던 것을 고친다(2026-09-20). 층별의 name 은
    # 상호명이 맞지만 소식의 name 은 제목이라, 이 묶음만 따로 옮긴다(_clean 의 sec 인자).
    "kind": "갈래", "title": "제목", "on_date": "날짜", "dist": "거리",
    # 임대추이 · 주변매각
    "series": "추이", "up5": "5년상승", "up10": "10년상승", "rate": "요율",
    "sales": "목록", "contract_ym": "계약월", "total_area": "연면적",
    "on_year": "연도",      # 날짜가 없는 소식(정비구역 545건)은 연도만 있다
    "items": "목록", "radius": "반경", "center": "중심",
    "parcels": "필지목록", "road": "도로", "source": "출처",
    # 필지 · 도로 · 규제
    "front_m": "전면도로폭", "side_m": "측면도로폭", "rear_m": "후면도로폭",   # 검색 칸과 같은 이름
    "reg_all": "규제",
    # 층별 합계 — 대장 묶음에 온다. 이름이 검색의 총보증금·총월임대·총관리비와 같아야 한다
    "total_deposit": "총보증금", "total_rent": "총월임대", "total_mgmt": "총관리비",
    "vacant_area": "공실면적",
    # 고시 본문 — 제목·날짜·출처로 충분하다. 본문과 고시번호는 안 보낸다(NESTED_DROP)
}

# 묶음마다 이름이 갈리는 칸 — 같은 `name` 이 층별에선 상호명, 소식에선 제목이다.
KO_BY_SECTION: dict[str, dict[str, str]] = {
    "주변동향": {"name": "제목"},
}

# 모델에게 안 보내는 목록 안쪽 칸. 쓸 데가 없거나(id·label) 무겁다(geom·tags·body).
NESTED_DROP = frozenset({
    "id",           # 우리 표의 일련번호. 모델이 다시 부를 수 없는 값이다

    "source_url",   # 모델이 열 수 없다
    "tags",         # 한 줄에 아홉 개씩 · 이 건물과 무관한 구 이름이 섞인다
    "label",        # 「필지번호」·「주소」와 겹친다
    "geom",         # 좌표 다각형
    "distance_m",   # 「거리」와 겹친다
    "body",         # 고시 본문 전문. 제목·날짜·출처로 충분하다
    "gosi_no",      # 고시번호. 모델이 다시 찾을 수 없다
})


def kon(key: str) -> str:
    """목록 안쪽 칸 이름. 없으면 바깥 사전을 보고, 그래도 없으면 그대로 둔다."""
    return KO_NESTED.get(key) or KO.get(key, key)


def ko(key: str) -> str:
    """영어 칸 이름 → 한국어. 모르는 이름은 그대로 둔다(지어내지 않는다)."""
    return KO.get(key, key)


# ── 조건 이름 ───────────────────────────────────────────────────────────────
# 답도 물음도 한국어인데 조건만 영어였다. `biz_all` 은 「크롤링한 입주 업체가
# 전부 든 건물」인데 이름이 그렇게 안 읽혀, 「근생 중 병원 없는 건물」 물음에 모델이
# `use=병원 · biz_all=[근린생활시설]` 을 걸어 0건을 냈다(2026-09-19 실측). 설명은
# 98개 중 하나라 안 읽히고 이름은 고를 때 읽힌다. 스키마는 22 토큰(0.3%) 늘어난다.
#
# 응답 칸 이름(KO)과 같은 개념은 **같은 낱말**을 쓴다 — 조건에 「급함」으로 걸고
# 결과에서 「급함」으로 돌아와야 같은 것인 줄 안다.

# 범위 칸 — `_min`·`_max` 가 `_이상`·`_이하` 로 붙는다.
_FILTER_RANGE: dict[str, str] = {
    "land_area": "대지면적", "parcel_area": "필지면적", "total_area": "연면적",
    "build_area": "건축면적", "far_area": "용적산정연면적",
    "road_front": "전면도로폭",
    "floors_above": "지상층수", "floors_below": "지하층수",
    "bcr": "건폐율", "far": "용적률",
    "legal_bcr": "법정건폐율", "legal_far": "법정용적률",
    "bcr_slack": "건폐여유", "far_slack": "용적여유",
    "elevator": "승강기", "parking": "주차대수",
    "age": "연식", "remodel_years": "리모델링경과",
    "gongsi": "공시지가", "gongsi_total": "공시총액",
    "gongsi_up5": "공시5년상승", "gongsi_up10": "공시10년상승",
    "last_sale_years": "실거래경과", "sale_pnl": "실거래등락", "sale_count": "실거래횟수",
    "value": "가격",
    "pp_land_team": "평단가대지", "pp_total_team": "평단가연면적",
    "gongsi_ratio_team": "공시비율",
    "roi": "수익률",
    "rent_total": "총월임대",
    "deposit_total": "총보증금", "mgmt_total": "총관리비",
    "vacant_area": "공실면적",
    "roi_full": "만실수익률",
}

# 접미사가 없는 칸.
_FILTER_PLAIN: dict[str, str] = {
    # 어디
    "region": "지역", "bjd_code": "법정동코드", "building_pk": "건물번호",
    # 나대지를 하나 집는 길. 건물의 `건물번호` 에 해당한다 — 이게 없으면 검색이
    # 조회를 대신할 수 없다(2026-09-21).
    "pnu": "필지번호",
    "addr": "주소",                                     # 지번으로 한 채(2026-09-22)
    "station_dist_max": "역거리_이하",
    # 땅
    "use_zones": "용도지역", "jimoks": "지목", "road_frontages": "도로접면",
    "shapes": "지형형상", "slopes": "지세",
    "regulations": "규제",                             # 토지이용계획 규제. 정비구역도 여기
    # 용도 둘 — 허가 때 용도와 지금 든 업체는 다른 것이다. 이름이 그걸 말해야 한다.
    # 「용도」하나로 묶어 뒀더니(2026-09-19) 둘의 구분 자체가 화면에서 사라졌다.
    "use": "주용도",                                   # 대장. 부분일치
    "biz_dnf": "입주업체",                             # 크롤링한 실제 업체(master.biz)
    # 「없음」은 조건마다 따로 파지 않는다 — 값 옆에 {"있음":…, "없음":…} 으로 온다
    # 팀이 적은 값
    "vacant": "공실", "sell_vagues": "매도시점", "urgencies": "급함",
    "owner_types": "소유자유형", "relations": "관계",
    "cooperations": "협조", "kindnesses": "친절",
    "meongdos": "명도", "use_changes": "용도변경", "myeolsils": "멸실",
    "assignees": "담당자", "owner_name": "소유자", "listing_no": "매물번호",
    "intent": "매도의사", "has_phone": "전화있음", "has_photo": "사진있음",
    "received_from": "접수일_이후", "received_to": "접수일_이전",
}

FILTER_KO: dict[str, str] = dict(_FILTER_PLAIN)
for _en, _k in _FILTER_RANGE.items():
    FILTER_KO[f"{_en}_min"] = f"{_k}_이상"
    FILTER_KO[f"{_en}_max"] = f"{_k}_이하"

# 되돌리기. 모델이 보낸 조건을 `Filters` 가 아는 이름으로 옮긴다.
FILTER_EN: dict[str, str] = {v: k for k, v in FILTER_KO.items()}


def filters_to_en(f: dict) -> dict:
    """모델이 보낸 한국어 조건 → 영어. 모르는 이름은 그대로 둔다 —
    `Filters` 가 `extra="forbid"` 라 거기서 걸리고 모델이 그 사실을 듣는다."""
    return {FILTER_EN.get(k, k): v for k, v in f.items()}
