#!/usr/bin/env python3
"""층별개요(mart_djy_04) → 층별 프리필 CSV.
컬럼: PK idx0 · 층 idx21 · 용도 idx26 · 전용면적 idx28(㎡). 건물당 여러 층 행.
출력: floor_outline.csv (building_pk, seq, floor, use, exclusive_area) → \\copy로 master.floor_outline 적재.
"""
import sys, csv

IN = "data/raw/seoul/mart_djy_04_seoul.txt"
OUT = sys.argv[1] if len(sys.argv) > 1 else "data/tools/_floor_outline.csv"


def main():
    w = csv.writer(open(OUT, "w", newline=""))
    w.writerow(["building_pk", "seq", "floor", "use", "exclusive_area"])
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
            floor, use, area = c[21].strip(), c[26].strip(), c[28].strip()
            s = seq.get(pk, 0)
            seq[pk] = s + 1
            w.writerow([pk, s, floor, use, area])
            n += 1
    print(f"층별개요 {n:,}행 · {len(seq):,}건물 → {OUT}")


if __name__ == "__main__":
    main()
