#!/usr/bin/env python3
"""개별공시지가 시계열 → gongsi_series.csv (pnu,year,price). **공시지가 단위의 빌더.**

## 왜 따로 떼었나 (2026-09-07)

공시지가는 **연 1회(5월 말)** 갱신되는 별도 원천인데, 지금까지는 `build_land_master.py` 안의
한 함수로 들어 있었다. 그 함수를 부르려면 `_spatial_ALL.json`(공간 조인 결과)이 있어야 하고,
그건 대장 빌드 1단계다. 결국 **공시지가만 갱신하려 해도 대장 28단계를 다 돌아야 했다.**

공시지가 시계열 자체는 공간 조인이 필요 없다. D150 dbf 의 PNU 와 금액 두 칸이면 된다.
그래서 그 부분만 떼어 여기로 옮겼다(산식은 `build_land_master.load_price()` 와 같다).

## 원천 둘

    2016~2026  data/raw/*D150*/*.dbf     개별공시지가 shapefile · A0=PNU · A9=원/㎡
    1990~2015  data/raw/공시지가_*년.csv  cp949 · 4번=PNU(19) · 5번=원/㎡ · 12번=기준년도

**둘 다 있어야 한다.** dbf 는 2016년부터만 있어서, CSV 를 안 읽으면 26년치가 11년치로 준다
(2026-08-31 에 실제로 그랬다). 같은 해에 판이 여럿이면 날짜가 늦은 것이 정정본이라 그것을 쓴다.

    data/.venv/bin/python scripts/build_gongsi_series.py [--out 경로]
"""
import argparse
import collections
import csv
import glob
import os
import re
import sys

sys.path.insert(0, "data/tools")
from dbf_inspect import read_dbf                      # noqa: E402
from build_report import Report                       # noqa: E402

DBF_GLOB = "data/raw/*D150*/*.dbf"
CSV_GLOB = "data/raw/공시지가_*년.csv"


def load_series(doc=None) -> dict[str, dict[str, int]]:
    """PNU → {연도: 원/㎡}. 새 판(dbf)이 옛 판(csv)을 이긴다."""
    byyear: dict[str, tuple[str, str]] = {}
    for dbf in sorted(glob.glob(DBF_GLOB)):
        m = re.search(r"(\d{4})(\d{4})", dbf.rsplit("/", 1)[-1])
        if not m:
            continue
        yr, mmdd = m.group(1), m.group(2)
        if yr not in byyear or mmdd > byyear[yr][0]:   # 같은 해 여러 판이면 늦은 것이 정정본
            byyear[yr] = (mmdd, dbf)

    ts: dict[str, dict[str, int]] = {}
    for yr in sorted(byyear):
        _n, _f, rows = read_dbf(byyear[yr][1], ("cp949", "utf-8"))
        for r in rows():
            try:
                iv = int(str(r["A9"]).strip() or 0)
            except ValueError:
                iv = 0
            if doc:
                doc.read()
            if iv > 0:
                ts.setdefault(r["A0"], {})[yr] = iv
    print(f"  D150 dbf {len(byyear)}개년: {', '.join(sorted(byyear))}")

    old = 0
    for path in sorted(glob.glob(CSV_GLOB)):
        m = re.search(r"(\d{4})", path.rsplit("/", 1)[-1])
        if not m or m.group(1) in byyear:              # dbf 판이 있으면 그쪽이 정본
            continue
        yr = m.group(1)
        with open(path, encoding="cp949", errors="replace") as f:
            rd = csv.reader(f)
            next(rd, None)
            for row in rd:
                if doc:
                    doc.read()
                if len(row) < 12:
                    continue
                pnu = row[3].strip()
                if len(pnu) != 19:
                    continue
                try:
                    iv = int(float(row[4].strip() or 0))
                except ValueError:
                    continue
                if iv > 0:
                    ts.setdefault(pnu, {})[yr] = iv
                    old += 1
    print(f"  옛 CSV(1990~2015) {old:,}줄")
    return ts


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/exports/_load/gongsi_series.csv")
    a = ap.parse_args()

    if not glob.glob(DBF_GLOB):
        sys.exit(f"✗ 공시지가 원본이 없습니다 — {DBF_GLOB}")

    doc = Report("build_gongsi_series", src="D150 dbf + 공시지가_YYYY년.csv")
    ts = load_series(doc)

    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    years: collections.Counter = collections.Counter()
    n = 0
    with open(a.out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["pnu", "year", "price"])
        for pnu in sorted(ts):
            for yr in sorted(ts[pnu]):
                w.writerow([pnu, yr, ts[pnu][yr]])
                years[yr] += 1
                n += 1
                doc.write()
    ys = sorted(years)
    print(f"\n공시지가 {n:,}행 · 필지 {len(ts):,} · {ys[0]}~{ys[-1]} {len(ys)}개년 → {a.out}")
    # 지금 지적도에 없는 필지도 **버리지 않는다.** export_series 는 _land_master(현 지적도 89만)를
    # 거쳐서 옛날에만 있던 필지 48만의 공시지가 이력을 통째로 잃었다(2026-09-07 실측:
    # 1990년이 60.7만 → 90.8만). 원본에서 바로 뽑으면 그게 살아난다.
    doc.note(f"필지 {len(ts):,} · 현 지적도(89만)에 없는 옛 필지도 담는다")
    # 구멍이 있으면 크게 찍는다. 한 해가 통째로 빠지는 사고가 실제로 있었다
    holes = [y for y in range(int(ys[0]), int(ys[-1]) + 1) if str(y) not in years]
    if holes:
        print(f"  ⚠ 빠진 연도 {len(holes)}개: {holes}")
    doc.finish()
    return 0


sys.exit(main())
