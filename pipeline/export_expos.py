#!/usr/bin/env python3
"""_expos.jsonl → unit.csv (호실 = 전유부). 적재 소스 'unit'.

좌표는 붙이지 않는다 — 호실은 건물 안의 위치라 점 하나로 찍을 수 없다.
지도가 필요하면 PNU 로 필지를 따라간다(건물·단지와 같은 규칙).

    python pipeline/export_expos.py --out data/exports/_load/unit.csv
"""
import argparse
import csv
import json
import os
import sys

COLUMNS = [
    "unit_pk", "pnu", "ledger_kind", "ledger_type", "addr", "road_addr", "bldg_name",
    "dong", "ho", "floor_kind", "floor", "floor_raw",
    "excl_area", "common_area", "main_use", "etc_use", "structure", "created_ymd",
]

K = {  # CSV 컬럼 → jsonl 키
    "unit_pk": "PK", "pnu": "PNU", "ledger_kind": "대장구분", "ledger_type": "대장종류",
    "addr": "주소", "road_addr": "도로명주소", "bldg_name": "건물명",
    "dong": "동명", "ho": "호명", "floor_kind": "층구분",
    "floor": "층", "floor_raw": "층원문",
    "excl_area": "전유면적", "common_area": "공용면적",
    "main_use": "용도", "etc_use": "기타용도", "structure": "구조",
    "created_ymd": "생성일자",
}


def norm_ymd(s):
    """YYYYMMDD → YYYY-MM-DD. 적재가 기대하는 형식."""
    s = (s or "").strip()
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) == 8 and s.isdigit() else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="data/tools/_expos.jsonl")
    ap.add_argument("--out", default="data/exports/_load/unit.csv")
    a = ap.parse_args()
    if not os.path.exists(a.src):
        sys.exit(f"✗ {a.src} 없음 — data/tools/build_expos.py 를 먼저 돌리세요")
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
            if len(row) != len(COLUMNS):     # 컬럼 추가 시 누락 방지
                sys.exit(f"열 개수 불일치: {len(row)} ≠ {len(COLUMNS)}")
            w.writerow(row)
            n += 1
    print(f"완료: {n:,}행 → {a.out}")


if __name__ == "__main__":
    main()
