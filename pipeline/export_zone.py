#!/usr/bin/env python3
"""_zone.jsonl → zone.csv (건물별 지역·지구·구역). 적재 소스 'zone'.

배열 칸(zones·districts·areas)은 **PostgreSQL 배열 리터럴**로 낸다 — `{"a","b"}`.
값에 쉼표·따옴표가 들어갈 수 있어(「제1종지구단위계획구역, 도시계획시설」) 반드시 따옴표로 감싼다.

    python pipeline/export_zone.py --out data/exports/_load/zone.csv
"""
import argparse
import csv
import json
import os
import sys

COLUMNS = ["building_pk", "pnu", "addr", "road_addr", "sgg_code", "bjd_code",
           "use_zone", "use_district", "use_area", "zones", "districts", "areas",
           "created_ymd"]

K = {"building_pk": "PK", "pnu": "PNU", "addr": "주소", "road_addr": "도로명주소",
     "sgg_code": "시군구코드", "bjd_code": "법정동코드",
     "use_zone": "대표지역", "use_district": "대표지구", "use_area": "대표구역",
     "zones": "지역", "districts": "지구", "areas": "구역", "created_ymd": "생성일자"}
ARRAYS = {"zones", "districts", "areas"}


def pg_array(vals):
    """['a','b'] → {"a","b"} · 빈 것은 빈칸(NULL 로 적재)."""
    if not vals:
        return ""
    esc = [v.replace("\\", "\\\\").replace('"', '\\"') for v in vals]
    return "{" + ",".join(f'"{v}"' for v in esc) + "}"


def norm_ymd(s):
    s = (s or "").strip()
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) == 8 and s.isdigit() else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="data/tools/_zone.jsonl")
    ap.add_argument("--out", default="data/exports/_load/zone.csv")
    a = ap.parse_args()
    if not os.path.exists(a.src):
        sys.exit(f"✗ {a.src} 없음 — data/tools/build_zone.py 를 먼저 돌리세요")
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
                if c in ARRAYS:
                    v = pg_array(v)
                elif c.endswith("_ymd"):
                    v = norm_ymd(v)
                row.append("" if v is None else v)
            if len(row) != len(COLUMNS):
                sys.exit(f"열 개수 불일치: {len(row)} ≠ {len(COLUMNS)}")
            w.writerow(row)
            n += 1
    print(f"완료: {n:,}행 → {a.out}")


if __name__ == "__main__":
    main()
