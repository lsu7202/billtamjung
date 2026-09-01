#!/usr/bin/env python3
"""시계열 export: 빌탐정.db prices(공시지가 연도별)·sales(매각 이력) → CSV 2개."""
import csv
import sqlite3
import sys
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))),
                                  "data", "tools"))
from build_report import Report   # noqa: E402

DB = "data/빌탐정.db"
OUT_G = sys.argv[1] if len(sys.argv) > 1 else "/tmp/gongsi_series.csv"
OUT_S = sys.argv[2] if len(sys.argv) > 2 else "/tmp/sales_history.csv"

con = sqlite3.connect(DB)

n = 0
# 처리결과 문서 — 이 파일은 산출물이 둘(공시지가·매각)이라 문서도 둘로 낸다.
_dg = Report("export_series_gongsi", src="빌탐정.db prices → gongsi_series.csv")
with open(OUT_G, "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["pnu", "year", "price"])
    # (pnu, 연도) 중복 존재 → 최대값 채택(dedupe)
    for pnu, year, price in con.execute(
        "SELECT pnu, 연도, max(공시지가) FROM prices WHERE 공시지가 IS NOT NULL GROUP BY pnu, 연도"
    ):
        _dg.read()
        if not pnu or not year:
            _dg.drop("PNU 또는 연도 없음", str(pnu)); continue
        w.writerow([pnu, int(year), price])
        n += 1
        _dg.write()
_dg.finish()
print(f"공시지가 {n:,}행 → {OUT_G}")

n = 0
seen = set()
_ds = Report("export_series_sales", src="빌탐정.db sales → sales_history.csv")
with open(OUT_S, "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["building_pk", "contract_ym", "price", "total_area", "land_area"])
    for pk, ym, price, ta, la in con.execute("SELECT pk, 계약년월, 금액, 연면적, 대지 FROM sales WHERE 금액 IS NOT NULL"):
        _ds.read()
        if not pk or not ym:
            _ds.drop("건물 PK 또는 계약년월 없음", str(pk)); continue
        key = (pk, ym, price)
        if key in seen:            # PK 중복 제거(동일 거래 중복 행)
            _ds.merge("같은 (건물,계약년월,금액) 이 두 번", str(pk)); continue
        seen.add(key)
        w.writerow([pk, ym, price, ta or "", la or ""])
        n += 1
        _ds.write()
_ds.finish()
print(f"매각 이력 {n:,}행 → {OUT_S}")
