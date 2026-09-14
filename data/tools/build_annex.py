#!/usr/bin/env python3
"""부속지번 관계표 — 건물(PK) ↔ 필지들(대표 + 부속 PNU).

값은 안 건드리고 **관련 필지 링크만** 만든다. 합산·변형 없음.
용도: 매물상세에서 관련 필지를 같이 보여준다(각 필지는 독립 데이터).
출력: _annex_{sgg}.json — PK → {대표, 부속[], 전체[]}. sgg=ALL 가능.

## 원본을 거르지 않는다

대장이 준 PK 는 전부 싣는다 — 총괄표제부·표제부·전유부 셋 다.
우리가 쓸 표가 없다는 건 우리 사정이지 대장의 사정이 아니다.
받을 표를 만드는 게 맞지 원본을 버리는 게 아니다(2026-08-31 잘못 걸렀다가 되돌림).

## 2026-08-31 — 이름으로 읽는다

새 서울본은 머리가 있는 CSV 다. 다만 이 마트에는 **HUB 오타**가 있다 —
`새주소법정도코드`(동→도). 자동 매칭으로는 절대 안 붙어서 hub_csv.FIX 에 교정을 적어 뒀다.

    data/.venv/bin/python data/tools/build_annex.py [11680|ALL]
"""
import collections
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hub_csv import rows as hub_rows          # noqa: E402
from build_report import Report               # noqa: E402

MP = {'0': '1', '1': '2', '2': '1'}

# ── 부속지번에서 읽는 칸 ────────────────────────────────────────
A = {
    "PK": "관리건축물대장PK", "대장종류": "대장종류코드명",
    "시군구": "시군구코드", "법정동": "법정동코드", "대지구분": "대지구분코드",
    "번": "번", "지": "지",
    "부속시군구": "부속시군구코드", "부속법정동": "부속법정동코드",
    "부속대지구분": "부속대지구분코드", "부속번": "부속번", "부속지": "부속지",
}


def mk(sgg, emd, dg, bon, bu):
    if not (sgg.isdigit() and emd.isdigit() and bon.isdigit() and bu.isdigit()):
        return None
    s = f"{sgg}{emd}{MP.get(dg, dg)}{int(bon):04d}{int(bu):04d}"
    return s if len(s) == 19 else None


def main():
    sgg = sys.argv[1] if len(sys.argv) > 1 else '11680'
    rep = Report("build_annex", src=("대장", "부속지번"), used=A.values())
    main_pnu = {}
    subs = collections.defaultdict(set)
    kinds = collections.Counter()

    for r in hub_rows("대장", "부속지번", need=list(A.values())):
        g = lambda k: (r[A[k]] or '').strip()
        if sgg != 'ALL' and not g('시군구').startswith(sgg):
            continue
        rep.read()
        pk = g('PK')
        if not pk:
            rep.drop("PK 없음"); continue
        kinds[g('대장종류') or '(없음)'] += 1

        m = mk(g('시군구'), g('법정동'), g('대지구분'), g('번'), g('지'))
        s = mk(g('부속시군구'), g('부속법정동'), g('부속대지구분'), g('부속번'), g('부속지'))
        if not m:
            rep.null("대표 PNU 조립 불가", pk)
        if not s:
            rep.null("부속 PNU 조립 불가", pk)
        if m:
            main_pnu[pk] = m
        if s:
            subs[pk].add(s)
        rep.write()

    out = {}
    single = 0
    for pk, m in main_pnu.items():
        sub = sorted(subs.get(pk, set()) - {m})       # 대표를 뺀 부속만
        if not sub:
            single += 1                                # 단일필지 = 관계 없음
            continue
        out[pk] = {'대표': m, '부속': sub, '전체': [m] + sub}
    json.dump(out, open(f"data/tools/_annex_{sgg}.json", 'w'), ensure_ascii=False)

    n = len(out)
    tot_p = sum(len(v['전체']) for v in out.values())
    dist = collections.Counter(len(v['부속']) for v in out.values())
    rep.note(f"대장 종류: {dict(kinds)}")
    rep.note(f"단일필지(관계 없음) {single:,}건 · 다필지 {n:,}건")
    rep.finish()
    print(f"\n[{sgg}] 다필지 건물 {n:,} · 평균 {tot_p/max(n,1):.1f}필지/건물")
    print(f"  단일필지(저장 안 함) {single:,}")
    print(f"  부속수 분포: {dict(sorted(dist.items())[:8])}")
    print(f"저장: _annex_{sgg}.json")


if __name__ == '__main__':
    main()
