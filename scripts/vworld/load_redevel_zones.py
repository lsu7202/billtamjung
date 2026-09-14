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
from datetime import date as _date
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


def _gosi(mnum, ntfdate):
    """관리번호(MNUM)에서 고시 정보를 뽑는다(2026-09-04 실측).

        61100001111020260145UDT1000001000
               ^^^^^ ^^^^ ^^^^
               시군구 연도 번호        →  종로구 · 서울특별시 고시 2026-145호

    839건 전부 이 자리가 숫자다. NTFDATE 가 있는 266건과 연도를 대조하니 98%·91% 일치했다.
    NTFDATE 는 32%만 차 있어서, 정확한 날짜는 그것으로 두고 연도·번호는 MNUM 에서 얻는다.
    연도가 상식 밖이면(원본 오타 '2525') 비운다 — 지어내지 않는다."""
    m = str(mnum or "")
    yr = no = None
    if len(m) >= 20 and m[7:20].isdigit():
        y, n = int(m[12:16]), int(m[16:20])
        if 1960 <= y <= 2030:
            yr, no = y, (n or None)
    d = str(ntfdate or "").strip()
    dt = None
    if len(d) == 8 and d.isdigit():
        try:
            dt = _date(int(d[:4]), int(d[4:6]), int(d[6:]))
        except ValueError:
            dt = None
    return str(mnum or "") or None, yr, no, dt


async def main():
    c = await asyncpg.connect(DSN)
    # 고시 정보를 같이 싣는다(2026-09-04). 예전엔 이름·구·도형만 실어서 「언제 지정됐나」를
    # 답할 수 없었다. 호재에 날짜가 없으면 최신인지 10년 전인지 모른다.
    await c.execute("""DROP TABLE IF EXISTS master.redevel_zone;
        CREATE TABLE master.redevel_zone(
          id serial PRIMARY KEY, kind text NOT NULL, name text, sgg text,
          mnum text,            -- 원본 관리번호. 고시 정보가 여기 박혀 있다
          gosi_year smallint,   -- 고시 연도 (MNUM 12~15자리)
          gosi_no integer,      -- 고시 번호 (MNUM 16~19자리)
          ntf_date date,        -- 고시일자(NTFDATE). 원본이 32%만 채웠다
          -- 이름이 빈 것이 317개(38%)다. 원본 REMARK·ALIAS 가 비어 원천에 없다.
          -- 지어내지 않고 고시번호를 이름 대신 쓴다 — 「서울특별시 고시 제2026-93호 정비구역」.
          -- 그것도 없으면 NULL 로 둔다. 화면이 「(이름없음)」을 쓰지 않게 하는 것이 목적.
          label text GENERATED ALWAYS AS (COALESCE(name,
            CASE WHEN gosi_year IS NOT NULL AND gosi_no IS NOT NULL
                 THEN '서울특별시 고시 제' || gosi_year || '-' || gosi_no || '호 ' || kind END)) STORED,
          geom geometry(Geometry,4326));
        CREATE INDEX ON master.redevel_zone USING GIST(geom);
        CREATE INDEX ON master.redevel_zone(gosi_year)""")
    for lay, label in LAYERS.items():
        shp = glob.glob(f"data/raw/LSMD_CONT_{lay}_서울/*.shp")[0][:-4]
        r = shapefile.Reader(shp, encoding="cp949")
        flds = [f[0] for f in r.fields[1:]]
        i_rm, i_al, i_sgg = flds.index("REMARK"), flds.index("ALIAS"), flds.index("COL_ADM_SE")
        i_mn, i_nd = flds.index("MNUM"), flds.index("NTFDATE")
        rows = []
        for sr in r.iterShapeRecords():
            w = _wkt(sr.shape)
            if not w:
                continue
            name = (sr.record[i_rm] or sr.record[i_al] or "").strip() or None
            # 원본 3건은 글자가 깨져 있다(「？몄?？ъ?鍮??吏?？援？」). 인코딩을 바꿔도 안 살아난다.
            # **깨진 글자는 이름이 아니다** — 비워서 고시번호가 대신 서게 한다.
            if name and any(c in name for c in "？�"):
                name = None
            rows.append((label, name, str(sr.record[i_sgg]),
                         *_gosi(sr.record[i_mn], sr.record[i_nd]), w))
        await c.executemany(
            """INSERT INTO master.redevel_zone(kind,name,sgg,mnum,gosi_year,gosi_no,ntf_date,geom)
               VALUES($1,$2,$3,$4,$5,$6,$7, ST_Multi(ST_MakeValid(ST_GeomFromText($8,4326))))""", rows)
        got = sum(1 for x in rows if x[4] is not None)
        dat = sum(1 for x in rows if x[6] is not None)
        nm = sum(1 for x in rows if x[1])
        print(f"{label}: 폴리곤 {len(rows)} · 이름 {nm} · 고시연도 {got} · 고시일자 {dat}")
    # 건물 태깅 — 포인트 in 폴리곤(건물 geom은 대표점). 한 건물이 여러 구역이면 전부 보존.
    # 고시 정보를 같이 내린다(2026-09-04). 예전엔 kind·name 뿐이라 「언제 지정됐나」가
    # 구역 표에만 있고 건물에는 안 왔다. 읽는 쪽이 조인을 또 하지 않게 여기서 편다.
    await c.execute("""DROP TABLE IF EXISTS master.building_redevel;
        CREATE TABLE master.building_redevel AS
        SELECT DISTINCT b.building_pk, z.id AS zone_id, z.kind, z.name, z.label,
               z.gosi_year, z.gosi_no, z.ntf_date
        FROM master.buildings b JOIN master.redevel_zone z ON ST_Contains(z.geom, b.geom);
        CREATE INDEX ON master.building_redevel(building_pk)""")
    n = await c.fetchval("SELECT count(DISTINCT building_pk) FROM master.building_redevel")
    per = await c.fetch("""SELECT kind, count(DISTINCT building_pk) n
                           FROM master.building_redevel GROUP BY kind""")
    print(f"태깅 건물 {n:,}동 · " + " · ".join(f"{r['kind']} {r['n']:,}" for r in per))
    lab = await c.fetchval("SELECT count(*) FILTER (WHERE label IS NULL) FROM master.redevel_zone")
    print(f"이름도 고시번호도 없는 구역 {lab}건 — 화면에 이름을 못 쓴다")
    await c.close()


asyncio.run(main())
