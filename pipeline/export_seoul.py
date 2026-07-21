#!/usr/bin/env python3
"""서울 전체 buildings CSV export — 빌탐정.db(586,343동) + 연속지적도 centroid + 공시지가/매각 최신.

산출: loader용 CSV(0006 확장 스키마 컬럼 순서).
사용: python pipeline/export_seoul.py --out /tmp/seoul_buildings.csv
     (data/.venv 필요: pyshp·pyproj·shapely)
"""
import argparse
import csv
import json
import sqlite3
import sys
import time

DB = "data/빌탐정.db"
SHP = "data/raw/LSMD_CONT_LDREG_5174_서울/LSMD_CONT_LDREG_5174_11_202606"

COLUMNS = [
    "building_pk", "addr", "jibun_norm", "lng", "lat",
    "road_addr", "pnu", "sgg_code", "bjd_code",
    "land_area", "total_area", "floors_above", "floors_below", "bcr", "far",
    "main_use", "main_use_name", "etc_use", "structure",
    "approval_ymd", "remodel_ymd",
    "jimok", "parcel_area", "land_use", "use_zone", "use_zone_mix",
    "slope", "shape", "road_frontage", "station_dist", "subway_json", "bus_json",
    "gongsi_latest", "last_sale_ym", "last_sale_price",
]


def load_centroids() -> dict:
    """서울 전 필지 PNU → (경도, 위도). 연속지적도 5174 → WGS84."""
    import shapefile
    from pyproj import Transformer
    from shapely.geometry import shape as shp_shape

    t = Transformer.from_crs(5174, 4326, always_xy=True)
    r = shapefile.Reader(SHP, encoding="cp949")
    idx = [f[0] for f in r.fields[1:]].index("PNU")
    out, n, t0 = {}, 0, time.time()
    for sr in r.iterShapeRecords():
        pnu = sr.record[idx]
        try:
            c = shp_shape(sr.shape.__geo_interface__).representative_point()
            lon, lat = t.transform(c.x, c.y)
            out[pnu] = (round(lon, 6), round(lat, 6))
        except Exception:
            continue
        n += 1
        if n % 100_000 == 0:
            print(f"  centroid {n:,} ({time.time()-t0:.0f}s)")
    print(f"  centroid 완료: {len(out):,}필지 ({time.time()-t0:.0f}s)")
    return out


def norm_ymd(v: str | None) -> str:
    """'19710217' → '1971-02-17'. 불량/빈값 → ''."""
    if not v or len(str(v)) != 8 or not str(v).isdigit():
        return ""
    s = str(v)
    if s[:2] not in ("18", "19", "20") or not ("01" <= s[4:6] <= "12"):
        return ""
    return f"{s[:4]}-{s[4:6]}-{s[6:]}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=0, help="테스트용 상한(0=전체)")
    args = ap.parse_args()

    print("1) 연속지적도 centroid 로드(서울 전체)…")
    coords = load_centroids()

    print("2) 공시지가 최신·매각 최근 로드…")
    con = sqlite3.connect(DB)
    gongsi = dict(con.execute(
        "SELECT pnu, 공시지가 FROM prices p WHERE 연도=(SELECT max(연도) FROM prices WHERE pnu=p.pnu)"
    ))
    print(f"  공시지가 {len(gongsi):,}필지")
    last_sale = {}
    for pk, ym, amt in con.execute(
        "SELECT pk, 계약년월, 금액 FROM sales s WHERE 계약년월=(SELECT max(계약년월) FROM sales WHERE pk=s.pk)"
    ):
        last_sale[pk] = (ym, amt)
    print(f"  매각 {len(last_sale):,}건물")

    print("3) buildings 조인 → CSV…")
    q = "SELECT * FROM buildings" + (f" LIMIT {args.limit}" if args.limit else "")
    cur = con.execute(q)
    cols = [d[0] for d in cur.description]
    ci = {c: i for i, c in enumerate(cols)}

    n_out = n_nocoord = 0
    with open(args.out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(COLUMNS)
        for row in cur:
            pnu = row[ci["pnu"]]
            xy = coords.get(pnu)
            if not xy:
                n_nocoord += 1
                continue                      # 좌표 없으면 제외(지도 필수)
            pk = row[ci["pk"]]
            addr = row[ci["주소"]] or ""
            sale = last_sale.get(pk, ("", ""))
            w.writerow([
                pk, addr, addr.replace("서울특별시 ", "").replace(" ", "").replace("번지", ""),
                xy[0], xy[1],
                row[ci["도로명주소"]] or "", pnu,
                row[ci["시군구코드"]] or "", row[ci["법정동코드"]] or "",
                row[ci["대지면적"]] or "", row[ci["연면적"]] or "",
                row[ci["지상층수"]] or "", row[ci["지하층수"]] or "",
                row[ci["건폐율"]] or "", row[ci["용적률"]] or "",
                row[ci["주용도코드"]] or "", row[ci["주용도"]] or "",
                row[ci["기타용도"]] or "", row[ci["구조"]] or "",
                norm_ymd(row[ci["사용승인일"]]), norm_ymd(row[ci["최근대수선일"]]),
                row[ci["지목"]] or "", row[ci["토지면적"]] or "",
                row[ci["토지이용상황"]] or "", row[ci["용도지역"]] or "",
                row[ci["용도지역_걸침"]] or "",
                row[ci["지세"]] or "", row[ci["지형형상"]] or "",
                row[ci["도로접면"]] or "", row[ci["역과의거리"]] or "",
                row[ci["주변지하철"]] or "", row[ci["주변버스"]] or "",
                gongsi.get(pnu, ""), sale[0], sale[1],
            ])
            n_out += 1
            if n_out % 100_000 == 0:
                print(f"  {n_out:,}행…")
    print(f"완료: {n_out:,}행 출력 · 좌표없음 제외 {n_nocoord:,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
