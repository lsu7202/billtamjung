"""master.building_redevel — 정비구역(UD602)·재정비촉진지구(UD603) 건물 태깅.

F-21 미래가치 '개발여지' 축 입력: 구역 안 건물 = 명시적 개발 기대(재건축 옵션 문헌 근거).
원천: V-World SHP(EPSG:5174, download_vworld.py 30335/30337) → 4326 재투영 → PostGIS 조인.
파이프라인 재적재 후 재실행(마스터 재빌드 시 building_pk 불변이지만 신규 동 반영).
사용: data/.venv/bin/python scripts/vworld/load_redevel_zones.py
"""
import glob
import asyncio
import os

import asyncpg
import shapefile
from pyproj import Transformer

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")
LAYERS = {"UD602": "정비구역", "UD603": "재정비촉진지구"}
_T = Transformer.from_crs(5174, 4326, always_xy=True)


def _wkt(shp):
    """pyshp shape → MULTIPOLYGON WKT(4326). parts 경계로 링 분리(구멍 포함 단순 처리)."""
    pts = shp.points
    parts = list(shp.parts) + [len(pts)]
    rings = []
    for i in range(len(parts) - 1):
        ring = [_T.transform(x, y) for x, y in pts[parts[i]:parts[i + 1]]]
        if len(ring) >= 4:
            rings.append("(" + ",".join(f"{x:.7f} {y:.7f}" for x, y in ring) + ")")
    if not rings:
        return None
    return "MULTIPOLYGON(" + ",".join(f"({r})" for r in rings) + ")"


async def main():
    c = await asyncpg.connect(DSN)
    await c.execute("""DROP TABLE IF EXISTS master.redevel_zone;
        CREATE TABLE master.redevel_zone(
          id serial PRIMARY KEY, kind text NOT NULL, name text, sgg text,
          geom geometry(Geometry,4326));
        CREATE INDEX ON master.redevel_zone USING GIST(geom)""")
    for lay, label in LAYERS.items():
        shp = glob.glob(f"data/raw/LSMD_CONT_{lay}_서울/*.shp")[0][:-4]
        r = shapefile.Reader(shp, encoding="cp949")
        flds = [f[0] for f in r.fields[1:]]
        i_rm, i_al, i_sgg = flds.index("REMARK"), flds.index("ALIAS"), flds.index("COL_ADM_SE")
        rows = []
        for sr in r.iterShapeRecords():
            w = _wkt(sr.shape)
            if w:
                name = (sr.record[i_rm] or sr.record[i_al] or "").strip() or None
                rows.append((label, name, str(sr.record[i_sgg]), w))
        await c.executemany(
            """INSERT INTO master.redevel_zone(kind,name,sgg,geom)
               VALUES($1,$2,$3, ST_Multi(ST_MakeValid(ST_GeomFromText($4,4326))))""", rows)
        print(f"{label}: 폴리곤 {len(rows)}")
    # 건물 태깅 — 포인트 in 폴리곤(건물 geom은 대표점). 한 건물이 여러 구역이면 전부 보존.
    await c.execute("""DROP TABLE IF EXISTS master.building_redevel;
        CREATE TABLE master.building_redevel AS
        SELECT DISTINCT b.building_pk, z.kind, z.name
        FROM master.buildings b JOIN master.redevel_zone z ON ST_Contains(z.geom, b.geom);
        CREATE INDEX ON master.building_redevel(building_pk)""")
    n = await c.fetchval("SELECT count(DISTINCT building_pk) FROM master.building_redevel")
    per = await c.fetch("""SELECT kind, count(DISTINCT building_pk) n
                           FROM master.building_redevel GROUP BY kind""")
    print(f"태깅 건물 {n:,}동 · " + " · ".join(f"{r['kind']} {r['n']:,}" for r in per))
    await c.close()


asyncio.run(main())
