"""master.district_plan — 지구단위계획구역(C_UQ161) 서울 948건 · 건물 태깅.

호재의 「어느 지구단위계획인가」를 답하려고 만들었다(2026-09-04). 그전까지 우리는
필지 원장(KLIP)에서 「지구단위계획구역 포함」 여부만 알았고 **계획 이름을 몰랐다.**
팀원이 호재로 꼽은 「종로4·5가 지구단위계획」·「율곡로 지구단위계획」이 여기서 나온다.

원천: V-World 지구단위계획(MK C_UQ161, EPSG:5174, download_vworld.py --misc 30115).
전국 13,144건 중 PRESENT_SN 이 11 로 시작하는 서울 948건만 싣는다.

고시일은 NTFC_SN(고시일련번호)에 박혀 있다.

    11410NTC202012110003
         ^^^ ^^^^^^^^
             고시일자      →  2020-12-11

948건 중 919건(97%)이 이 자리를 읽는다. 못 읽으면 비운다 — 지어내지 않는다.

사용: RENT_DSN=... data/.venv/bin/python scripts/vworld/load_district_plans.py
"""
import asyncio
import os
import re
from datetime import date as _date

import asyncpg
import shapefile
from pyproj import Transformer

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")
SHP = "data/raw/C_UQ161/C_UQ161"
_T = Transformer.from_crs(5174, 4326, always_xy=True)
_NTFC = re.compile(r"^\d{5}NTC(\d{4})(\d{2})(\d{2})")


def _wkt(shp):
    """pyshp shape → MULTIPOLYGON WKT(4326). __geo_interface__ 가 구멍을 제대로 갈라 준다."""
    gi = shp.__geo_interface__
    polys = ([gi["coordinates"]] if gi["type"] == "Polygon"
             else gi["coordinates"] if gi["type"] == "MultiPolygon" else [])
    out = []
    for poly in polys:
        rings = []
        for ring in poly:
            pts = [_T.transform(x, y) for x, y in ring]
            if len(pts) >= 4:
                rings.append("(" + ",".join(f"{x:.7f} {y:.7f}" for x, y in pts) + ")")
        if rings:
            out.append("(" + ",".join(rings) + ")")
    return "MULTIPOLYGON(" + ",".join(out) + ")" if out else None


def _ntf(ntfc_sn):
    """고시일련번호에서 고시일자. 상식 밖 날짜(9999-99-99 자리채움)는 비운다."""
    m = _NTFC.match(str(ntfc_sn or ""))
    if not m:
        return None
    try:
        d = _date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None
    return d if 1960 <= d.year <= 2030 else None


async def main():
    c = await asyncpg.connect(DSN)
    await c.execute("""DROP TABLE IF EXISTS master.district_plan;
        CREATE TABLE master.district_plan(
          id serial PRIMARY KEY,
          present_sn text,      -- 도형일련번호(원본 키)
          name text,            -- 계획명(DGM_NM). 서울 948건 전부 차 있다
          sgg text,             -- 시군구 코드(PRESENT_SN 앞 5자리). 11000 = 서울시 결정
          ntfc_sn text,         -- 고시일련번호. 고시일자가 여기 박혀 있다
          ntf_date date,        -- 고시일자
          area_m2 bigint,       -- 구역 면적(DGM_AR)
          made_on date,         -- 도형 작성일(CREATE_DAT). 고시일이 아니다
          geom geometry(Geometry,4326));
        CREATE INDEX ON master.district_plan USING GIST(geom);
        CREATE INDEX ON master.district_plan(ntf_date)""")

    r = shapefile.Reader(SHP, encoding="cp949")
    f = [x[0] for x in r.fields[1:]]
    i = {k: f.index(k) for k in ("PRESENT_SN", "DGM_NM", "DGM_AR", "NTFC_SN", "CREATE_DAT")}
    rows = []
    for sr in r.iterShapeRecords():
        sn = str(sr.record[i["PRESENT_SN"]] or "")
        if not sn.startswith("11"):          # 전국 파일이다. 서울만 싣는다
            continue
        w = _wkt(sr.shape)
        if not w:
            continue
        made = sr.record[i["CREATE_DAT"]]
        rows.append((sn, (str(sr.record[i["DGM_NM"]]) or "").strip() or None, sn[:5],
                     str(sr.record[i["NTFC_SN"]] or "") or None, _ntf(sr.record[i["NTFC_SN"]]),
                     int(sr.record[i["DGM_AR"]] or 0) or None,
                     made if isinstance(made, _date) else None, w))
    await c.executemany(
        """INSERT INTO master.district_plan
             (present_sn,name,sgg,ntfc_sn,ntf_date,area_m2,made_on,geom)
           VALUES($1,$2,$3,$4,$5,$6,$7, ST_Multi(ST_MakeValid(ST_GeomFromText($8,4326))))""", rows)
    print(f"지구단위계획구역: 폴리곤 {len(rows)} · 이름 {sum(1 for x in rows if x[1])} "
          f"· 고시일자 {sum(1 for x in rows if x[4])}")

    # 건물 태깅 — 한 건물이 여러 계획에 걸릴 수 있다(재정비촉진+지구단위 중첩). 전부 보존.
    await c.execute("""DROP TABLE IF EXISTS master.building_district_plan;
        CREATE TABLE master.building_district_plan AS
        SELECT DISTINCT b.building_pk, z.id AS plan_id, z.name, z.ntf_date, z.sgg
        FROM master.buildings b JOIN master.district_plan z ON ST_Contains(z.geom, b.geom);
        CREATE INDEX ON master.building_district_plan(building_pk)""")
    n = await c.fetchval("SELECT count(DISTINCT building_pk) FROM master.building_district_plan")
    m = await c.fetchval("SELECT count(*) FROM master.building_district_plan")
    print(f"태깅 건물 {n:,}동 · 건물×계획 {m:,}행")
    await c.close()


asyncio.run(main())
