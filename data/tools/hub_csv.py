#!/usr/bin/env python3
"""건축HUB 서울본 CSV 읽기 — 빌더 공용(2026-08-31).

## 왜 이 모듈이 생겼나

**자리 번호로 읽는 것을 그만둔다.** 지금까지 빌더는 파이프 구분 마트를 `p[35]` 식으로
읽었다. 그러다 두 번 크게 다쳤다:

  · 총괄표제부(djy_02)는 머리 블록이 표제부(djy_03)보다 두 칸 밀려 있는데, 표제부
    감각으로 p[5] 를 주소로 읽어 엉뚱한 칸을 실었다.
  · 옛 CSV 를 다시 적재하면서 층 표기가 되돌아가, 지하 32만 층이 지상이 됐다.

새 서울본은 머리가 있는 CSV 다. **이름으로 읽으면 자리가 밀려도 안 다친다.**
그리고 이름이 없으면 조용히 빈칸이 되는 게 아니라 **바로 멈춘다** — 없는 칸을 None 으로
읽어 넘어가면, 그 값이 화면까지 가서 「대장에 없는 값」이 된다.

## 쓰는 법

    from hub_csv import rows, one_col
    for r in rows("대장", "표제부", need=["관리건축물대장PK", "대지위치", "도로명대지위치"]):
        pk = r["관리건축물대장PK"]

`need` 에 적은 칸이 하나라도 없으면 그 자리에서 SystemExit 한다.
25구가 다 있어야 돈다 — 한 구라도 비면 「왜 없는지 모르는 행」이 생기기 때문이다.
"""
import collections
import csv
import os
import sys

csv.field_size_limit(1 << 27)          # 대지위치·기타용도가 길다

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HUB = os.path.join(ROOT, "data", "raw", "hub_seoul")

# 서울 25구. 이 목록이 곧 「다 받았나」의 기준이다.
SGG = ["11110", "11140", "11170", "11200", "11215", "11230", "11260", "11290",
       "11305", "11320", "11350", "11380", "11410", "11440", "11470", "11500",
       "11530", "11545", "11560", "11590", "11620", "11650", "11680", "11710",
       "11740"]


def paths(grp, name, allow_partial=False):
    """{계열}_{마트}/{시군구}.csv 25장. 합본(.csv)이 있으면 그것 하나."""
    merged = os.path.join(HUB, f"{grp}_{name}.csv")
    if os.path.exists(merged):
        return [merged]
    d = os.path.join(HUB, f"{grp}_{name}")
    if not os.path.isdir(d):
        sys.exit(f"✗ {d} 없음 — scripts/hub/download_seoul.py 를 먼저 돌리세요")
    have = [cd for cd in SGG if os.path.exists(os.path.join(d, f"{cd}.csv"))]
    if len(have) != len(SGG) and not allow_partial:
        miss = [cd for cd in SGG if cd not in have]
        sys.exit(f"✗ {grp}/{name}: {len(have)}/{len(SGG)}구만 있습니다 — 없는 구 {miss}\n"
                 f"  구가 비면 그 지역 건물이 통째로 사라집니다. 다 받고 다시 부르세요.")
    return [os.path.join(d, f"{cd}.csv") for cd in have]


# ── HUB 머리글 오류 교정 ──────────────────────────────────────────────
# **값은 손대지 않는다. 이름표만 바로잡는다.** 원본이 준 머리글이 틀린 곳이 있어,
# 그대로 읽으면 칸이 사라지거나 엉뚱한 이름으로 붙는다. 근거를 적어 두고 여기 한 곳에만 둔다.
#
#   {(계열, 마트): {자리번호: 올바른 이름}}
FIX = {
    # 대장/기본개요: 27번이 '구역코드명' 으로 잘못 붙어 28번과 **이름이 겹친다**.
    # DictReader 는 겹치면 뒤엣것이 앞엣것을 덮으므로 지구 정보가 통째로 사라진다.
    # 실측(종로구): 27번 채움 5.1% = 지구코드(5.1%) 와 같고 값이 '주차장정비지구·
    # 최고고도지구·역사문화미관지구' 로 전부 「~지구」다. 28번은 구역코드(2.9%) 와
    # 같고 '제1종지구단위계획구역' 등 「~구역」이다.
    ("대장", "기본개요"): {27: "지구코드명"},
    # 대장/부속지번: '새주소법정도코드' — HUB 오타(동→도).
    ("대장", "부속지번"): {17: "새주소법정동코드"},
}


def header(grp, name):
    p = paths(grp, name, allow_partial=True)[0]
    with open(p, encoding="utf-8-sig", newline="") as f:
        h = next(csv.reader(f))
    for i, nm in FIX.get((grp, name), {}).items():
        if i < len(h):
            h[i] = nm
    return h


def rows(grp, name, need=None, allow_partial=False):
    """머리 있는 dict 를 하나씩 준다. need 의 칸이 없으면 바로 멈춘다."""
    ps = paths(grp, name, allow_partial)
    fix = FIX.get((grp, name), {})
    checked = False
    for p in ps:
        with open(p, encoding="utf-8-sig", newline="") as f:
            rd = csv.reader(f)
            hdr = next(rd)
            for i, nm in fix.items():
                if i < len(hdr):
                    hdr[i] = nm
            if not checked:
                # 이름이 겹치면 뒤엣것이 앞엣것을 덮어 **조용히 한 칸이 사라진다**.
                # 교정표를 거치고도 겹치면 우리가 모르는 오류이므로 멈춘다.
                dup = [c for c, k in collections.Counter(hdr).items() if k > 1]
                if dup:
                    sys.exit(f"✗ {grp}/{name} 머리글이 겹칩니다: {dup}\n"
                             f"  hub_csv.FIX 에 교정을 적어야 합니다(자리별 올바른 이름).\n"
                             f"  머리글: {hdr}")
                miss = [c for c in (need or []) if c not in hdr]
                if miss:
                    sys.exit(f"✗ {grp}/{name} 에 없는 칸: {miss}\n  있는 칸: {hdr}")
                checked = True
            for r in rd:
                yield dict(zip(hdr, r))
