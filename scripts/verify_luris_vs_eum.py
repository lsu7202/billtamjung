#!/usr/bin/env python3
"""우리 법정 건폐·용적이 토지이음과 같은지 잰다 (2026-09-02).

## 무엇을 재나

산식은 토지이음 원본을 그대로 옮겼다(`data/tools/eum_rule.py`). 그러면 남은 변수는
**면적 하나**다. 토지이음은 자기 폴리곤으로 필지∩용도지역 교차면적을 내고(MapPlan),
우리는 같은 원천(연속지적도 · UQ111)으로 우리가 낸다. 둘이 같으면 값도 같다.

그래서 표본 필지마다 두 벌을 계산해 견준다.

    우리 값   parcel_luris.csv.gz (우리 교차면적)
    저쪽 값   같은 산식 × **토지이음이 준 교차면적**(MapPlan)

다르면 원인은 폴리곤 교차면적뿐이다. 화면을 여는 게 아니라 면적 한 줄만 받는다.

    backend/.venv/bin/python scripts/verify_luris_vs_eum.py [--n 150]
"""
import csv
import gzip
import json
import os
import random
import sys
import time
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "tools"))
import eum_rule                                             # noqa: E402

GZ = "data/exports/luris/parcel_luris.csv.gz"
SPATIAL = "data/tools/_spatial_ALL.json"
LAND = "data/tools/_land_master.jsonl"
LEDGER_GLOB = "data/raw/토지이용계획정보_서울/AL_D155_*.csv"
WAIT = 0.8


def mapplan(pnu):
    u = ("https://www.eum.ne.kr:9003/MapPlan/MapPlan"
         f"?req=analysis&version=20260614&pnus={pnu}")
    r = urllib.request.Request(u, headers={"Referer": "https://www.eum.go.kr/",
                                           "User-Agent": "Mozilla/5.0"})
    j = json.loads(urllib.request.urlopen(r, timeout=40).read().decode("utf-8", "replace"))
    # 같은 코드가 여러 레이어에 나오면 **처음 것만** 쓴다 — 토지이음 fn_getAreaData 가
    # 첫 일치에서 break 한다. 더하면 잣대가 그쪽 화면과 달라진다.
    out = {}
    for layer in j.get("layer", []):
        for c in layer["codes"]:
            out.setdefault(c["code"], c["area"])
    return out


def main():
    args = sys.argv[1:]
    n = 150
    if "--n" in args:
        i = args.index("--n"); n = int(args[i + 1]); del args[i:i + 2]

    print("우리 산출물 로드…", flush=True)
    ours = {}
    with gzip.open(GZ, "rt", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if "," in (r["use_zone"] or ""):                # 걸친 필지만 본다
                ours[r["pnu"]] = (r["legal_bcr"], r["legal_far"])
    pnus = args or random.Random(20260902).sample(sorted(ours), n)

    print("원장에서 표본의 용도지역 코드 읽는 중…", flush=True)
    import glob
    src = sorted(glob.glob(LEDGER_GLOB))[-1]
    want = set(pnus)
    zcodes, dcodes = {}, {}
    with open(src, encoding="cp949", errors="replace", newline="") as f:
        rd = csv.reader(f); hdr = next(rd)
        i_p, i_j, i_c = (hdr.index(x) for x in ("고유번호", "저촉여부", "용도지역지구코드"))
        for row in rd:
            if len(row) <= i_c or row[i_p] not in want:
                continue
            cd, jc = row[i_c].strip(), row[i_j].strip()
            if cd in eum_rule.TARGET_LOCAL and jc != "접함":
                zcodes.setdefault(row[i_p], set()).add(cd)
            elif cd in eum_rule.TARGET_DISTRICT:
                dcodes.setdefault(row[i_p], set()).add(cd)

    print("지적면적 로드…", flush=True)
    land = {}
    for line in open(LAND, encoding="utf-8"):
        r = json.loads(line)
        if r["PNU"] in want and r.get("면적"):
            land[r["PNU"]] = float(r["면적"])
    sp = json.load(open(SPATIAL, encoding="utf-8"))

    same = diff = skip = 0
    area_gap = []
    print(f"\n대조 {len(pnus)}필지\n", flush=True)
    for pnu in pnus:
        zs = sorted(zcodes.get(pnu) or [])
        if not zs or pnu not in land:
            skip += 1; continue
        try:
            theirs_area = mapplan(pnu)
        except Exception as e:                               # noqa: BLE001
            print(f"  ⏭ {pnu}: {type(e).__name__}"); skip += 1; continue
        ours_raw = {}
        for code, a in ((sp.get(pnu) or {}).get("원본면적") or {}).items():
            u = eum_rule.to_uqa(code)
            if u:
                ours_raw[u] = ours_raw.get(u, 0.0) + a
        for c in zs:                                          # 면적 차이 기록
            if c in theirs_area and c in ours_raw:
                area_gap.append(abs(theirs_area[c] - ours_raw[c]))
        eb, ef, ehow = eum_rule.calc(zs, theirs_area, land[pnu], dcodes.get(pnu) or ())
        ob, of = ours[pnu]
        eb, ef = (eb or ""), (ef or "")
        if (ob, of) == (eb, ef):
            same += 1
        else:
            diff += 1
            print(f"  ❌ {pnu}  우리 {ob or '(빔)'}/{of or '(빔)'}  "
                  f"저쪽면적 {eb or '(빔)'}/{ef or '(빔)'} [{ehow}]")
        time.sleep(WAIT)

    tot = same + diff
    print(f"\n대조 {tot}필지 · 일치 {same} · 불일치 {diff} · 건너뜀 {skip}")
    if tot:
        print(f"일치율 {same / tot * 100:.1f}%")
    if area_gap:
        area_gap.sort()
        m = area_gap[len(area_gap) // 2]
        print(f"\n교차면적 차이 {len(area_gap):,}개 · 중앙 {m:.4f}㎡ · "
              f"상위10% {area_gap[int(len(area_gap)*0.9)]:.4f}㎡ · 최대 {area_gap[-1]:.4f}㎡")
    return 1 if diff else 0


if __name__ == "__main__":
    sys.exit(main())
