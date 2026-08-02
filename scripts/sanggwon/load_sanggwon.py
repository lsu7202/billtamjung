"""master.sanggwon 적재 — 부동산원 상권 구획도(최종상권368.shp, 서울=시도코드 11) → 72 상권 폴리곤.

rent_estimate가 ST_Contains(sg.geom, b.geom)로 건물↔상권 매칭에 사용(nm). 그동안 수동 업로드였던
것을 재현 가능한 로더로 스크립트화(재적재 시 소실 방지). 원본 CRS=Korea2000 Unified(EPSG:5179)→4326.
    data/.venv/bin/python scripts/sanggwon/load_sanggwon.py
검증(비파괴): SG_TABLE=master._sg_check 로 임시 테이블 적재 후 diff.
근거: specs/07-architecture/04-데이터-출처-크롤링-레지스트리 §2-D(구멍) · 원본 data.go.kr 15086933.
"""
import os
import shapefile
import psycopg
from shapely.geometry import shape
from shapely.ops import transform
from pyproj import Transformer

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")
SHP = os.path.join(os.path.dirname(__file__), "..", "..", "data", "raw", "상권구획도(업로드용)", "최종상권368")
TABLE = os.environ.get("SG_TABLE", "master.sanggwon")
_T = Transformer.from_crs(5179, 4326, always_xy=True)
_flag = lambda v: str(v).strip().upper() == "O"   # 유형 플래그: 'O'=참, ''=거짓


def rows():
    r = shapefile.Reader(SHP, encoding="cp949", encodingErrors="replace")
    fld = [f[0] for f in r.fields[1:]]
    ix = {k: fld.index(k) for k in fld}
    out = []
    for sr in r.shapeRecords():
        rec = sr.record
        if str(rec[ix["시도코드"]]).strip() != "11":     # 서울만
            continue
        geom = transform(lambda x, y, z=None: _T.transform(x, y), shape(sr.shape.__geo_interface__))
        out.append((str(rec[ix["상권명"]]).strip(), str(rec[ix["시도코드"]]).strip(),
                    _flag(rec[ix["소규모"]]), _flag(rec[ix["중대형"]]),
                    _flag(rec[ix["오피스"]]), _flag(rec[ix["집합"]]), geom.wkt))
    return out


def main():
    data = rows()
    print(f"서울 상권 {len(data)}개 파싱 (원본 최종상권368.shp, 시도코드 11)")
    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute(f"TRUNCATE {TABLE} RESTART IDENTITY")
        cur.executemany(
            f"INSERT INTO {TABLE}(nm,sido,small,mid,office,jip,geom) "
            f"VALUES(%s,%s,%s,%s,%s,%s, ST_GeomFromText(%s,4326))", data)
        conn.commit()
        cur.execute(f"SELECT count(*) FROM {TABLE}")
        print(f"적재 완료: {cur.fetchone()[0]}행 → {TABLE}")


if __name__ == "__main__":
    main()
