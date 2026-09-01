#!/usr/bin/env python3
"""건물에너지(전기·가스) → 필지·월별 사용량 1행(2026-09-01).

## 무엇인가

건축HUB 가 국토부 건물에너지 통합 자료로 주는 **월별 사용량**이다.
전기는 kWh, 가스도 kWh 로 환산되어 온다(원본 칸 이름이 둘 다 `사용량(KWh)`).

    전기  82,941행 / 2구 표본 · 가스 51,334행
    기간  2026-01 ~ 2026-04 (4개월)

## 열쇠는 PNU + 새주소일련번호 + 사용년월

한 필지에 건물이 여럿일 수 있어 **새주소일련번호**로 갈라진다. 그것까지 넣어야
키가 유일하다(실측: 중복 0건). 건물 PK 가 아니라 **주소 기준**이라 대장과 직접
잇지 않는다 — 잇는 것은 나중 일이고, 지금은 원본 그대로 싣는다.

## 전기와 가스를 한 표에 담는다

칸이 완전히 같고(14칸) 성격도 같다. `kind` 로 갈라 한 표에 두면
「이 건물의 에너지」를 한 번에 읽을 수 있다. 따로 두면 매번 두 번 조회해야 한다.

## 원본을 거르지 않는다

사용량이 0인 줄도 싣는다(가스 2건). 0은 「안 썼다」는 사실이지 결측이 아니다.
빈칸이면 비운다.

    data/.venv/bin/python data/tools/build_energy.py
"""
import collections
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hub_csv import rows as hub_rows          # noqa: E402
from build_report import Report               # noqa: E402

OUT = "data/tools/_energy.jsonl"
MP = {'0': '1', '1': '2', '2': '1'}

# 전기·가스 칸이 같다 — 하나로 쓴다
E = {
    "주소": "대지위치", "도로명주소": "도로명대지위치",
    "시군구": "시군구코드", "법정동": "법정동코드", "대지구분": "대지구분코드",
    "번": "번", "지": "지",
    "사용년월": "사용년월", "사용량": "사용량(KWh)",
    "새주소일련번호": "새주소일련번호",
    "새주소도로코드": "새주소도로코드", "새주소본번": "새주소본번", "새주소부번": "새주소부번",
}

KINDS = [("전기", "elec"), ("가스", "gas")]


def mkpnu(sgg, emd, dg, bon, bu):
    if not (sgg.isdigit() and emd.isdigit() and bon.isdigit() and bu.isdigit()):
        return None
    p = f"{sgg}{emd}{MP.get(dg, dg)}{int(bon):04d}{int(bu):04d}"
    return p if len(p) == 19 else None


def main():
    out = open(OUT, "w")
    n = 0
    per = collections.Counter()
    ym = collections.Counter()
    for ko, en in KINDS:
        rep = Report(f"build_energy_{en}", src=("에너지", ko), used=E.values())
        seen = set()
        for r in hub_rows("에너지", ko, need=list(E.values())):
            g = lambda k: (r[E[k]] or '').strip()
            rep.read()
            pnu = mkpnu(g('시군구'), g('법정동'), g('대지구분'), g('번'), g('지'))
            if not pnu:
                rep.drop("PNU 조립 불가", g('주소')); continue

            y = g('사용년월')
            if not (len(y) == 6 and y.isdigit()):
                rep.drop("사용년월 형식 이상", pnu); continue

            seq = g('새주소일련번호') or None
            key = (pnu, seq, y)
            if key in seen:
                # 키가 유일하다는 전제다(실측 중복 0). 어긋나면 조용히 덮지 않고 남긴다.
                rep.note_odd("PNU+일련번호+사용년월이 두 번 나옴", pnu, y)
            seen.add(key)

            amt = g('사용량')
            val = None
            if amt:
                try:
                    val = float(amt)
                except ValueError:
                    rep.null("사용량이 숫자가 아님", pnu, amt)

            out.write(json.dumps({
                'PNU': pnu, '종류': en, '사용년월': y, '사용량': val,
                '새주소일련번호': seq,
                '주소': g('주소') or None, '도로명주소': g('도로명주소') or None,
                '시군구코드': g('시군구') or None, '법정동코드': g('법정동') or None,
            }, ensure_ascii=False) + "\n")
            rep.write()
            n += 1
            per[en] += 1
            ym[y] += 1
        rep.note(f"필지×월 {per[en]:,}행")
        rep.finish()
    out.close()
    print(f"\n에너지 {n:,}행 → {OUT}")
    print(f"  종류: {dict(per)}")
    print(f"  사용년월: {dict(sorted(ym.items()))}")


if __name__ == "__main__":
    main()
