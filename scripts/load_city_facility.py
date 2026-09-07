#!/usr/bin/env python3
r"""서울시 도시계획시설 SHP 4종을 `master.city_facility` 로 적재한다(2026-09-05).

주변 동향의 **기반시설** 갈래 도형이다. 도로·공원·철도·주차장 결정 고시는
`master.urban_notice` 안에 15,084건 이미 있었는데 도형이 없어 자리를 못 잡았다.

## 고시와 바로 붙는다
SHP 의 **`NTFC_SN`** 이 `urban_notice.notice_code` 와 같은 체계다(`11545NTC202406070001`).
지구단위계획이 `ntfc_sn` 으로 붙는 것과 똑같다.

## 좌표
`.prj` 는 Korean 1985 Modified Korea Central Belt = **EPSG:5174**. V-World 와 같다.

    BT_DATABASE_URL=... backend/.venv/bin/python scripts/load_city_facility.py
"""
import asyncio
import glob
import os
import sys
import tempfile
import zipfile

import asyncpg
import shapefile
from pyproj import Transformer
from shapely.geometry import shape as shp_shape
from shapely.ops import transform as shp_transform

DSN = os.environ.get("BT_DATABASE_URL") or os.environ.get(
    "DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")
SRC = "data/raw/_seoul_gis"
T = Transformer.from_crs(5174, 4326, always_xy=True)

# 파일 이름의 레이어 코드 → 우리 갈래 이름
LAYER = {"UQ151": "도로", "UQ152": "교통시설", "UQ153": "공간시설", "UQ157": "보건위생시설",
         # 규제 — 도시계획시설은 아니지만 칸 모양이 같다(NTFC_SN·DGM_NM·DGM_AR).
         # 「지금 못 짓는다」는 한시적 사실이라 **동향**이다(2026-09-06).
         "UQ171": "개발행위허가제한"}

DDL = """
DROP TABLE IF EXISTS master.city_facility;
CREATE TABLE master.city_facility(
  id        bigserial PRIMARY KEY,
  layer     text NOT NULL,          -- 도로 · 교통시설 · 공간시설 · 보건위생시설 · 개발행위허가제한
  fac_sn    text,                   -- PRESENT_SN
  ntfc_sn   text,                   -- 고시 일련번호 → urban_notice.notice_code
  name      text,                   -- DGM_NM (주차장 · 근린공원 …)
  cls_l text, cls_m text, cls_s text,
  area      double precision,       -- DGM_AR (㎡)
  sgg_cd    text,
  made_on   date,                   -- CREATE_DAT
  geom geometry(Geometry,4326) NOT NULL);
CREATE INDEX ON master.city_facility USING GIST(geom);
CREATE INDEX ON master.city_facility(ntfc_sn);
CREATE INDEX ON master.city_facility(layer);
"""
COLS = ["layer", "fac_sn", "ntfc_sn", "name", "cls_l", "cls_m", "cls_s",
        "area", "sgg_cd", "made_on", "geom"]


def s(v):
    v = (str(v) if v is not None else "").strip()
    return v or None


def rows(zpath: str):
    """**레이어 코드는 zip 안의 SHP 이름에서 읽는다**(`UPIS_C_UQ151.shp`).
    zip 파일 이름은 받는 쪽이 정해서 바뀐다 — 이름으로 가리면 다운로더를 고칠 때마다 깨진다
    (2026-09-06 실제로 깨져서 다섯 개가 통째로 0건이 됐다). 안쪽 이름은 원천이 정한다."""
    d = tempfile.mkdtemp()
    try:
        with zipfile.ZipFile(zpath, metadata_encoding="cp949") as f:
            for i in f.infolist():
                if i.filename.lower().endswith((".shp", ".dbf", ".shx", ".prj")):
                    i.filename = os.path.basename(i.filename)
                    f.extract(i, d)
        shp = glob.glob(os.path.join(d, "*.shp"))
        if not shp:
            return
        code = next((k for k in LAYER if k in os.path.basename(shp[0]).upper()), None)
        if not code:
            print(f"  {os.path.basename(zpath)}: 모르는 레이어 {os.path.basename(shp[0])}", flush=True)
            return
        r = shapefile.Reader(shp[0], encoding="cp949")
        names = [x[0] for x in r.fields[1:]]
        for sr in r.iterShapeRecords():
            rec = dict(zip(names, list(sr.record)))
            try:
                g = shp_transform(lambda x, y, z=None: T.transform(x, y),
                                  shp_shape(sr.shape.__geo_interface__))
            except Exception:                             # noqa: BLE001, PERF203
                continue
            if g.is_empty:
                continue
            yield (LAYER[code], s(rec.get("PRESENT_SN")), s(rec.get("NTFC_SN")),
                   s(rec.get("DGM_NM")), s(rec.get("LCLAS_CL")), s(rec.get("MLSFC_CL")),
                   s(rec.get("SCLAS_CL")),
                   float(rec["DGM_AR"]) if rec.get("DGM_AR") not in (None, "") else None,
                   s(rec.get("SIGNGU_SE")), rec.get("CREATE_DAT") or None,
                   g.wkt)
    finally:
        for f in glob.glob(os.path.join(d, "*")):
            os.unlink(f)
        os.rmdir(d)


async def main() -> int:
    zips = sorted(glob.glob(os.path.join(SRC, "*.zip")))
    if not zips:
        print(f"✗ {SRC} 에 zip 이 없다 — scripts/seoul_gis/download_gis.py 먼저")
        return 2
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=7200)
    try:
        await c.execute(DDL)
        n = 0
        for z in zips:
            batch = [r for r in rows(z)]
            if not batch:
                print(f"  {os.path.basename(z)}: 0개 — 건너뜀", flush=True)
                continue
            await c.executemany(
                """INSERT INTO master.city_facility
                     (layer,fac_sn,ntfc_sn,name,cls_l,cls_m,cls_s,area,sgg_cd,made_on,geom)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,ST_GeomFromText($11,4326))""",
                batch)
            n += len(batch)
            print(f"  {os.path.basename(z)}: {len(batch):,}개", flush=True)
        await c.execute("ANALYZE master.city_facility")
        st = await c.fetchrow("""SELECT count(*) t, count(ntfc_sn) k, count(name) nm,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM master.urban_notice u
                              WHERE u.notice_code = city_facility.ntfc_sn)) j
            FROM master.city_facility""")
        print(f"\n  master.city_facility {st['t']:,}개 · 고시번호 {st['k']:,} · 이름 {st['nm']:,}")
        print(f"  고시가 붙는 것 {st['j']:,} ({100*st['j']/max(st['t'],1):.1f}%)")
        return 0
    finally:
        await c.close()


sys.exit(asyncio.run(main()))
