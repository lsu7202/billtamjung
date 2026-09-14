#!/usr/bin/env python3
"""건물별 지역·지구·구역 → 건물 1행(2026-09-01).

## 무엇인가

건축물대장이 건물마다 붙여 주는 **용도지역·용도지구·용도구역**이다.
한 건물이 여러 줄로 온다 — 지역 1줄 + 지구 n줄 + 구역 n줄.

    서울 735,619행 / 건물 단위로 접으면 그보다 적다

## 왜 필요한가

지금은 이 정보를 **토지이용계획(LURIS)에서 따로 받아** 쓴다. 그건 필지 기준이고
이건 건물 기준이다. 둘이 어긋날 때 어느 쪽이 맞는지 알려면 양쪽을 다 갖고 있어야 한다.
대장이 자기 건물에 대해 뭐라고 적어 뒀는지는 대장에게 물어야 한다.

## 구분이 셋이다

    지역지구구역구분코드  1=용도지역 · 2=용도지구 · 3=용도구역

**대표여부**가 1인 것이 그 구분의 주된 값이다. 한 건물에 용도지역이 둘 이상일 수
있고(필지가 경계에 걸침), 그때 대표 하나를 고르는 것이 원본의 뜻이다.

## 접는 방식

건물당 1행으로 접되 **버리지 않는다**:

    대표 지역 · 대표 지구 · 대표 구역   → 각 한 값
    전체 목록                          → 배열로 남긴다

대표만 남기면 「자연경관지구이면서 최고고도지구」인 건물의 절반이 사라진다.

    data/.venv/bin/python data/tools/build_zone.py
"""
import collections
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hub_csv import rows as hub_rows          # noqa: E402
from build_report import Report               # noqa: E402

OUT = "data/tools/_zone.jsonl"
MP = {'0': '1', '1': '2', '2': '1'}

Z = {
    "PK": "관리건축물대장PK",
    "주소": "대지위치", "도로명주소": "도로명대지위치",
    "시군구": "시군구코드", "법정동": "법정동코드", "대지구분": "대지구분코드",
    "번": "번", "지": "지",
    "구분코드": "지역지구구역구분코드", "구분": "지역지구구역구분코드명",
    "코드": "지역지구구역코드", "이름": "지역지구구역코드명",
    "대표": "대표여부", "기타": "기타지역지구구역",
    "생성일자": "생성일자",
}

# 지역지구구역구분코드 → 우리가 쓰는 이름
SEC = {'1': '지역', '2': '지구', '3': '구역'}


def mkpnu(sgg, emd, dg, bon, bu):
    if not (sgg.isdigit() and emd.isdigit() and bon.isdigit() and bu.isdigit()):
        return None
    p = f"{sgg}{emd}{MP.get(dg, dg)}{int(bon):04d}{int(bu):04d}"
    return p if len(p) == 19 else None


def main():
    rep = Report("build_zone", src=("대장", "지역지구구역"), used=Z.values())
    acc = {}
    kinds = collections.Counter()

    for r in hub_rows("대장", "지역지구구역", need=list(Z.values())):
        g = lambda k: (r[Z[k]] or '').strip()
        rep.read()
        pk = g('PK')
        if not pk:
            rep.drop("PK 없음"); continue

        sec = SEC.get(g('구분코드'))
        if not sec:
            rep.note_odd("지역/지구/구역이 아닌 구분코드", pk, g('구분코드'))
        kinds[g('구분') or '(없음)'] += 1

        a = acc.get(pk)
        if a is None:
            pnu = mkpnu(g('시군구'), g('법정동'), g('대지구분'), g('번'), g('지'))
            if not pnu:
                rep.null("PNU 조립 불가", pk, g('주소'))
            a = acc[pk] = {
                'PK': pk, 'PNU': pnu,
                '주소': g('주소') or None, '도로명주소': g('도로명주소') or None,
                '시군구코드': g('시군구') or None, '법정동코드': g('법정동') or None,
                '대표지역': None, '대표지구': None, '대표구역': None,
                '지역': [], '지구': [], '구역': [],
                '생성일자': g('생성일자') or None,
            }

        name = g('이름') or g('기타') or None
        if sec and name:
            if name not in a[sec]:
                a[sec].append(name)
            # 대표여부 1 = 그 구분의 주된 값. 먼저 나온 대표를 지킨다.
            if g('대표') == '1' and not a['대표' + sec]:
                a['대표' + sec] = name
        rep.write()

    out = open(OUT, "w")
    have = collections.Counter()
    multi = collections.Counter()
    for a in acc.values():
        # 대표 표시가 없으면 첫 값을 쓴다 — 있는 것을 버리지 않는다
        for sec in ('지역', '지구', '구역'):
            if not a['대표' + sec] and a[sec]:
                a['대표' + sec] = a[sec][0]
                rep.note_odd(f"대표 표시 없는 {sec} — 첫 값을 씀", a['PK'], a[sec][0])
            if a['대표' + sec]:
                have[sec] += 1
            if len(a[sec]) >= 2:
                multi[sec] += 1
        out.write(json.dumps(a, ensure_ascii=False) + "\n")
    out.close()

    n = len(acc)
    rep.note(f"구분 분포: {dict(kinds)}")
    # 줄 단위(735,594)와 출력 단위(건물 386,057동)가 다르다. 메모로만 두면
    # 「읽은줄 = 낸줄」로 보여 접은 사실이 표에서 사라진다(2026-09-01).
    rep.output(n)
    rep.merge("같은 건물의 여러 줄을 한 행으로 접음", n=rep.n_read - n)
    rep.finish()
    print(f"\n건물 {n:,}동 → {OUT}")
    for sec in ('지역', '지구', '구역'):
        print(f"  {sec}  있음 {have[sec]:7,} ({have[sec]/max(n,1)*100:5.1f}%)"
              f" · 둘 이상 {multi[sec]:,}")


if __name__ == "__main__":
    main()
