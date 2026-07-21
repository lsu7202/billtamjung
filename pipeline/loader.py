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

# 소스별 정의: staging 테이블·컬럼·검증 쿼리 (0006 확장 스키마)
SOURCES = {
    "buildings": {
        "columns": ["building_pk", "addr", "jibun_norm", "lng", "lat",
                    "road_addr", "pnu", "sgg_code", "bjd_code",
                    "land_area", "total_area", "floors_above", "floors_below", "bcr", "far",
                    "main_use", "main_use_name", "etc_use", "structure",
                    "approval_ymd", "remodel_ymd",
                    "jimok", "parcel_area", "land_use", "use_zone", "use_zone_mix",
                    "slope", "shape", "road_frontage", "station_dist", "subway_json", "bus_json",
                    "gongsi_latest", "last_sale_ym", "last_sale_price"],
        "table": "buildings",
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
        cur_version = await conn.fetchval("SELECT version FROM master.master_version")
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
        await conn.execute(f"""
            INSERT INTO {new_tbl}
              (building_pk, addr, jibun_norm, geom,
               road_addr, pnu, sgg_code, bjd_code,
               land_area, total_area, floors_above, floors_below, bcr, far,
               main_use, main_use_name, etc_use, structure,
               approval_ymd, remodel_ymd,
               jimok, parcel_area, land_use, use_zone, use_zone_mix,
               slope, shape, road_frontage, station_dist, subway_json, bus_json,
               gongsi_latest, last_sale_ym, last_sale_price)
            SELECT building_pk, addr, jibun_norm,
                   ST_SetSRID(ST_MakePoint(lng::float, lat::float), 4326),
                   NULLIF(road_addr,''), NULLIF(pnu,''), NULLIF(sgg_code,''), NULLIF(bjd_code,''),
                   NULLIF(land_area,'')::numeric, NULLIF(total_area,'')::numeric,
                   NULLIF(floors_above,'')::int, NULLIF(floors_below,'')::int,
                   NULLIF(bcr,'')::numeric, NULLIF(far,'')::numeric,
                   NULLIF(main_use,''), NULLIF(main_use_name,''), NULLIF(etc_use,''), NULLIF(structure,''),
                   pg_temp.safe_date(NULLIF(approval_ymd,'')), pg_temp.safe_date(NULLIF(remodel_ymd,'')),
                   NULLIF(jimok,''), NULLIF(parcel_area,'')::numeric,
                   NULLIF(land_use,''), NULLIF(use_zone,''), NULLIF(use_zone_mix,'')::jsonb,
                   NULLIF(slope,''), NULLIF(shape,''), NULLIF(road_frontage,''),
                   NULLIF(station_dist,'')::int, NULLIF(subway_json,'')::jsonb, NULLIF(bus_json,'')::jsonb,
                   NULLIF(gongsi_latest,'')::bigint, NULLIF(last_sale_ym,''), NULLIF(last_sale_price,'')::bigint
            FROM {tmp}""")
        await conn.execute(f"DROP TABLE {tmp}")

        # 3) 검증 게이트(§2.5)
        rows_live = await conn.fetchval(f"SELECT count(*) FROM {live_tbl}")
        rows_new = await conn.fetchval(f"SELECT count(*) FROM {new_tbl}")
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
        }
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
