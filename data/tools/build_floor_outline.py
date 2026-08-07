#!/usr/bin/env python3
"""층별개요(mart_djy_04) → 층별 프리필 CSV.
컬럼: PK idx0 · 층 idx21 · 용도 idx26 · 전용면적 idx28(㎡). 건물당 여러 층 행.
출력: floor_outline.csv (building_pk, seq, floor, floor_raw, use, exclusive_area) → master.floor_outline.

층 표기는 원본이 제각각이라(같은 3층이 '3층'·'3'·'지상3층'·'삼층') floor_label로 통일한다.
문자열로 층을 맞추는 곳이 전부 어긋났었다 — 원본은 floor_raw에 보존.
"""
import sys, csv, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from floor_label import normalize

IN = "data/raw/seoul/mart_djy_04_seoul.txt"
OUT = sys.argv[1] if len(sys.argv) > 1 else "data/tools/_floor_outline.csv"


def main():
    w = csv.writer(open(OUT, "w", newline=""))
    w.writerow(["building_pk", "seq", "floor", "floor_raw", "use", "exclusive_area"])
    seq: dict[str, int] = {}
    n = 0
    with open(IN, "rb") as f:
        for line in f:
            c = [x.decode("utf-8", errors="replace") for x in line.rstrip(b"\r\n").split(b"|")]
            if len(c) < 29:
                continue
            pk = c[0].strip()
            if not pk:
                continue
            floor_raw, use, area = c[21].strip(), c[26].strip(), c[28].strip()
            floor, _kind = normalize(floor_raw)
            s = seq.get(pk, 0)
            seq[pk] = s + 1
            w.writerow([pk, s, floor or floor_raw, floor_raw, use, area])
            n += 1
    print(f"층별개요 {n:,}행 · {len(seq):,}건물 → {OUT}")


if __name__ == "__main__":
    main()
