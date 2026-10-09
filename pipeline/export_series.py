#!/usr/bin/env python3
"""시계열 export: 공시지가 연도별 → gongsi_series.csv. (매각 이력은 2026-10-08 부터 build_trades.py)

## 공시지가는 **필지 원본에서 바로** 내보낸다 (2026-09-01)

예전엔 빌탐정.db 의 prices 표를 읽었다. 그런데 그 표는 _integrated.jsonl 에서 오고,
_integrated 는 **건물이 있는 필지만** 담는다. 그래서 이렇게 새고 있었다:

    _land_master.jsonl   894,750 필지가 공시지가 시계열을 갖는다
            ↓ build_integrated — 건물 있는 필지만 남는다
    빌탐정.db prices     496,380 필지 · 1,946만 행

건물이 없는 필지(나대지 등) 약 40만 개가 공시지가를 통째로 잃었다. 나대지 검색이
공시지가를 읽으므로 그냥 넘길 수 없다. DB 에 2,961만 행이 있던 것은 일회성 백필
스크립트가 직접 넣은 값이라, 파이프라인이 재현하지 못하는 상태였다.

적재 검증 게이트(row_floor)가 이걸 잡아 스왑을 막았다 — 게이트가 일한 것이다.

매각 이력은 건물 단위(PK)라 그대로 빌탐정.db 를 읽는다.
"""
import csv
import json
import sqlite3
import sys
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))),
                                  "data", "tools"))
from build_report import Report   # noqa: E402

DB = "data/빌탐정.db"
LAND = "data/tools/_land_master.jsonl"      # 필지 전수 — 건물 유무와 무관하다
OUT_G = sys.argv[1] if len(sys.argv) > 1 else "/tmp/gongsi_series.csv"

con = sqlite3.connect(DB)

n = 0
# 처리결과 문서 — 이 파일은 산출물이 둘(공시지가·매각)이라 문서도 둘로 낸다.
_dg = Report("export_series_gongsi", src="_land_master.jsonl → gongsi_series.csv")
with open(OUT_G, "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["pnu", "year", "price"])
    for line in open(LAND, encoding="utf-8"):
        r = json.loads(line)
        pnu = r.get("PNU")
        ser = r.get("공시지가") or {}
        _dg.read()
        if not pnu or len(pnu) != 19:
            _dg.drop("PNU 가 19자리가 아님", str(pnu)); continue
        if not ser:
            _dg.drop("공시지가 시계열이 빔", pnu); continue
        for year, price in sorted(ser.items()):
            if year and price not in (None, ""):
                w.writerow([pnu, int(year), price])
                n += 1
        _dg.write()
_dg.finish()
_dg.note(f"필지×연도 {n:,}행")
print(f"공시지가 {n:,}행 → {OUT_G}")

# 매각 이력(sales_history.csv)은 2026-10-08 에 뺐다 — 실거래는 data/tools/build_trades.py 가 낸다.

