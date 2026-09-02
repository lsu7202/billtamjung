"""master.trade_area 적재 — 서울시 상권분석서비스(영역-상권) 1,650개 폴리곤.

**왜 필요한가.** 지금 쓰는 부동산원 상권(master.sanggwon)은 서울 전체를 **72칸**으로 나눈다.
그래서 같은 상권 안 건물은 우리 산식이 전부 같은 값을 매긴다. 실측(마포 망원동)에서
33m 떨어진 두 건물의 호가가 2.2배 갈렸는데, 우리 데이터로는 도로접면·생활인구·공시지가가
전부 사실상 같았다. 갈린 이유는 **A가 망원시장 도로에 접하고 B는 아니라는 것**이었다.

이 데이터는 서울을 **1,650칸**으로 나누고, 무엇보다 **유형을 구분한다**:

    R 전통시장 305 · D 발달상권 249 · A 골목상권 1,090 · U 관광특구 6

전통시장이 폴리곤으로 따로 있으니 「이 건물이 시장 구역 안인가」를 직접 판정할 수 있다.
중심점만으로는 안 된다 — 망원시장 중심에서 A는 141m, B는 134m 로 **B가 더 가깝다.**
시장은 길게 늘어선 모양이라 원으로 근사하면 방향이 뒤집힌다.

출처: 서울 열린데이터광장 OA-15560(서울신용보증재단) · 공공누리 1유형(출처표시).
원본 CRS = **EPSG:5181**(Korea 2000 중부원점, falseNorthing 500000) → 4326.
.prj 파일에는 「Korea_2000_Korea_Central_Belt」라고만 적혀 있어 5186 으로 읽기 쉬운데,
5186 으로 변환하면 위도가 0.9도(약 100km) 남쪽으로 밀린다 — 망원동이 36.65 로 나온다.
데이터 제공 페이지가 5181 이라고 명시하고 있고, 그 값이 실제 위치와 맞는다(37.556).

    data/.venv/bin/python scripts/sanggwon/load_seoul_trade_area.py
검증(비파괴): TA_TABLE=master._ta_check 로 임시 적재 후 대조.
"""
import os

import psycopg
import shapefile
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")
SHP = os.path.join(os.path.dirname(__file__), "..", "..", "data", "raw",
                   "서울시 상권분석서비스(영역-상권)", "sanggwon")
TABLE = os.environ.get("TA_TABLE", "master.trade_area")
_T = Transformer.from_crs(5181, 4326, always_xy=True)   # 위 주석 참조 — .prj 만 믿으면 안 된다

# 상권_구분_코드 → 뜻. 전통시장(R)이 이 데이터를 받은 이유다.
KIND = {"A": "골목상권", "D": "발달상권", "R": "전통시장", "U": "관광특구"}

DDL = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
  code   text PRIMARY KEY,          -- 상권_코드
  nm     text NOT NULL,             -- 상권_코드_명 (예: 망원시장)
  kind   text NOT NULL,             -- A·D·R·U
  kind_nm text NOT NULL,            -- 골목상권·발달상권·전통시장·관광특구
  gu     text,                      -- 자치구 코드
  area_m2 double precision,         -- 영역_면적(㎡)
  geom   geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS trade_area_geom_idx ON {TABLE} USING gist (geom);
CREATE INDEX IF NOT EXISTS trade_area_kind_idx ON {TABLE} (kind);
"""


def rows():
    r = shapefile.Reader(SHP, encoding="cp949", encodingErrors="replace")
    fld = [f[0] for f in r.fields[1:]]
    print(f"  컬럼: {fld}")
    ix = {k: i for i, k in enumerate(fld)}

    def pick(*names):
        for n in names:
            if n in ix:
                return ix[n]
        return None

    i_code = pick("TRDAR_CD", "상권_코드")
    i_nm = pick("TRDAR_CD_N", "TRDAR_CD_NM", "상권_코드_명")
    i_kind = pick("TRDAR_SE_C", "상권_구분_코드")
    i_gu = pick("SIGNGU_CD", "자치구_코드")
    i_area = pick("RELM_AR", "영역_면적")
    out = []
    for sr in r.shapeRecords():
        rec = sr.record
        g = shape(sr.shape.__geo_interface__)
        g = transform(lambda x, y, z=None: _T.transform(x, y), g)
        if g.geom_type == "Polygon":
            from shapely.geometry import MultiPolygon
            g = MultiPolygon([g])
        k = str(rec[i_kind]).strip() if i_kind is not None else ""
        out.append((str(rec[i_code]).strip() if i_code is not None else "",
                    str(rec[i_nm]).strip() if i_nm is not None else "",
                    k, KIND.get(k, k),
                    str(rec[i_gu]).strip() if i_gu is not None else None,
                    float(rec[i_area]) if i_area is not None and rec[i_area] not in ("", None) else None,
                    g.wkt))
    return out


def main():
    print(f"SHP 읽는 중 — {SHP}")
    data = rows()
    print(f"  상권 {len(data):,}개")
    from collections import Counter
    print(f"  유형별 {dict(Counter(f'{d[2]}({d[3]})' for d in data))}")

    with psycopg.connect(DSN, autocommit=True) as c:
        c.execute(DDL)
        c.execute(f"TRUNCATE {TABLE}")
        with c.cursor() as cur:
            cur.executemany(
                f"INSERT INTO {TABLE}(code,nm,kind,kind_nm,gu,area_m2,geom)"
                f" VALUES(%s,%s,%s,%s,%s,%s, ST_Multi(ST_GeomFromText(%s,4326)))"
                f" ON CONFLICT (code) DO NOTHING", data)
        n = c.execute(f"SELECT count(*) FROM {TABLE}").fetchone()[0]
        print(f"  적재 {n:,}개")
        for k, ko in KIND.items():
            m = c.execute(f"SELECT count(*) FROM {TABLE} WHERE kind=%s", (k,)).fetchone()[0]
            print(f"    {ko} {m}")


if __name__ == "__main__":
    main()
