#!/usr/bin/env python3
"""오수정화시설 → 건물 1행(2026-09-01).

## 무엇인가

건물마다 붙은 **정화조의 형식과 용량**이다. 서울 502,236행 · 29칸.

## 왜 필요한가

용도변경에서 걸린다. 근린생활시설을 음식점으로 바꾸려면 오수 발생량이 늘어
정화조 용량이 모자라면 증설해야 하고, 그 비용이 수천만 원이다.
「이 건물 1층에 식당 넣을 수 있나」는 중개 현장에서 자주 나오는 질문이다.

## 용량이 두 단위로 온다

    용량(인용)  사람 수 기준
    용량(루베)  부피(㎥) 기준

단위구분코드가 어느 쪽인지 말해 준다. **둘을 합치지 않는다** — 환산하려면
오수 원단위를 알아야 하는데 용도마다 다르다. 원본 그대로 두 칸을 싣는다.

    data/.venv/bin/python data/tools/build_septic.py
"""
import collections
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hub_csv import rows as hub_rows          # noqa: E402
from build_report import Report               # noqa: E402

OUT = "data/tools/_septic.jsonl"
MP = {'0': '1', '1': '2', '2': '1'}

S = {
    "PK": "관리건축물대장PK",
    "주소": "대지위치", "도로명주소": "도로명대지위치", "건물명": "건물명",
    "시군구": "시군구코드", "법정동": "법정동코드", "대지구분": "대지구분코드",
    "번": "번", "지": "지",
    "형식코드": "형식코드", "형식": "형식코드명", "형식명": "형식명",
    "단위구분": "단위구분코드명",
    "용량인용": "용량(인용)", "용량루베": "용량(루베)",
    "생성일자": "생성일자",
}


def mkpnu(sgg, emd, dg, bon, bu):
    if not (sgg.isdigit() and emd.isdigit() and bon.isdigit() and bu.isdigit()):
        return None
    p = f"{sgg}{emd}{MP.get(dg, dg)}{int(bon):04d}{int(bu):04d}"
    return p if len(p) == 19 else None


def _num(s):
    try:
        v = float((s or '').strip())
    except ValueError:
        return None
    return round(v, 2) if v else None


def _ymd(s):
    s = (s or '').strip()
    return s if (len(s) == 8 and s.isdigit() and '19000101' <= s <= '20301231') else None


def main():
    rep = Report("build_septic", src=("대장", "오수정화"), used=S.values())
    out = open(OUT, "w")
    n = 0
    forms = collections.Counter()
    units = collections.Counter()
    have = collections.Counter()
    seen = collections.Counter()

    for r in hub_rows("대장", "오수정화", need=list(S.values())):
        g = lambda k: (r[S[k]] or '').strip()
        rep.read()
        pk = g('PK')
        if not pk:
            rep.drop("PK 없음"); continue
        seen[pk] += 1
        if seen[pk] > 1:
            rep.note_odd("한 건물에 정화조가 두 줄 이상", pk, g('형식'))

        pnu = mkpnu(g('시군구'), g('법정동'), g('대지구분'), g('번'), g('지'))
        if not pnu:
            rep.null("PNU 조립 불가", pk, g('주소'))

        forms[g('형식') or '(없음)'] += 1
        units[g('단위구분') or '(없음)'] += 1
        rec = {
            'PK': pk, 'PNU': pnu,
            '주소': g('주소') or None, '도로명주소': g('도로명주소') or None,
            '건물명': g('건물명') or None,
            '시군구코드': g('시군구') or None, '법정동코드': g('법정동') or None,
            '형식코드': g('형식코드') or None, '형식': g('형식') or None,
            '형식명': g('형식명') or None,
            '단위구분': g('단위구분') or None,
            '용량인용': _num(g('용량인용')), '용량루베': _num(g('용량루베')),
            '생성일자': _ymd(g('생성일자')),
        }
        out.write(json.dumps(rec, ensure_ascii=False) + "\n")
        rep.write()
        n += 1
        for k in ('PNU', '형식', '용량인용', '용량루베'):
            if rec[k] is not None:
                have[k] += 1
    out.close()
    rep.note(f"형식 상위: {dict(forms.most_common(5))}")
    rep.finish()
    print(f"\n오수정화 {n:,}행 · 건물 {len(seen):,}동 → {OUT}")
    print(f"  형식 상위: {dict(forms.most_common(4))}")
    print(f"  단위: {dict(units)}")
    for k, v in have.items():
        print(f"  {k:8} {v:7,} ({v/max(n,1)*100:5.1f}%)")


if __name__ == "__main__":
    main()
