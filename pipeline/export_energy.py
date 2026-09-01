#!/usr/bin/env python3
"""_energy.jsonl → energy.csv (건물에너지 전기·가스). 적재 소스 'energy'.

    python pipeline/export_energy.py --out data/exports/_load/energy.csv
"""
import argparse
import csv
import json
import os
import sys

COLUMNS = ["pnu", "addr_seq", "kind", "use_ym", "usage_kwh",
           "addr", "road_addr", "sgg_code", "bjd_code"]

K = {"pnu": "PNU", "addr_seq": "새주소일련번호", "kind": "종류", "use_ym": "사용년월",
     "usage_kwh": "사용량", "addr": "주소", "road_addr": "도로명주소",
     "sgg_code": "시군구코드", "bjd_code": "법정동코드"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="data/tools/_energy.jsonl")
    ap.add_argument("--out", default="data/exports/_load/energy.csv")
    a = ap.parse_args()
    if not os.path.exists(a.src):
        sys.exit(f"✗ {a.src} 없음 — data/tools/build_energy.py 를 먼저 돌리세요")
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    n = 0
    with open(a.out, "w", newline="", encoding="utf-8") as fo:
        w = csv.writer(fo)
        w.writerow(COLUMNS)
        for line in open(a.src, encoding="utf-8"):
            r = json.loads(line)
            row = ["" if r.get(K[c]) is None else r.get(K[c]) for c in COLUMNS]
            if len(row) != len(COLUMNS):
                sys.exit(f"열 개수 불일치: {len(row)} ≠ {len(COLUMNS)}")
            w.writerow(row)
            n += 1
    print(f"완료: {n:,}행 → {a.out}")


if __name__ == "__main__":
    main()
