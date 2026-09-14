#!/usr/bin/env python3
"""대장 기본개요 → 대장 세 층을 잇는 뼈대(2026-09-01).

## 무엇인가

건축물대장의 **최상위 껍데기**다. 총괄표제부·표제부·전유부가 각각 여기에 한 줄씩 있고,
`관리상위건축물대장PK` 로 위층을 가리킨다.

    서울 4,387,978행 · 30칸

## 왜 필요한가

지금은 세 층을 **PNU 로 어림잡아** 잇고 있다. 그런데 한 필지에 단지가 여럿이면 어느
표제부가 어느 총괄표제부에 속하는지 PNU 로는 못 가른다. 기본개요의 상위 PK 가 그 답이다.

부속지번이 가리키던 전유부 PK 488개가 갈 곳 없이 떠 있던 것도 이 표가 없어서였다.

## 머리글이 겹친다 — HUB 오류

27·28번이 둘 다 `구역코드명` 이다. 27번이 실은 `지구코드명` 이고, 그대로 읽으면
DictReader 가 지구를 삼킨다. hub_csv.FIX 가 자리로 바로잡는다(근거는 그쪽 주석).

    data/.venv/bin/python data/tools/build_basic.py
"""
import collections
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hub_csv import rows as hub_rows          # noqa: E402
from build_report import Report               # noqa: E402

OUT = "data/tools/_basic.jsonl"
MP = {'0': '1', '1': '2', '2': '1'}

B = {
    "PK": "관리건축물대장PK", "상위PK": "관리상위건축물대장PK",
    "대장구분": "대장구분코드명", "대장종류": "대장종류코드명",
    "주소": "대지위치", "도로명주소": "도로명대지위치", "건물명": "건물명",
    "시군구": "시군구코드", "법정동": "법정동코드", "대지구분": "대지구분코드",
    "번": "번", "지": "지", "외필지수": "외필지수",
    "지역코드": "지역코드", "지구코드": "지구코드", "구역코드": "구역코드",
    "지역명": "지역코드명", "지구명": "지구코드명", "구역명": "구역코드명",
    "생성일자": "생성일자",
}


def mkpnu(sgg, emd, dg, bon, bu):
    if not (sgg.isdigit() and emd.isdigit() and bon.isdigit() and bu.isdigit()):
        return None
    p = f"{sgg}{emd}{MP.get(dg, dg)}{int(bon):04d}{int(bu):04d}"
    return p if len(p) == 19 else None


def _ymd(s):
    s = (s or '').strip()
    return s if (len(s) == 8 and s.isdigit() and '19000101' <= s <= '20301231') else None


def main():
    rep = Report("build_basic", src=("대장", "기본개요"), used=B.values())
    out = open(OUT, "w")
    n = 0
    kinds = collections.Counter()
    have = collections.Counter()

    for r in hub_rows("대장", "기본개요", need=list(B.values())):
        g = lambda k: (r[B[k]] or '').strip()
        rep.read()
        pk = g('PK')
        if not pk:
            rep.drop("PK 없음"); continue

        pnu = mkpnu(g('시군구'), g('법정동'), g('대지구분'), g('번'), g('지'))
        if not pnu:
            rep.null("PNU 조립 불가", pk, g('주소'))

        kinds[g('대장종류') or '(없음)'] += 1
        rec = {
            'PK': pk, '상위PK': g('상위PK') or None, 'PNU': pnu,
            '대장구분': g('대장구분') or None, '대장종류': g('대장종류') or None,
            '주소': g('주소') or None, '도로명주소': g('도로명주소') or None,
            '건물명': g('건물명') or None,
            '시군구코드': g('시군구') or None, '법정동코드': g('법정동') or None,
            '외필지수': int(g('외필지수') or 0) or None,
            '지역코드': g('지역코드') or None, '지역명': g('지역명') or None,
            '지구코드': g('지구코드') or None, '지구명': g('지구명') or None,
            '구역코드': g('구역코드') or None, '구역명': g('구역명') or None,
            '생성일자': _ymd(g('생성일자')),
        }
        out.write(json.dumps(rec, ensure_ascii=False) + "\n")
        rep.write()
        n += 1
        for k in ('PNU', '상위PK', '건물명', '지역명', '지구명', '구역명'):
            if rec[k] is not None:
                have[k] += 1
    out.close()
    rep.note(f"대장종류: {dict(kinds)}")
    rep.finish()
    print(f"\n기본개요 {n:,}행 → {OUT}")
    print(f"  대장종류: {dict(kinds)}")
    for k, v in have.items():
        print(f"  {k:8} {v:9,} ({v/max(n,1)*100:5.1f}%)")


if __name__ == "__main__":
    main()
