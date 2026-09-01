#!/usr/bin/env python3
"""공동주택가격 → 호실·연도별 공시가격 1행(2026-09-01).

## 무엇인가

호실마다 해마다 고시되는 **공동주택 공시가격**이다. 2008~2026년, 서울 2,971만 행.

    관리건축물대장PK = 전유부 PK (호실 하나)
    기준일자        = YYYY0101 (연 1회 고시)
    주택가격        = 원

## 왜 필요한가

**시세 대비 공시가 비율**을 낼 수 있다. 공시가는 시세의 60~70% 언저리로 고시되는데
그 비율이 지역·연식·규모마다 다르다. 실거래가 없는 물건도 공시가로 시세를 어림잡는
길이 열린다. 19년치라 **가격 추이**도 그대로 나온다.

## 원본에 같은 (호실, 연도)가 두 번 온다

실측: 유일한 조합 27,945,429 · **값이 같은 중복 1,770,506** · **값이 다른 중복 693**.

값이 같은 것은 원본의 잡음이라 하나만 남긴다. **값이 다른 693건은 남긴다** —
어느 쪽이 맞는지 우리가 모르므로 고르면 지어내는 것이 된다. seq 로 갈라 둘 다 싣고,
읽는 쪽이 seq=0 만 보면 하나만, 다 보면 둘 다 본다.

## 무겁다 — 6.7GB · 2,971만 행

칸을 최소로 줄인다. 주소·건물명은 전유부(master.building_unit)에 이미 있으므로
여기서는 **PK · 연도 · 가격**만 싣는다. 같은 값을 두 번 저장하면 6GB 가 12GB 가 된다.

    data/.venv/bin/python data/tools/build_aptprice.py
"""
import collections
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hub_csv import rows as hub_rows          # noqa: E402
from build_report import Report               # noqa: E402

OUT = "data/tools/_aptprice.jsonl"

A = {
    "PK": "관리건축물대장PK",
    "기준일자": "기준일자", "가격": "주택가격",
}


def main():
    rep = Report("build_aptprice", src=("대장", "공동주택가격"), used=A.values())
    out = open(OUT, "w")
    n = 0
    yrs = collections.Counter()
    zero = 0
    # (호실, 연도) → 이미 실은 가격들. 같은 값이면 버리고, 다른 값이면 seq 를 올려 남긴다.
    seen: dict = {}
    dup_same = dup_diff = 0

    for r in hub_rows("대장", "공동주택가격", need=list(A.values())):
        g = lambda k: (r[A[k]] or '').strip()
        rep.read()
        pk = g('PK')
        if not pk:
            rep.drop("PK 없음"); continue

        d = g('기준일자')
        if not (len(d) == 8 and d.isdigit()):
            rep.drop("기준일자 형식 이상", pk); continue
        year = int(d[:4])
        if not (1990 <= year <= 2030):
            rep.drop("기준일자 연도가 범위 밖", pk); continue

        p = g('가격')
        val = None
        if p:
            try:
                val = int(float(p))
            except ValueError:
                rep.null("주택가격이 숫자가 아님", pk, p)
        if val == 0:
            zero += 1        # 0 은 「고시 안 됨」이지 결측이 아니다 — 그대로 싣는다

        key = (pk, year)
        prev = seen.get(key)
        if prev is None:
            seq = 0
            seen[key] = [val]
        elif val in prev:
            dup_same += 1
            # 같은 값이 두 번 — 원본 잡음. 하나만 남긴다.
            # **장부에 남긴다.** 안 적으면 「읽은 줄 2,971만 · 낸 줄 2,794만」인데
            # 178만 줄이 어디로 갔는지 문서만 봐서는 알 수 없다(2026-09-01).
            rep.merge("같은 (호실,연도)에 값이 같은 중복 — 하나만 남김", pk)
            continue
        else:
            dup_diff += 1
            seq = len(prev)
            prev.append(val)
            rep.note_odd("같은 (호실,연도)에 값이 다름 — 둘 다 실음", pk, f"{prev[0]} vs {val}")

        out.write(json.dumps({'PK': pk, '연도': year, '순번': seq, '가격': val},
                             ensure_ascii=False) + "\n")
        rep.write()
        n += 1
        yrs[year] += 1
    out.close()
    rep.note(f"가격 0 인 줄 {zero:,}")
    rep.note(f"중복 — 값 같아 버림 {dup_same:,} · 값 달라 남김 {dup_diff:,}")
    rep.finish()
    print(f"\n공동주택가격 {n:,}행 → {OUT}")
    ks = sorted(yrs)
    print(f"  연도 {ks[0]}~{ks[-1]} ({len(ks)}개) · 가격 0 인 줄 {zero:,}")
    print(f"  중복: 값 같아 버림 {dup_same:,} · 값 달라 남김 {dup_diff:,}")


if __name__ == "__main__":
    main()
