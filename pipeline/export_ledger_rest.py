#!/usr/bin/env python3
"""_basic·_septic·_aptprice jsonl → 적재용 CSV 셋. 소스 'basic'·'septic'·'aptprice'.

세 마트가 성격이 같아(대장 부속 표) 한 스크립트에 둔다. 따로 두면 같은 코드가 셋이 된다.

    python pipeline/export_ledger_rest.py --out-dir data/exports/_load
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

SPEC = {
    "basic": {
        "src": "data/tools/_basic.jsonl", "out": "basic.csv",
        "cols": ["building_pk", "parent_pk", "pnu", "ledger_kind", "ledger_type",
                 "addr", "road_addr", "bldg_name", "sgg_code", "bjd_code", "extra_parcels",
                 "zone_code", "zone_name", "district_code", "district_name",
                 "area_code", "area_name", "created_ymd"],
        "key": {"building_pk": "PK", "parent_pk": "상위PK", "pnu": "PNU",
                "ledger_kind": "대장구분", "ledger_type": "대장종류",
                "addr": "주소", "road_addr": "도로명주소", "bldg_name": "건물명",
                "sgg_code": "시군구코드", "bjd_code": "법정동코드",
                "extra_parcels": "외필지수",
                "zone_code": "지역코드", "zone_name": "지역명",
                "district_code": "지구코드", "district_name": "지구명",
                "area_code": "구역코드", "area_name": "구역명",
                "created_ymd": "생성일자"},
    },
    "septic": {
        "src": "data/tools/_septic.jsonl", "out": "septic.csv",
        "cols": ["building_pk", "pnu", "addr", "road_addr", "bldg_name",
                 "sgg_code", "bjd_code", "form_code", "form", "form_name",
                 "unit_kind", "cap_person", "cap_m3", "created_ymd"],
        "key": {"building_pk": "PK", "pnu": "PNU", "addr": "주소",
                "road_addr": "도로명주소", "bldg_name": "건물명",
                "sgg_code": "시군구코드", "bjd_code": "법정동코드",
                "form_code": "형식코드", "form": "형식", "form_name": "형식명",
                "unit_kind": "단위구분", "cap_person": "용량인용", "cap_m3": "용량루베",
                "created_ymd": "생성일자"},
    },
    # 공동주택가격은 파이프라인에서 뺐다(2026-09-02) — 읽는 곳이 없다. 정의는 남긴다.
    "aptprice": {
        "src": "data/tools/_aptprice.jsonl", "out": "aptprice.csv",
        "cols": ["unit_pk", "year", "seq", "price"],
        "key": {"unit_pk": "PK", "year": "연도", "seq": "순번", "price": "가격"},
    },
}


def norm_ymd(s):
    s = (s or "").strip()
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) == 8 and s.isdigit() else ""


# 기본 실행에서 빼는 마트. --only 로 이름을 대면 여전히 만든다.
# aptprice(공동주택가격)는 2,794만 행인데 읽는 화면·API 가 없다(2026-09-02).
SKIP_BY_DEFAULT = {"aptprice"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default="data/exports/_load")
    ap.add_argument("--only", help="basic | septic | aptprice(파이프라인에선 안 돈다)")
    a = ap.parse_args()
    os.makedirs(a.out_dir, exist_ok=True)
    for name, sp in SPEC.items():
        if a.only and a.only != name:
            continue
        if not a.only and name in SKIP_BY_DEFAULT:
            print(f"  ⏭ {name}: 파이프라인에서 뺐습니다(--only {name} 로 만들 수 있습니다)")
            continue
        if not os.path.exists(sp["src"]):
            print(f"  ⏭ {name}: {sp['src']} 없음, 건너뜀")
            continue
        out = os.path.join(a.out_dir, sp["out"])
        # 처리결과 문서 — 마트마다 따로 낸다(한 스크립트가 여럿을 낸다).
        doc = Report(f"export_ledger_rest_{name}", src=f"{sp['src']} → {sp['out']}")
        n = 0
        with open(out, "w", newline="", encoding="utf-8") as fo:
            w = csv.writer(fo)
            w.writerow(sp["cols"])
            for line in open(sp["src"], encoding="utf-8"):
                doc.read()
                r = json.loads(line)
                row = []
                for c in sp["cols"]:
                    v = r.get(sp["key"][c])
                    if c.endswith("_ymd"):
                        v = norm_ymd(v)
                    row.append("" if v is None else v)
                if len(row) != len(sp["cols"]):
                    sys.exit(f"열 개수 불일치({name}): {len(row)} ≠ {len(sp['cols'])}")
                w.writerow(row)
                n += 1
                doc.write()
        doc.finish(quiet=True)
        print(f"  {name:10} {n:10,}행 → {out}")


if __name__ == "__main__":
    main()
