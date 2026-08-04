#!/usr/bin/env python3
"""서울 전체 필지 export — 폴리곤(연속지적도) + 속성(_land_master) + 용도지역(_spatial_ALL)
+ 법정(_legal_ALL) + 규제(_regulations_11) + 대표-부속(_annex_ALL) → CSV 2개(parcels·building_parcels).

사용: python pipeline/export_parcels.py --parcels out1.csv --annex out2.csv
"""
import argparse
import csv
import json
import sys
import time
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'tools'))
from paths import LDREG

SHP = LDREG
LAND = "data/tools/_land_master.jsonl"
SPATIAL = "data/tools/_spatial_ALL.json"
LEGAL = "data/tools/_legal_ALL.json"
REGUL = "data/tools/_regulations_11.json"
ANNEX = "data/tools/_annex_ALL.json"
DB = "data/빌탐정.db"

PARCEL_COLS = ["pnu", "building_pk", "is_rep", "wkt", "area",
               "jimok", "land_use", "slope", "shape", "road_frontage",
               "use_zone", "legal_bcr", "legal_far", "gongsi_latest",
               "reg_godo", "reg_district", "reg_jeongbi", "reg_gyeong", "reg_banghwa", "reg_munhwa"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--parcels", required=True)
    ap.add_argument("--annex", required=True)
    args = ap.parse_args()

    print("1) 속성 로드…")
    land = {}
    for line in open(LAND):
        d = json.loads(line)
        g = d.get("공시지가") or {}
        latest = None
        if g:
            latest = g.get(max(g.keys()))
        land[d["PNU"]] = (d.get("지목"), d.get("면적"), d.get("토지이용상황"),
                          d.get("지세"), d.get("지형형상"), d.get("도로접면"), latest)
    print(f"  land_master {len(land):,}")

    spatial = json.load(open(SPATIAL))
    def yongdo(pnu: str):
        z = (spatial.get(pnu) or {}).get("용도지역")
        if not z:
            return None
        return z[0]["명"] if len(z) == 1 else " + ".join(f"{x['명']} {round(x['비중']*100)}%" for x in z)

    legal = json.load(open(LEGAL))
    regul = json.load(open(REGUL))
    annex = json.load(open(ANNEX))
    print(f"  spatial {len(spatial):,} · legal {len(legal):,} · regul {len(regul):,} · annex {len(annex):,}")

    # 대표 PNU → building_pk (빌탐정.db) + annex 부속 매핑
    import sqlite3
    con = sqlite3.connect(DB)
    rep_to_pk = {}
    for pk, pnu in con.execute("SELECT pk, pnu FROM buildings WHERE pnu IS NOT NULL"):
        rep_to_pk[pnu] = pk
    pnu_to_bldg: dict[str, tuple[str, str]] = {}   # pnu → (building_pk, role)
    for pnu, pk in rep_to_pk.items():
        pnu_to_bldg[pnu] = (pk, "대표")
    n_annex = 0
    with open(args.annex, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["building_pk", "pnu", "role"])
        for pk, rel in annex.items():
            for pnu in rel.get("전체", []):
                role = "대표" if pnu == rel.get("대표") else "부속"
                w.writerow([pk, pnu, role])
                if role == "부속" and pnu not in pnu_to_bldg:
                    pnu_to_bldg[pnu] = (pk, "부속")
                n_annex += 1
        # 단일필지 건물(annex에 없음)도 관계 1행
        for pnu, pk in rep_to_pk.items():
            if pk not in annex:
                w.writerow([pk, pnu, "대표"])
                n_annex += 1
    print(f"2) annex CSV {n_annex:,}행")

    print("3) 필지 폴리곤 + 조인 → CSV…")
    import shapefile
    from shapely.geometry import shape as shp_shape
    from shapely.ops import transform as shp_transform
    from pyproj import Transformer
    t = Transformer.from_crs(5174, 4326, always_xy=True)

    r = shapefile.Reader(SHP, encoding="cp949")
    idx = [f[0] for f in r.fields[1:]].index("PNU")
    n_out, t0 = 0, time.time()
    with open(args.parcels, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(PARCEL_COLS)
        for sr in r.iterShapeRecords():
            pnu = sr.record[idx]
            try:
                g = shp_shape(sr.shape.__geo_interface__)
                g4326 = shp_transform(lambda x, y, z=None: t.transform(x, y), g)
                wkt = g4326.wkt
            except Exception:
                continue
            la = land.get(pnu) or (None,) * 7
            bld = pnu_to_bldg.get(pnu) or (None, None)
            rg = regul.get(pnu) or {}
            jeongbi = rg.get("정비구역") or rg.get("재정비촉진")
            lg = legal.get(pnu) or {}
            w.writerow([
                pnu, bld[0] or "", "true" if bld[1] == "대표" else "false", wkt,
                la[1] or "", la[0] or "", la[2] or "", la[3] or "", la[4] or "", la[5] or "",
                yongdo(pnu) or "", lg.get("법정건폐율") or "", lg.get("법정용적률") or "",
                la[6] or "",
                rg.get("고도지구") or "", rg.get("지구단위계획") or "", jeongbi or "",
                rg.get("경관지구") or "", rg.get("방화지구") or "", rg.get("문화재보존") or "",
            ])
            n_out += 1
            if n_out % 100_000 == 0:
                print(f"  {n_out:,} ({time.time()-t0:.0f}s)")
    print(f"완료: parcels {n_out:,}행")
    return 0


if __name__ == "__main__":
    sys.exit(main())
