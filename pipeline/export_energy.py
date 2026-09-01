#!/usr/bin/env python3
"""_energy.jsonl → energy.csv (건물에너지 전기·가스). 적재 소스 'energy'.

    python pipeline/export_energy.py --out data/exports/_load/energy.csv
"""
import argparse
import csv
import json
import os
import sys
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))),
                                  "data", "tools"))
from build_report import Report   # noqa: E402

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
    doc = Report("export_energy", src="_energy.jsonl → energy.csv")
    # 처리결과 문서 — export 단계도 줄이 샐 수 있다. loader 의 행수 검증은 **DB 의 옛 판**과
    # 견주는 것이라, 빌더가 낸 줄과 CSV 로 나간 줄이 어긋나도 그 차이가 작으면 안 걸린다.
    # 여기서 읽은 줄과 낸 줄을 맞춰 두면 그 틈이 없어진다(2026-09-01).
    n = 0
    with open(a.out, "w", newline="", encoding="utf-8") as fo:
        w = csv.writer(fo)
        w.writerow(COLUMNS)
        for line in open(a.src, encoding="utf-8"):
            doc.read()
            r = json.loads(line)
            row = ["" if r.get(K[c]) is None else r.get(K[c]) for c in COLUMNS]
            if len(row) != len(COLUMNS):
                sys.exit(f"열 개수 불일치: {len(row)} ≠ {len(COLUMNS)}")
            w.writerow(row)
            n += 1
            doc.write()
    doc.finish()
    print(f"완료: {n:,}행 → {a.out}")


if __name__ == "__main__":
    main()
