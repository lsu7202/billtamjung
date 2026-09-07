#!/usr/bin/env python3
"""서울 전체 필지 export — 폴리곤(연속지적도) + 속성(_land_master) + 용도지역(_spatial_ALL)
+ 대표-부속(_annex_ALL) → CSV 2개(parcels·building_parcels).

## 용도지역·법정건폐/용적·규제는 여기서 안 낸다 (2026-09-01)

옛날엔 공간조인(연속지적도 ∩ 용도지역 폴리곤)으로 **계산**해서 실었다. 지금은 국토부
토지이용계획정보 원장(AL_D155)이 필지마다 직접 적어 주고, 그게 정본이다
(scripts/load_parcel_luris.py 가 적재 뒤에 붙인다).

계산분을 그대로 두면 **원장에 없는 필지에 우리가 지어낸 값이 남는다.** 실측으로 확인했다:

    원장과 값이 같음   892,425 필지
    원장과 값이 다름     3,005 필지  ← 전부 우리가 틀렸다
    우리에게만 있음      1,479 필지  ← 전부 지어낸 값

토지이음에서 직접 확인한 셋:
    종로구 예지동 213-2  지목 하천 · 용도지역 없음   → 우리는 60%/800% 를 넣었다
    종로구 교북동 5-61   지목 도로 · 종(種) 없음     → 우리는 60%/200%
    종로구 창신동 170-1  필지 자체가 검색 안 됨      → 우리는 60%/491%

예지동 213-2 는 원인까지 화면에 보인다. 확인도면 **범례**에 일반상업지역이 있다 —
주변 폴리곤이 필지 위에 겹쳐 그려지는 것인데, 공간조인이 그걸 이 필지의 용도지역으로
읽었다. 토지이음은 「지역지구등 지정여부」에 그걸 안 쓴다.

그래서 칸은 남기되 **빈칸으로 내보낸다.** 채우는 것은 원장의 일이다.

사용: python pipeline/export_parcels.py --parcels out1.csv --annex out2.csv
"""
import argparse
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))),
                                  "data", "tools"))
from build_report import Report   # noqa: E402
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
ANNEX = "data/tools/_annex_ALL.json"
DB = "data/빌탐정.db"

PARCEL_COLS = ["pnu", "building_pk", "is_rep", "wkt", "area",
               "jimok", "land_use", "slope", "shape", "road_frontage",
               "use_zone", "legal_bcr", "legal_far", "gongsi_latest"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--parcels", required=True)
    ap.add_argument("--annex", required=True)
    # 필지 단위(반기)가 대장 빌드 없이 혼자 돌 때는 SQLite(빌탐정.db)가 없다.
    # 그때는 살아 있는 master.buildings 에서 PK 를 가져온다(2026-09-07). 대장 빌드 안에서는
    # 새 건물이 아직 DB 에 없으므로 SQLite 가 맞다 — 기본값은 그대로 둔다.
    ap.add_argument("--pk-from-db", action="store_true",
                    help="building_pk 를 SQLite 대신 살아 있는 master.buildings 에서")
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
    def yongdo(pnu: str):          # noqa: F811 — 2026-09-01 부터 안 쓴다(원장이 정본). 산식 근거로 남긴다
        z = (spatial.get(pnu) or {}).get("용도지역")
        if not z:
            return None
        return z[0]["명"] if len(z) == 1 else " + ".join(f"{x['명']} {round(x['비중']*100)}%" for x in z)

    annex = json.load(open(ANNEX))
    print(f"  spatial {len(spatial):,} · annex {len(annex):,}")

    # 대표 PNU → building_pk + annex 부속 매핑
    rep_to_pk = {}
    if args.pk_from_db:
        import psycopg
        dsn = os.environ.get("BT_DATABASE_URL") or os.environ.get(
            "DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")
        with psycopg.connect(dsn) as pc, pc.cursor() as cur:
            cur.execute("SELECT building_pk, pnu FROM master.buildings WHERE pnu IS NOT NULL")
            for pk, pnu in cur:
                rep_to_pk[pnu] = pk
        print(f"  building_pk ← master.buildings {len(rep_to_pk):,}")
    else:
        import sqlite3
        con = sqlite3.connect(DB)
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
    # 처리결과 문서 — 도형을 못 읽으면 조용히 건너뛰던 자리가 있었다.
    doc = Report("export_parcels", src="연속지적도 + _land_master + _annex_ALL")
    n_out, t0 = 0, time.time()
    with open(args.parcels, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(PARCEL_COLS)
        for sr in r.iterShapeRecords():
            doc.read()
            pnu = sr.record[idx]
            try:
                g = shp_shape(sr.shape.__geo_interface__)
                g4326 = shp_transform(lambda x, y, z=None: t.transform(x, y), g)
                wkt = g4326.wkt
            except Exception:
                doc.drop("필지 도형을 못 읽음", pnu); continue
            la = land.get(pnu) or (None,) * 7
            bld = pnu_to_bldg.get(pnu) or (None, None)
            # 용도지역·법정건폐/용적은 **빈칸으로 둔다** — 원장(load_parcel_luris.py)이 적재 뒤에 채운다.
            # 여기서 계산해 넣으면 원장이 모르는 필지에 지어낸 값이 남는다.
            # 규제 여섯 칸(reg_*)과 uqa 는 2026-09-07 에 걷어냈다 — 정본은 parcels.regulations 하나다.
            w.writerow([
                pnu, bld[0] or "", "true" if bld[1] == "대표" else "false", wkt,
                la[1] or "", la[0] or "", la[2] or "", la[3] or "", la[4] or "", la[5] or "",
                "", "", "",
                la[6] or "",
            ])
            n_out += 1
            doc.write()
            if n_out % 100_000 == 0:
                print(f"  {n_out:,} ({time.time()-t0:.0f}s)")
    doc.also_read("_annex_ALL.json(건물)", len(annex))
    doc.note(f"대표-부속 관계 {n_annex:,}행 → {args.annex}")
    doc.finish()
    print(f"완료: parcels {n_out:,}행")
    return 0


if __name__ == "__main__":
    sys.exit(main())
