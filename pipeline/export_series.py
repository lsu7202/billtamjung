#!/usr/bin/env python3
"""시계열 export: 빌탐정.db prices(공시지가 연도별)·sales(매각 이력) → CSV 2개."""
import csv
import sqlite3
import sys

DB = "data/빌탐정.db"
OUT_G = sys.argv[1] if len(sys.argv) > 1 else "/tmp/gongsi_series.csv"
OUT_S = sys.argv[2] if len(sys.argv) > 2 else "/tmp/sales_history.csv"

con = sqlite3.connect(DB)

n = 0
with open(OUT_G, "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["pnu", "year", "price"])
    # (pnu, 연도) 중복 존재 → 최대값 채택(dedupe)
    for pnu, year, price in con.execute(
        "SELECT pnu, 연도, max(공시지가) FROM prices WHERE 공시지가 IS NOT NULL GROUP BY pnu, 연도"
    ):
        if not pnu or not year:
            continue
        w.writerow([pnu, int(year), price])
        n += 1
print(f"공시지가 {n:,}행 → {OUT_G}")

n = 0
seen = set()
with open(OUT_S, "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["building_pk", "contract_ym", "price", "total_area", "land_area"])
    for pk, ym, price, ta, la in con.execute("SELECT pk, 계약년월, 금액, 연면적, 대지 FROM sales WHERE 금액 IS NOT NULL"):
        if not pk or not ym:
            continue
        key = (pk, ym, price)
        if key in seen:            # PK 중복 제거(동일 거래 중복 행)
            continue
        seen.add(key)
        w.writerow([pk, ym, price, ta or "", la or ""])
        n += 1
print(f"매각 이력 {n:,}행 → {OUT_S}")
