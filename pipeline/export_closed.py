#!/usr/bin/env python3
"""_closed.jsonl → closed.csv (폐쇄말소대장). 적재 소스 'closed'.

    python pipeline/export_closed.py --out data/exports/_load/closed.csv
"""
import argparse
import csv
import json
import os
import sys

COLUMNS = ["closed_pk", "pnu", "close_kind", "close_ymd", "ledger_kind", "ledger_type",
           "addr", "road_addr", "bldg_name", "dong", "sgg_code", "bjd_code",
           "land_area", "build_area", "bcr", "total_area", "far_area", "far",
           "structure", "main_use", "main_use_name", "etc_use",
           "floors_above", "floors_below", "height",
           "households", "families", "ho_cnt",
           "permit_ymd", "start_ymd", "approval_ymd", "created_ymd"]

K = {"closed_pk": "PK", "pnu": "PNU", "close_kind": "폐쇄구분", "close_ymd": "폐쇄일",
     "ledger_kind": "대장구분", "ledger_type": "대장종류",
     "addr": "주소", "road_addr": "도로명주소", "bldg_name": "건물명", "dong": "동명",
     "sgg_code": "시군구코드", "bjd_code": "법정동코드",
     "land_area": "대지면적", "build_area": "건축면적", "bcr": "건폐율",
     "total_area": "연면적", "far_area": "용적률산정연면적", "far": "용적률",
     "structure": "구조", "main_use": "주용도코드", "main_use_name": "주용도",
     "etc_use": "기타용도",
     "floors_above": "지상층수", "floors_below": "지하층수", "height": "높이",
     "households": "세대수", "families": "가구수", "ho_cnt": "호수",
     "permit_ymd": "허가일", "start_ymd": "착공일", "approval_ymd": "사용승인일",
     "created_ymd": "생성일자"}


def norm_ymd(s):
    s = (s or "").strip()
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) == 8 and s.isdigit() else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="data/tools/_closed.jsonl")
    ap.add_argument("--out", default="data/exports/_load/closed.csv")
    a = ap.parse_args()
    if not os.path.exists(a.src):
        sys.exit(f"✗ {a.src} 없음 — data/tools/build_closed.py 를 먼저 돌리세요")
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
                row.append("" if v is None else v)
            if len(row) != len(COLUMNS):
                sys.exit(f"열 개수 불일치: {len(row)} ≠ {len(COLUMNS)}")
            w.writerow(row)
            n += 1
    print(f"완료: {n:,}행 → {a.out}")


if __name__ == "__main__":
    main()
