"""master.sanggwon 적재 — 부동산원 상권 구획도(최종상권368.shp, 서울=시도코드 11) → 72 상권 폴리곤.

rent_estimate가 ST_Contains(sg.geom, b.geom)로 건물↔상권 매칭에 사용(nm). 그동안 수동 업로드였던
것을 재현 가능한 로더로 스크립트화(재적재 시 소실 방지). 원본 CRS=Korea2000 Unified(EPSG:5179)→4326.
    data/.venv/bin/python scripts/sanggwon/load_sanggwon.py
검증(비파괴): SG_TABLE=master._sg_check 로 임시 테이블 적재 후 diff.
근거: specs/07-architecture/04-데이터-출처-크롤링-레지스트리 §2-D(구멍) · 원본 data.go.kr 15086933.
"""
import glob
import os
import shapefile
import psycopg
from shapely.geometry import shape
from shapely.ops import transform
from pyproj import Transformer

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")
# 판마다 파일 이름이 바뀐다(최종상권368 → 상권구획도2024). 폴더의 .shp 하나를 집는다
_SGDIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "raw", "상권구획도(업로드용)")
SHP = (sorted(glob.glob(os.path.join(_SGDIR, "*.shp")))[-1][:-4]
       if glob.glob(os.path.join(_SGDIR, "*.shp")) else os.path.join(_SGDIR, "최종상권368"))
TABLE = os.environ.get("SG_TABLE", "master.sanggwon")
def _srid() -> int:
    """원본 좌표계는 .prj 가 말한다 — 판마다 다르다(2026-09-07).

    옛 판(최종상권368)은 Korea2000 Unified(5179), 2024 판은 웹 메르카토르(3857)다.
    5179 로 고정해 읽었더니 2024 판이 태평양 한가운데(-149.9, 12.3)로 갔다.
    """
    prj = SHP + ".prj"
    if not os.path.exists(prj):
        return 5179
    t = open(prj, encoding="utf-8", errors="replace").read()
    if "Web_Mercator" in t or "3857" in t or "Pseudo-Mercator" in t:
        return 3857
    if "Korea_2000" in t or "5179" in t or "Unified" in t:
        return 5179
    return 5179


_T = Transformer.from_crs(_srid(), 4326, always_xy=True)
_flag = lambda v: str(v).strip().upper() == "O"   # 유형 플래그: 'O'=참, ''=거짓


def _seoul_names() -> set[str]:
    """서울 상권 이름 — 임대동향 시계열(부동산원)이 아는 이름을 그대로 쓴다.

    2024 판에는 시도 코드 칸이 없다(year·sec_seq·sec_nm·buld_nm 넷뿐). 전국 368칸 중
    서울을 가르는 유일한 길이 이름이라, 시계열 표의 상권 이름으로 고른다.
    """
    import psycopg
    with psycopg.connect(DSN) as c, c.cursor() as cur:
        cur.execute("SELECT DISTINCT sanggwon FROM master.sanggwon_rent_series")
        got = {r[0].strip() for r in cur if r[0]}
        # 시계열에 표본이 없어 빠진 상권도 폴리곤은 남긴다(노원역·명일역·한티역)
        cur.execute("SELECT nm FROM master.sanggwon")
        got |= {r[0].strip() for r in cur if r[0]}
    return got


def rows():
    # 인코딩은 .cpg 가 말한다 — 옛 판은 cp949, 2024 판은 UTF-8 이다(2026-09-07)
    enc = "utf-8"
    cpg = SHP + ".cpg"
    if os.path.exists(cpg):
        enc = open(cpg).read().strip().lower().replace("utf-8", "utf-8") or "utf-8"
    r = shapefile.Reader(SHP, encoding=enc, encodingErrors="replace")
    fld = [f[0] for f in r.fields[1:]]
    ix = {k: fld.index(k) for k in fld}
    # 판마다 칸 이름이 다르다: 옛 판 상권명/시도코드/소규모…, 2024 판 sec_nm/buld_nm
    nm_key = "상권명" if "상권명" in ix else "sec_nm"
    seoul = _seoul_names() if "시도코드" not in ix else None
    out = []
    for sr in r.shapeRecords():
        rec = sr.record
        nm = str(rec[ix[nm_key]]).strip()
        if seoul is None:
            if str(rec[ix["시도코드"]]).strip() != "11":     # 서울만
                continue
            flags = (_flag(rec[ix["소규모"]]), _flag(rec[ix["중대형"]]),
                     _flag(rec[ix["오피스"]]), _flag(rec[ix["집합"]]))
            sido = str(rec[ix["시도코드"]]).strip()
        else:
            if nm not in seoul:
                continue
            # 2024 판은 유형을 buld_nm 한 칸에 쉼표로 모아 둔다
            kinds = {k.strip() for k in str(rec[ix["buld_nm"]]).split(",")}
            flags = ("소규모" in kinds, "중대형" in kinds, "오피스" in kinds, "집합" in kinds)
            sido = "11"
        geom = transform(lambda x, y, z=None: _T.transform(x, y), shape(sr.shape.__geo_interface__))
        out.append((nm, sido, *flags, geom.wkt))
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
