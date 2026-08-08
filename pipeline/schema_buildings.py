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
    "approval_ymd", "remodel_ymd",
    "jimok", "parcel_area", "land_use", "use_zone", "use_zone_mix",
    "slope", "shape", "road_frontage", "station_dist", "subway_json", "bus_json",
    "gongsi_latest", "last_sale_ym", "last_sale_price",
    "build_area", "far_area", "elevator", "parking",
    "height",
]

# 광범위 확보돼야 하는 컬럼 — 전 건물 100% NULL = 파이프라인 어딘가에서 필드가 조용히 누락된 것.
# (bcr·far·floors_below·build_area 등은 집합/다동 원천결측으로 30~90% NULL은 정상이라 '100%만' 실패시킴)
EXPECT_DATA = [
    "land_area", "total_area", "build_area", "far_area",
    "floors_above", "bcr", "far", "main_use", "main_use_name", "structure",
    "approval_ymd", "elevator", "parking", "height",
    "jimok", "land_use", "use_zone", "gongsi_latest", "station_dist",
]
