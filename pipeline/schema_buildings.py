"""buildings 적재 컬럼 단일 출처(SSOT).

export_seoul(CSV 헤더)와 loader(COPY 컬럼)가 여기서 파생 → 두 목록이 절대 어긋나지 않음.
새 스칼라 필드 추가 = ① 업스트림 추출(build_building_master 등) ② 이 COLUMNS 한 줄 ③ loader INSERT SELECT.
EXPECT_DATA = 전 건물 100% NULL이면 '조용한 누락'이므로 loader가 스왑 전에 실패(silent drop 감지).
"""

# CSV 헤더 = loader COPY 순서 (동일 순서 필수). export_seoul writerow가 이 순서로 값을 씀.
COLUMNS = [
    "building_pk", "addr", "jibun_norm", "lng", "lat",
    "road_addr", "pnu", "sgg_code", "bjd_code",
    "land_area", "total_area", "floors_above", "floors_below", "bcr", "far",
    "main_use", "main_use_name", "etc_use", "structure",
    # 정밀도 둘 — 「1959년(월·일 모름)」을 날짜 하나로 뭉개지 않기 위해(2026-09-07).
    # 값은 자리를 01 로 채우고, 이 칸이 「연·월·일」 중 무엇까지 아는지 말한다.
    "approval_ymd", "approval_ymd_prec", "remodel_ymd", "remodel_ymd_prec",
    "jimok", "parcel_area", "land_use", "use_zone", "use_zone_mix",
    "slope", "shape", "road_frontage", "station_dist", "subway_json", "bus_json",
    "gongsi_latest", "last_sale_ym", "last_sale_price",
    "build_area", "far_area", "elevator", "elevator_ext", "parking",
    "height",
    "bcr_src",   # 건폐율 출처: 대장 | 건축면적 | 층별개요추정(=추정) | 빈값
    "far_src",   # 용적률 출처: 대장 | 용적산정연면적(단독필지만) | 빈값
]

# 광범위 확보돼야 하는 컬럼 — 전 건물 100% NULL = 파이프라인 어딘가에서 필드가 조용히 누락된 것.
# (bcr·far·build_area 등은 집합/다동 원천결측으로 30~90% NULL은 정상이라 '100%만' 실패시킴)
# floors_below 는 2026-09-07 부터 0(지하 없음)을 0 으로 싣는다 — NULL 은 진짜 모르는 것뿐이다
EXPECT_DATA = [
    "land_area", "total_area", "build_area", "far_area",
    "floors_above", "bcr", "far", "main_use", "main_use_name", "structure",
    "approval_ymd", "elevator", "parking", "height", "bcr_src", "far_src",
    # elevator_ext(승강기공단 참조·0156)는 넣지 않는다 — 도로명 매칭이 성기게 붙는 참조값이라
    # 100% NULL 이 아니어도 커버리지가 낮은 것이 정상이다. 본값은 elevator 가 지킨다.
    "jimok", "land_use", "use_zone", "gongsi_latest", "station_dist",
]
