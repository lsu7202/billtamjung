#!/usr/bin/env python3
"""_complex.jsonl → complex.csv (총괄표제부 = 단지). 적재 소스 'complex'.

좌표는 붙이지 않는다 — 단지는 필지 여럿에 걸치고, 대표 한 점을 찍으면 그게 정확한 자리로
읽힌다. 위치가 필요하면 building_parcels 로 필지를 따라가면 된다(건물과 같은 규칙).

    python pipeline/export_complex.py --out data/exports/_load/complex.csv
"""
import argparse
import csv
import json
import os
import sys

COLUMNS = [
    "complex_pk", "ledger_kind", "pnu", "addr", "addr_full", "road_addr", "name",
    "sgg_code", "bjd_code",
    "land_area", "build_area", "bcr", "total_area", "far_area", "far",
    "main_use", "main_use_name", "etc_use",
    "households", "families", "main_bldg_cnt", "annex_bldg_cnt", "parking",
    "permit_ymd", "start_ymd", "approval_ymd",
]

K = {  # CSV 컬럼 → jsonl 키
    "complex_pk": "PK", "ledger_kind": "대장구분", "pnu": "PNU", "addr": "주소",
    "addr_full": "주소완전",
    "road_addr": "도로명주소", "name": "단지명", "sgg_code": "시군구코드", "bjd_code": "법정동코드",
    "land_area": "대지면적", "build_area": "건축면적", "bcr": "건폐율",
    "total_area": "연면적", "far_area": "용적률산정연면적", "far": "용적률",
    "main_use": "주용도코드", "main_use_name": "주용도", "etc_use": "기타용도",
    "households": "세대수", "families": "가구수",
    "main_bldg_cnt": "주건축물수", "annex_bldg_cnt": "부속건축물수", "parking": "주차",
    "permit_ymd": "허가일", "start_ymd": "착공일", "approval_ymd": "사용승인일",
}


def norm_ymd(s):
    """YYYYMMDD → YYYY-MM-DD. 적재가 기대하는 형식(buildings 와 같은 규칙)."""
    s = (s or "").strip()
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) == 8 and s.isdigit() else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="data/tools/_complex.jsonl")
    ap.add_argument("--out", default="data/exports/_load/complex.csv")
    a = ap.parse_args()
    if not os.path.exists(a.src):
        sys.exit(f"✗ {a.src} 없음 — data/tools/build_complex.py 를 먼저 돌리세요")
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    n = 0
    with open(a.out, "w", newline="", encoding="utf-8") as fo:
        w = csv.writer(fo)
        w.writerow(COLUMNS)
        for line in open(a.src, encoding="utf-8"):
            r = json.loads(line)
            row = []
            for c in COLUMNS:
                v = r.get(K[c])
                if c.endswith("_ymd"):
                    v = norm_ymd(v)
                elif c == "addr_full":
                    v = "1" if v else "0"
                row.append("" if v is None else v)
            if len(row) != len(COLUMNS):     # 컬럼 추가 시 writerow 누락 방지
                sys.exit(f"열 개수 불일치: {len(row)} ≠ {len(COLUMNS)}")
            w.writerow(row)
            n += 1
    print(f"완료: {n:,}행 → {a.out}")


if __name__ == "__main__":
    main()
