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
}

ROW_FLOOR_RATIO = 0.95   # 행수 하한(§2.5): staging ≥ live × 0.95


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
               build_area, far_area, elevator, parking)
            SELECT building_pk, addr, jibun_norm,
                   ST_SetSRID(ST_MakePoint(lng::float, lat::float), 4326),
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
                   NULLIF(NULLIF(elevator,''),'0')::int, NULLIF(NULLIF(parking,''),'0')::int
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
                "pk_not_null": await conn.fetchval(
                    f"SELECT count(*)=0 FROM {new_tbl} WHERE building_pk IS NULL OR geom IS NULL"),
                "geom_valid": await conn.fetchval(
                    f"SELECT count(*)=0 FROM {new_tbl} WHERE NOT ST_IsValid(geom)"),
                "addr_not_null": await conn.fetchval(
                    f"SELECT count(*)=0 FROM {new_tbl} WHERE addr IS NULL OR addr=''"),
                "seoul_bbox": await conn.fetchval(
                    f"""SELECT count(*)=0 FROM {new_tbl}
                        WHERE NOT ST_Within(geom, ST_MakeEnvelope(126.7,37.4,127.2,37.7,4326))"""),
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
                run_id, rows_new, rows_live, json.dumps(checks), f"validation failed: {failed}",
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
                run_id, rows_new, rows_live, json.dumps(checks), cur_version, next_v,
            )
        print(f"✅ 적재 성공: {table} v{cur_version}→v{next_v} ({rows_new}행) — 기존 보고서는 '데이터 변경됨' 전환")

        # 5) 직전-1 세대 정리(1세대 보존, §2.6)
        if cur_version >= 2:
            await conn.execute(f"DROP TABLE IF EXISTS master.{table}_v{cur_version - 1}")
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
