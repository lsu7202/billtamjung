#!/usr/bin/env python3
"""master 적재 loader — CSV → staging COPY → 검증 게이트 → 원자 스왑(뷰 재지정) → version++
specs 07-architecture/01-상세설계 §2. Cloud Run Job 엔트리(베타: 수동 실행도 동일).

사용:
  DATABASE_URL=postgresql://... python loader.py --source buildings --csv path/to/buildings.csv
검증 실패 시 스왑하지 않고 기존 데이터 유지(exit 1).
"""
import argparse
import asyncio
import os
import sys
import uuid
import asyncpg

sys.path.insert(0, os.path.dirname(__file__))
from schema_buildings import COLUMNS as BLD_COLUMNS, EXPECT_DATA   # SSOT — export_seoul와 공유

# 소스별 정의: staging 테이블·컬럼·검증 쿼리 (0006 확장 스키마)
SOURCES = {
    "buildings": {
        "columns": BLD_COLUMNS,   # 단일 출처(schema_buildings) — export CSV 헤더와 동일 보장
        "table": "buildings",
    },
    "gongsi_series": {   # 공시지가 연도별(0007)
        "columns": ["pnu", "year", "price"],
        "table": "gongsi_series",
        "insert": """INSERT INTO {new} (pnu, year, price)
                     SELECT pnu, year::int, price::bigint FROM {tmp}
                     WHERE pnu <> '' AND year <> '' AND price <> ''""",
        "checks": ["pk_rows"],
    },
    "parcels": {         # 필지 속성·규제·폴리곤(0009)
        "columns": ["pnu", "building_pk", "is_rep", "wkt", "area",
                    "jimok", "land_use", "slope", "shape", "road_frontage",
                    "use_zone", "legal_bcr", "legal_far", "gongsi_latest",
                    "reg_godo", "reg_district", "reg_jeongbi", "reg_gyeong", "reg_banghwa", "reg_munhwa"],
        "table": "parcels",
        "insert": """INSERT INTO {new}
                       (pnu, building_pk, is_rep, geom, area, jimok, land_use, slope, shape,
                        road_frontage, use_zone, legal_bcr, legal_far, gongsi_latest,
                        reg_godo, reg_district, reg_jeongbi, reg_gyeong, reg_banghwa, reg_munhwa, uqa)
                     SELECT pnu, NULLIF(building_pk,''), is_rep::boolean,
                            ST_Multi(ST_MakeValid(ST_GeomFromText(wkt, 4326))),
                            NULLIF(area,'')::numeric, NULLIF(NULLIF(jimok,''),'지정되지않음'),
                            NULLIF(NULLIF(land_use,''),'지정되지않음'),
                            NULLIF(NULLIF(slope,''),'지정되지않음'), NULLIF(NULLIF(shape,''),'지정되지않음'),
                            NULLIF(NULLIF(road_frontage,''),'지정되지않음'),
                            NULLIF(NULLIF(use_zone,''),'미지정'), NULLIF(legal_bcr,''), NULLIF(legal_far,''),
                            NULLIF(gongsi_latest,'')::bigint,
                            NULLIF(reg_godo,''), NULLIF(reg_district,''), NULLIF(reg_jeongbi,''),
                            NULLIF(reg_gyeong,''), NULLIF(reg_banghwa,''), NULLIF(reg_munhwa,''),
                            NULLIF(use_zone,'')
                     FROM {tmp} WHERE pnu <> ''
                     ON CONFLICT (pnu) DO NOTHING""",
        "checks": ["pk_rows"],
    },
    "building_parcels": {  # 대표-부속 관계(0009)
        "columns": ["building_pk", "pnu", "role"],
        "table": "building_parcels",
        "insert": """INSERT INTO {new} (building_pk, pnu, role)
                     SELECT building_pk, pnu, role FROM {tmp}
                     WHERE building_pk <> '' AND pnu <> ''
                     ON CONFLICT (building_pk, pnu) DO NOTHING""",
        "checks": ["pk_rows"],
    },
    "sales_history": {   # 매각 이력(0007)
        "columns": ["building_pk", "contract_ym", "price", "total_area", "land_area"],
        "table": "sales_history",
        "insert": """INSERT INTO {new} (building_pk, contract_ym, price, total_area, land_area)
                     SELECT building_pk, contract_ym, price::bigint,
                            NULLIF(total_area,'')::numeric, NULLIF(land_area,'')::numeric
                     FROM {tmp} WHERE building_pk <> '' AND price <> ''""",
        "checks": ["pk_rows"],
    },
    "complex": {         # 총괄표제부 = 단지(0145). 동(buildings)과 단위가 다르다 — 섞지 않는다
        "columns": ["complex_pk", "ledger_kind", "pnu", "addr", "addr_full", "road_addr", "name",
                    "sgg_code", "bjd_code",
                    "land_area", "build_area", "bcr", "total_area", "far_area", "far",
                    "main_use", "main_use_name", "etc_use",
                    "households", "families", "main_bldg_cnt", "annex_bldg_cnt", "parking",
                    "permit_ymd", "start_ymd", "approval_ymd"],
        "table": "building_complex",
        "insert": """INSERT INTO {new}
                       (complex_pk, ledger_kind, pnu, addr, addr_full, road_addr, name,
                        sgg_code, bjd_code, land_area, build_area, bcr, total_area, far_area, far,
                        main_use, main_use_name, etc_use, households, families,
                        main_bldg_cnt, annex_bldg_cnt, parking, permit_ymd, start_ymd, approval_ymd)
                     SELECT complex_pk, NULLIF(ledger_kind,''), NULLIF(pnu,''), addr,
                            addr_full = '1', NULLIF(road_addr,''), NULLIF(name,''),
                            NULLIF(sgg_code,''), NULLIF(bjd_code,''),
                            NULLIF(land_area,'')::numeric, NULLIF(build_area,'')::numeric,
                            NULLIF(bcr,'')::numeric, NULLIF(total_area,'')::numeric,
                            NULLIF(far_area,'')::numeric, NULLIF(far,'')::numeric,
                            NULLIF(main_use,''), NULLIF(main_use_name,''), NULLIF(etc_use,''),
                            NULLIF(households,'')::int, NULLIF(families,'')::int,
                            NULLIF(main_bldg_cnt,'')::int, NULLIF(annex_bldg_cnt,'')::int,
                            NULLIF(parking,'')::int,
                            pg_temp.safe_date(NULLIF(permit_ymd,'')),
                            pg_temp.safe_date(NULLIF(start_ymd,'')),
                            pg_temp.safe_date(NULLIF(approval_ymd,''))
                     FROM {tmp} WHERE complex_pk <> '' AND addr <> ''""",
        "checks": ["pk_rows"],
    },
    "unit": {            # 전유부 = 호실(0146). 층(floor_outline)보다 한 단계 아래 — 섞지 않는다
        "columns": ["unit_pk", "pnu", "ledger_kind", "ledger_type", "addr", "road_addr",
                    "bldg_name", "dong", "ho", "floor_kind", "floor", "floor_raw",
                    "excl_area", "common_area", "main_use", "etc_use", "structure",
                    "created_ymd"],
        "table": "building_unit",
        "insert": """INSERT INTO {new}
                       (unit_pk, pnu, ledger_kind, ledger_type, addr, road_addr, bldg_name,
                        dong, ho, floor_kind, floor, floor_raw,
                        excl_area, common_area, main_use, etc_use, structure, created_ymd)
                     SELECT unit_pk, NULLIF(pnu,''), NULLIF(ledger_kind,''),
                            NULLIF(ledger_type,''), NULLIF(addr,''), NULLIF(road_addr,''),
                            NULLIF(bldg_name,''), NULLIF(dong,''), NULLIF(ho,''),
                            NULLIF(floor_kind,''), NULLIF(floor,'')::int, NULLIF(floor_raw,''),
                            NULLIF(excl_area,'')::numeric, NULLIF(common_area,'')::numeric,
                            NULLIF(main_use,''), NULLIF(etc_use,''), NULLIF(structure,''),
                            pg_temp.safe_date(NULLIF(created_ymd,''))
                     FROM {tmp} WHERE unit_pk <> ''""",
        "checks": ["pk_rows"],
    },
    "energy": {          # 건물에너지 전기·가스(0147). 열쇠가 건물 PK 가 아니라 주소다
        "columns": ["pnu", "addr_seq", "kind", "use_ym", "usage_kwh",
                    "addr", "road_addr", "sgg_code", "bjd_code"],
        "table": "building_energy",
        "insert": """INSERT INTO {new}
                       (pnu, addr_seq, kind, use_ym, usage_kwh,
                        addr, road_addr, sgg_code, bjd_code)
                     SELECT pnu, COALESCE(NULLIF(addr_seq,''),''), kind, use_ym,
                            NULLIF(usage_kwh,'')::numeric,
                            NULLIF(addr,''), NULLIF(road_addr,''),
                            NULLIF(sgg_code,''), NULLIF(bjd_code,'')
                     FROM {tmp} WHERE pnu <> '' AND kind <> '' AND use_ym <> ''""",
        "checks": ["pk_rows"],
    },
    "zone": {            # 건물별 지역·지구·구역(0148). 토지이용계획(필지 기준)과 다른 출처
        "columns": ["building_pk", "pnu", "addr", "road_addr", "sgg_code", "bjd_code",
                    "use_zone", "use_district", "use_area",
                    "zones", "districts", "areas", "created_ymd"],
        "table": "building_zone",
        "insert": """INSERT INTO {new}
                       (building_pk, pnu, addr, road_addr, sgg_code, bjd_code,
                        use_zone, use_district, use_area, zones, districts, areas, created_ymd)
                     SELECT building_pk, NULLIF(pnu,''), NULLIF(addr,''), NULLIF(road_addr,''),
                            NULLIF(sgg_code,''), NULLIF(bjd_code,''),
                            NULLIF(use_zone,''), NULLIF(use_district,''), NULLIF(use_area,''),
                            NULLIF(zones,'')::text[], NULLIF(districts,'')::text[],
                            NULLIF(areas,'')::text[],
                            pg_temp.safe_date(NULLIF(created_ymd,''))
                     FROM {tmp} WHERE building_pk <> ''""",
        "checks": ["pk_rows"],
    },
    "closed": {          # 폐쇄말소대장 = 사라진 건물(0149). buildings 와 PK 계열이 다르다
        "columns": ["closed_pk", "pnu", "close_kind", "close_ymd", "ledger_kind", "ledger_type",
                    "addr", "road_addr", "bldg_name", "dong", "sgg_code", "bjd_code",
                    "land_area", "build_area", "bcr", "total_area", "far_area", "far",
                    "structure", "main_use", "main_use_name", "etc_use",
                    "floors_above", "floors_below", "height",
                    "households", "families", "ho_cnt",
                    "permit_ymd", "start_ymd", "approval_ymd", "created_ymd"],
        "table": "building_closed",
        "insert": """INSERT INTO {new}
                       (closed_pk, pnu, close_kind, close_ymd, ledger_kind, ledger_type,
                        addr, road_addr, bldg_name, dong, sgg_code, bjd_code,
                        land_area, build_area, bcr, total_area, far_area, far,
                        structure, main_use, main_use_name, etc_use,
                        floors_above, floors_below, height, households, families, ho_cnt,
                        permit_ymd, start_ymd, approval_ymd, created_ymd)
                     SELECT closed_pk, NULLIF(pnu,''), NULLIF(close_kind,''),
                            pg_temp.safe_date(NULLIF(close_ymd,'')),
                            NULLIF(ledger_kind,''), NULLIF(ledger_type,''),
                            NULLIF(addr,''), NULLIF(road_addr,''), NULLIF(bldg_name,''),
                            NULLIF(dong,''), NULLIF(sgg_code,''), NULLIF(bjd_code,''),
                            NULLIF(land_area,'')::numeric, NULLIF(build_area,'')::numeric,
                            NULLIF(bcr,'')::numeric, NULLIF(total_area,'')::numeric,
                            NULLIF(far_area,'')::numeric, NULLIF(far,'')::numeric,
                            NULLIF(structure,''), NULLIF(main_use,''), NULLIF(main_use_name,''),
                            NULLIF(etc_use,''),
                            NULLIF(floors_above,'')::int, NULLIF(floors_below,'')::int,
                            NULLIF(height,'')::numeric,
                            NULLIF(households,'')::int, NULLIF(families,'')::int,
                            NULLIF(ho_cnt,'')::int,
                            pg_temp.safe_date(NULLIF(permit_ymd,'')),
                            pg_temp.safe_date(NULLIF(start_ymd,'')),
                            pg_temp.safe_date(NULLIF(approval_ymd,'')),
                            pg_temp.safe_date(NULLIF(created_ymd,''))
                     FROM {tmp} WHERE closed_pk <> ''""",
        "checks": ["pk_rows"],
    },
    "basic": {           # 대장 기본개요(0150). parent_pk 로 대장 세 층을 잇는다
        "columns": ["building_pk", "parent_pk", "pnu", "ledger_kind", "ledger_type",
                    "addr", "road_addr", "bldg_name", "sgg_code", "bjd_code", "extra_parcels",
                    "zone_code", "zone_name", "district_code", "district_name",
                    "area_code", "area_name", "created_ymd"],
        "table": "ledger_basic",
        "insert": """INSERT INTO {new}
                       (building_pk, parent_pk, pnu, ledger_kind, ledger_type,
                        addr, road_addr, bldg_name, sgg_code, bjd_code, extra_parcels,
                        zone_code, zone_name, district_code, district_name,
                        area_code, area_name, created_ymd)
                     SELECT building_pk, NULLIF(parent_pk,''), NULLIF(pnu,''),
                            NULLIF(ledger_kind,''), NULLIF(ledger_type,''),
                            NULLIF(addr,''), NULLIF(road_addr,''), NULLIF(bldg_name,''),
                            NULLIF(sgg_code,''), NULLIF(bjd_code,''),
                            NULLIF(extra_parcels,'')::int,
                            NULLIF(zone_code,''), NULLIF(zone_name,''),
                            NULLIF(district_code,''), NULLIF(district_name,''),
                            NULLIF(area_code,''), NULLIF(area_name,''),
                            pg_temp.safe_date(NULLIF(created_ymd,''))
                     FROM {tmp} WHERE building_pk <> ''""",
        "checks": ["pk_rows"],
    },
    "septic": {          # 오수정화(0150). 한 건물에 두 줄 이상 있을 수 있어 id 가 PK 다
        "columns": ["building_pk", "pnu", "addr", "road_addr", "bldg_name",
                    "sgg_code", "bjd_code", "form_code", "form", "form_name",
                    "unit_kind", "cap_person", "cap_m3", "created_ymd"],
        "table": "building_septic",
        "insert": """INSERT INTO {new}
                       (building_pk, pnu, addr, road_addr, bldg_name, sgg_code, bjd_code,
                        form_code, form, form_name, unit_kind, cap_person, cap_m3, created_ymd)
                     SELECT building_pk, NULLIF(pnu,''), NULLIF(addr,''), NULLIF(road_addr,''),
                            NULLIF(bldg_name,''), NULLIF(sgg_code,''), NULLIF(bjd_code,''),
                            NULLIF(form_code,''), NULLIF(form,''), NULLIF(form_name,''),
                            NULLIF(unit_kind,''),
                            NULLIF(cap_person,'')::numeric, NULLIF(cap_m3,'')::numeric,
                            pg_temp.safe_date(NULLIF(created_ymd,''))
                     FROM {tmp} WHERE building_pk <> ''""",
        "checks": ["rows"],
    },
    # 2026-09-02: 파이프라인이 이 소스를 더 안 부른다(build_all·run_pipeline 에서 뺐다).
    # 읽는 화면·API 가 없고 2,794만 행이라 빌드·적재 시간만 먹었다. 정의는 남긴다 —
    # 되살리려면 build_all 의 aptprice 단계, export_ledger_rest 의 SKIP_BY_DEFAULT,
    # run_pipeline 의 MAP 셋을 같이 켜면 된다.
    "aptprice": {        # 공동주택 공시가격 2008~2026(0150). 2,971만 행 — 칸을 최소로 둔다
        "columns": ["unit_pk", "year", "seq", "price"],
        "table": "apt_price",
        "insert": """INSERT INTO {new} (unit_pk, year, seq, price)
                     SELECT unit_pk, year::smallint, COALESCE(NULLIF(seq,'')::smallint, 0),
                            NULLIF(price,'')::bigint
                     FROM {tmp} WHERE unit_pk <> '' AND year <> ''""",
        "checks": ["rows"],
    },
}

ROW_FLOOR_RATIO = 0.95   # 행수 하한(§2.5): staging ≥ live × 0.95
GEOM_FLOOR = 0.90        # 좌표 보유 하한 — 지적도에 PNU 가 없어 geom NULL 로 살리는 건물이
                         # 4.5% 있다. 「하나도 없으면 안 된다」가 아니라 「대부분 있어야 한다」.


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, choices=SOURCES.keys())
    ap.add_argument("--csv", required=True)
    args = ap.parse_args()

    dsn = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(dsn)
    run_id = uuid.uuid4()
    src = SOURCES[args.source]
    table = src["table"]

    # 동시 실행 방지(advisory lock, §2.3)
    locked = await conn.fetchval("SELECT pg_try_advisory_lock(hashtext('bt_loader'))")
    if not locked:
        print("다른 loader가 실행 중 — 종료")
        return 1

    await conn.execute(
        """INSERT INTO master.master_loads(run_id, source, started_at, status)
           VALUES($1, $2, now(), 'running')""",
        run_id, args.source,
    )
    try:
        # 소스별 물리테이블 최신 버전 탐지(전역 master_version과 독립)
        tbl_ver = await conn.fetchval(
            """SELECT max(substring(table_name from '_v(\\d+)$')::int)
               FROM information_schema.tables
               WHERE table_schema='master' AND table_name ~ ('^' || $1 || '_v\\d+$')""",
            table,
        )
        cur_version = tbl_ver or 1
        next_v = cur_version + 1
        live_tbl = f"master.{table}_v{cur_version}"
        new_tbl = f"master.{table}_v{next_v}"

        # 1) staging = 새 버전 테이블 생성(멱등: 있으면 재생성)
        await conn.execute(f"DROP TABLE IF EXISTS {new_tbl}")
        await conn.execute(f"CREATE TABLE {new_tbl} (LIKE {live_tbl} INCLUDING ALL)")

        # 2) CSV COPY (lng/lat → geom 변환 위해 임시 컬럼 사용)
        tmp = f"master._load_tmp_{args.source}"
        await conn.execute(f"DROP TABLE IF EXISTS {tmp}")
        cols_ddl = ", ".join(f"{c} text" for c in src["columns"])
        await conn.execute(f"CREATE TABLE {tmp} ({cols_ddl})")
        # 불량 날짜(예: 1974-02-30) 내성: 실패 시 NULL
        await conn.execute("""
            CREATE OR REPLACE FUNCTION pg_temp.safe_date(t text) RETURNS date AS $$
            BEGIN RETURN t::date; EXCEPTION WHEN others THEN RETURN NULL; END
            $$ LANGUAGE plpgsql IMMUTABLE""")
        with open(args.csv, "rb") as f:
            await conn.copy_to_table(
                f"_load_tmp_{args.source}", source=f, schema_name="master",
                columns=src["columns"], format="csv", header=True,
            )
        if "insert" in src:   # 시계열 등 단순 소스
            await conn.execute(src["insert"].format(new=new_tbl, tmp=tmp))
        else:                  # buildings(geom 변환 포함)
            await conn.execute(f"""
            INSERT INTO {new_tbl}
              (building_pk, addr, jibun_norm, geom,
               road_addr, pnu, sgg_code, bjd_code,
               land_area, total_area, floors_above, floors_below, bcr, far,
               main_use, main_use_name, etc_use, structure,
               approval_ymd, remodel_ymd,
               jimok, parcel_area, land_use, use_zone, use_zone_mix,
               slope, shape, road_frontage, station_dist, subway_json, bus_json,
               gongsi_latest, last_sale_ym, last_sale_price,
               build_area, far_area, elevator, parking, height, bcr_src, far_src)
            SELECT building_pk, addr, jibun_norm,
                   -- 좌표가 빈 건물(지적도에 PNU 없음)은 geom NULL — 건물 자체는 살린다.
                   -- PostGIS 공간조건은 NULL 을 거짓으로 보므로 지도 검색에서 알아서 빠진다.
                   CASE WHEN lng <> '' AND lat <> ''
                        THEN ST_SetSRID(ST_MakePoint(lng::float, lat::float), 4326) END,
                   NULLIF(road_addr,''), NULLIF(pnu,''), NULLIF(sgg_code,''), NULLIF(bjd_code,''),
                   NULLIF(land_area,'')::numeric, NULLIF(total_area,'')::numeric,
                   NULLIF(floors_above,'')::int, NULLIF(floors_below,'')::int,
                   NULLIF(bcr,'')::numeric, NULLIF(far,'')::numeric,
                   NULLIF(main_use,''), NULLIF(main_use_name,''), NULLIF(etc_use,''), NULLIF(structure,''),
                   pg_temp.safe_date(NULLIF(approval_ymd,'')), pg_temp.safe_date(NULLIF(remodel_ymd,'')),
                   NULLIF(NULLIF(jimok,''),'지정되지않음'), NULLIF(parcel_area,'')::numeric,
                   NULLIF(NULLIF(land_use,''),'지정되지않음'),
                   NULLIF(NULLIF(use_zone,''),'미지정'), NULLIF(use_zone_mix,'')::jsonb,
                   NULLIF(NULLIF(slope,''),'지정되지않음'), NULLIF(NULLIF(shape,''),'지정되지않음'),
                   NULLIF(NULLIF(road_frontage,''),'지정되지않음'),
                   NULLIF(station_dist,'')::int, NULLIF(subway_json,'')::jsonb, NULLIF(bus_json,'')::jsonb,
                   NULLIF(gongsi_latest,'')::bigint, NULLIF(last_sale_ym,''), NULLIF(last_sale_price,'')::bigint,
                   NULLIF(build_area,'')::numeric, NULLIF(far_area,'')::numeric,
                   NULLIF(NULLIF(elevator,''),'0')::int, NULLIF(NULLIF(parking,''),'0')::int,
                   NULLIF(height,'')::numeric, NULLIF(bcr_src,''), NULLIF(far_src,'')
            FROM {tmp}""")
        await conn.execute(f"DROP TABLE {tmp}")

        # buildings 공간 GIST 인덱스 — 반경 comp·주변시세·활용유형 쿼리(::geography DWithin)가
        # 인덱스를 타게 함. 없으면 56만행 풀스캔 → 리포트 로딩 ~10s. LIKE INCLUDING ALL로 이미
        # 상속됐으면 건너뜀(중복 방지). 신규 v1 재빌드에도 보장.
        if args.source == "buildings":
            has_gist = await conn.fetchval(f"""
                SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
                JOIN pg_am am ON am.oid=c.relam
                WHERE i.indrelid = '{new_tbl}'::regclass AND am.amname='gist'""")
            if not has_gist:
                await conn.execute(f"CREATE INDEX ON {new_tbl} USING GIST (geom)")
                await conn.execute(f"CREATE INDEX ON {new_tbl} USING GIST ((geom::geography))")
                print("  · buildings 공간 GIST 인덱스 생성(geom, geom::geography)")

        # 3) 검증 게이트(§2.5)
        rows_live = await conn.fetchval(f"SELECT count(*) FROM {live_tbl}")
        rows_new = await conn.fetchval(f"SELECT count(*) FROM {new_tbl}")
        if "checks" in src:   # 시계열 등 단순 소스: 행수 하한 + 비어있지 않음
            checks = {
                "row_floor": rows_new >= rows_live * ROW_FLOOR_RATIO,
                "not_empty": rows_new > 0,
            }
        else:                  # buildings 전체 검증
            # 빈 컬럼 게이트: EXPECT_DATA 중 전 행 NULL = 파이프라인 어딘가서 필드 조용히 누락 → 실패
            empty_cols = [
                c for c in EXPECT_DATA
                if await conn.fetchval(f"SELECT count(*) FILTER (WHERE {c} IS NOT NULL)=0 FROM {new_tbl}")
            ]
            checks = {
                "row_floor": rows_new >= rows_live * ROW_FLOOR_RATIO,
                # PK 는 하나도 비면 안 된다. **좌표는 다르다** — 지적도에 PNU 가 없는 건물을
                # geom NULL 로 일부러 살려 두는데(위 COPY 주석), 예전 게이트가 그걸 이유로
                # 적재를 거부했다. 26,295동(4.5%)이 있어 실데이터로는 반드시 실패하는
                # 구조였다(2026-08-31 발견 — 8/30 에 통과한 건 표가 0행이라 조건이 공허하게 참).
                # 좌표는 「하나도 없으면 안 된다」가 아니라 「대부분 있어야 한다」로 본다.
                "pk_not_null": await conn.fetchval(
                    f"SELECT count(*)=0 FROM {new_tbl} WHERE building_pk IS NULL"),
                "geom_coverage": await conn.fetchval(
                    f"""SELECT count(geom)::float / NULLIF(count(*),0) >= {GEOM_FLOOR}
                        FROM {new_tbl}"""),
                "geom_valid": await conn.fetchval(
                    f"SELECT count(*)=0 FROM {new_tbl} WHERE geom IS NOT NULL AND NOT ST_IsValid(geom)"),
                "addr_not_null": await conn.fetchval(
                    f"SELECT count(*)=0 FROM {new_tbl} WHERE addr IS NULL OR addr=''"),
                "seoul_bbox": await conn.fetchval(
                    f"""SELECT count(*)=0 FROM {new_tbl}
                        WHERE geom IS NOT NULL
                          AND NOT ST_Within(geom, ST_MakeEnvelope(126.7,37.4,127.2,37.7,4326))"""),
                "no_empty_columns": not empty_cols,
            }
            if empty_cols:
                print(f"⚠️ 전 행 NULL 컬럼(silent drop 의심): {empty_cols}")
        import json
        failed = [k for k, ok in checks.items() if not ok]
        if failed:
            await conn.execute(
                """UPDATE master.master_loads SET finished_at=now(), status='failed',
                     rows_in=$2, rows_out=$3, validation=$4, error=$5 WHERE run_id=$1""",
                # rows_in=적재 전(live) · rows_out=이번에 넣은 것(new).
                # 2026-09-01 까지 둘이 뒤바뀌어 있어 rows_out 이 전부 0 으로 찍혔다
                # (새 표는 적재 전이 0이라 「몇 행 들어갔나」를 못 답했다).
                run_id, rows_live, rows_new, json.dumps(checks), f"validation failed: {failed}",
            )
            print(f"❌ 검증 실패 {failed} — 스왑하지 않음(기존 v{cur_version} 유지)")
            return 1

        # 4) 원자 스왑(뷰 재지정) + version++ (§2.6·2.8, 단일 트랜잭션)
        async with conn.transaction():
            await conn.execute(f"CREATE OR REPLACE VIEW master.{table} AS SELECT * FROM {new_tbl}")
            await conn.execute(
                "UPDATE master.master_version SET version=$1, loaded_at=now(), source=$2",
                next_v, args.source,
            )
            await conn.execute(
                """UPDATE master.master_loads SET finished_at=now(), status='success',
                     rows_in=$2, rows_out=$3, validation=$4, from_version=$5, to_version=$6
                   WHERE run_id=$1""",
                run_id, rows_live, rows_new, json.dumps(checks), cur_version, next_v,
            )
        print(f"✅ 적재 성공: {table} v{cur_version}→v{next_v} ({rows_new}행) — 기존 보고서는 '데이터 변경됨' 전환")

        # 4-b) 지역 집계 MV 갱신(0028) — 자동완성·필터 지역목록이 이걸 읽는다.
        # 스왑 후에 돌려야 새 데이터가 반영된다. CONCURRENTLY라 조회를 막지 않는다.
        for mv, srcs in (("master.region_index", ("buildings",)),
                         ("master.sales_agg", ("sales_history",)),
                         # 0030 — 검색 수익률이 층 기준 하이브리드라 층 추정이 바뀌면 함께 굴린다.
                         ("master.floor_est_by_floor", ("floor_outline", "floor_rent_est")),
                         ("master.floor_est_total", ("floor_outline", "floor_rent_est"))):
            if args.source not in srcs:
                continue
            try:
                await conn.execute(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {mv}")
                print(f"  · {mv} 갱신")
            except Exception as e:      # MV 미생성(마이그레이션 전) 등 — 적재 자체는 성공 처리
                print(f"  ⚠️ {mv} 갱신 실패(무시): {e}")

        # 5) 직전-1 세대 정리(1세대 보존, §2.6)
        #
        # **여기서 엎어져도 적재는 성공이다.** 스왑도 version++ 도 장부도 이미 커밋됐고,
        # 이건 옛 표를 치우는 뒷정리일 뿐이다. 그런데 예외가 아래 handler 까지 올라가면
        # 장부가 통째로 'failed' 로 덮여, 585,731행이 멀쩡히 들어간 적재가 실패로 남는다
        # (2026-09-01 실제로 그랬다 — 옛 세대에 딸린 MV 가 DROP 을 막았다).
        # 못 지우면 다음 적재가 다시 시도한다. 자리만 좀 더 쓸 뿐이다.
        if cur_version >= 2:
            old = f"master.{table}_v{cur_version - 1}"
            try:
                await conn.execute(f"DROP TABLE IF EXISTS {old}")
            except Exception as e:
                print(f"  ⚠️ 옛 세대 {old} 정리 실패(적재는 성공): {e}")
        return 0
    except Exception as e:
        await conn.execute(
            """UPDATE master.master_loads SET finished_at=now(), status='failed', error=$2
               WHERE run_id=$1""",
            run_id, str(e)[:500],
        )
        print("❌ loader 예외:", e)
        return 1
    finally:
        await conn.execute("SELECT pg_advisory_unlock(hashtext('bt_loader'))")
        await conn.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
