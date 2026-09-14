#!/usr/bin/env python3
"""호실(전유부) 마스터 — 집합건물의 호 단위 1행(2026-08-31).

## 무엇을 만드나

지금까지 우리 데이터의 제일 작은 단위는 **층**이었다(층별개요). 집합건물은 한 층에
여러 호실이 있고, 실제 거래·임대는 **호 단위**로 일어난다. 그 칸이 통째로 비어 있었다.

대장은 이 정보를 두 마트에 나눠 준다:

    전유부(0309)        호실의 **신원** — 어느 동 · 몇 호 · 몇 층. 면적이 없다
    전유공용면적(0306)   그 호실의 **면적** — 전유 / 공용으로 나뉘어 여러 줄

호실 하나가 전유공용면적에는 여러 줄로 온다(전유 1줄 + 공용 n줄). 그걸 합쳐
호실당 1행으로 만든다. **전유면적과 공용면적을 따로 남긴다** — 임대료는 전유로,
관리비는 공용으로 계산하기 때문에 합쳐 버리면 둘 다 못 쓴다.

    출력  _expos.jsonl  — 관리PK + 동 + 호 → {층, 전유면적, 공용면적, 용도, 구조}

## 잇는 열쇠

전유부와 전유공용면적은 **관리건축물대장PK 가 같다**(호실마다 다른 PK 를 쓴다).
실측(종로구): 전유부 PK 는 호실 하나에 하나씩 붙는다 — 1002135448 = 5동 523호.
그래서 PK 하나 = 호실 하나이고, 동·호로 다시 맞출 필요가 없다.

## 원본을 거르지 않는다

면적이 없는 호실도 싣는다. 전유공용면적에 안 나오는 호실이 있을 수 있고,
그건 대장의 사정이지 버릴 이유가 아니다. 없으면 없다고 남긴다.

    data/.venv/bin/python data/tools/build_expos.py
"""
import collections
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hub_csv import rows as hub_rows          # noqa: E402
from build_report import Report               # noqa: E402

OUT = "data/tools/_expos.jsonl"
MP = {'0': '1', '1': '2', '2': '1'}

# ── 전유부에서 읽는 칸 ──────────────────────────────────────────
E = {
    "PK": "관리건축물대장PK", "대장구분": "대장구분코드명", "대장종류": "대장종류코드명",
    "주소": "대지위치", "도로명주소": "도로명대지위치", "건물명": "건물명",
    "시군구": "시군구코드", "법정동": "법정동코드", "대지구분": "대지구분코드",
    "번": "번", "지": "지",
    "동명": "동명칭", "호명": "호명칭",
    "층구분": "층구분코드명", "층번호": "층번호",
    "생성일자": "생성일자",
}

# ── 전유공용면적에서 읽는 칸 ────────────────────────────────────
X = {
    "PK": "관리건축물대장PK", "구분": "전유공용구분코드명",
    "면적": "면적(㎡)", "층번호명": "층번호명",
    "용도": "주용도코드명", "기타용도": "기타용도",
    "구조": "구조코드명", "주부속구분": "주부속구분코드명",
}


def mkpnu(sgg, emd, dg, bon, bu):
    if not (sgg.isdigit() and emd.isdigit() and bon.isdigit() and bu.isdigit()):
        return None
    p = f"{sgg}{emd}{MP.get(dg, dg)}{int(bon):04d}{int(bu):04d}"
    return p if len(p) == 19 else None


def fnum(s):
    try:
        return float((s or '').strip())
    except ValueError:
        return 0.0


def load_area(rep):
    """PK → {전유면적, 공용면적, 용도, 구조}. 여러 줄을 호실 하나로 합친다.

    **읽은 줄을 장부에 남긴다.** 이 마트는 전유부(1,982만 줄)보다도 큰데
    2026-09-01 까지 처리결과 문서에 한 줄도 안 잡혀 있었다 — 읽은 줄도, 접은 것도,
    PK 없어 버린 줄도. 문서만 보면 이 원본은 아예 안 읽은 것처럼 보였다.
    """
    acc = collections.defaultdict(lambda: {"전유": 0.0, "공용": 0.0,
                                           "용도": None, "기타용도": None, "구조": None,
                                           "줄": 0})
    kinds = collections.Counter()
    n_read = n_nopk = 0
    for r in hub_rows("대장", "전유공용", need=list(X.values())):
        g = lambda k: (r[X[k]] or '').strip()
        n_read += 1
        pk = g('PK')
        if not pk:
            n_nopk += 1
            continue
        a = acc[pk]
        a["줄"] += 1
        kind = g('구분')
        kinds[kind] += 1
        area = fnum(g('면적'))
        if kind == '전유':
            a["전유"] += area
            # 용도·구조는 **전유 줄의 것**을 쓴다. 공용 줄의 용도(계단실·주차장 등)를
            # 호실 용도로 쓰면 아파트가 '주차장'이 된다.
            a["용도"] = a["용도"] or (g('용도') or None)
            a["기타용도"] = a["기타용도"] or (g('기타용도') or None)
            a["구조"] = a["구조"] or (g('구조') or None)
        elif kind == '공용':
            a["공용"] += area
        else:
            rep.note_odd("전유공용 구분이 전유/공용이 아님", pk, kind)
    rep.note(f"전유공용 구분: {dict(kinds)}")
    # 곁들인 원본이라 셈도 여기서 닫는다: 읽은줄 = 접은뒤 + 버림 + 합침
    rep.also_read("대장/전유공용", n_read, folded_to=len(acc), dropped=n_nopk,
                  merged=n_read - n_nopk - len(acc))
    return acc


def main():
    rep = Report("build_expos", src=("대장", "전유부"), used=E.values())
    print("전유공용면적 합치는 중…")
    area = load_area(rep)
    print(f"  호실 {len(area):,}개의 면적 확보")

    print("전유부 조립…")
    out = open(OUT, "w")
    n = 0
    have = collections.Counter()
    dup = collections.Counter()
    for r in hub_rows("대장", "전유부", need=list(E.values())):
        g = lambda k: (r[E[k]] or '').strip()
        rep.read()
        pk = g('PK')
        if not pk:
            rep.drop("PK 없음"); continue
        dup[pk] += 1
        if dup[pk] > 1:
            # PK 하나 = 호실 하나가 전제다. 어긋나면 조용히 덮지 말고 남긴다.
            rep.note_odd("전유부 PK 가 두 번 나옴", pk, g('호명'))

        pnu = mkpnu(g('시군구'), g('법정동'), g('대지구분'), g('번'), g('지'))
        if not pnu:
            rep.null("PNU 조립 불가", pk, g('주소'))

        a = area.get(pk)
        if not a:
            rep.null("면적 없음(전유공용면적에 없는 호실)", pk, g('호명'))

        # 층은 「지상/지하」 + 번호로 부호를 만든다 — 지하 3층이 3층으로 읽히면 안 된다
        fl_no = g('층번호')
        fl = None
        if fl_no.lstrip('-').isdigit():
            fl = int(fl_no)
            if g('층구분') == '지하':
                fl = -abs(fl)

        rec = {
            'PK': pk, 'PNU': pnu,
            '대장구분': g('대장구분') or None, '대장종류': g('대장종류') or None,
            '주소': g('주소') or None, '도로명주소': g('도로명주소') or None,
            '건물명': g('건물명') or None,
            '동명': g('동명') or None, '호명': g('호명') or None,
            '층구분': g('층구분') or None, '층': fl, '층원문': fl_no or None,
            '전유면적': round(a["전유"], 2) if a and a["전유"] else None,
            '공용면적': round(a["공용"], 2) if a and a["공용"] else None,
            '용도': (a or {}).get("용도"), '기타용도': (a or {}).get("기타용도"),
            '구조': (a or {}).get("구조"),
            '생성일자': g('생성일자') or None,
        }
        out.write(json.dumps(rec, ensure_ascii=False) + "\n")
        rep.write()
        n += 1
        for k in ('PNU', '동명', '호명', '층', '전유면적', '공용면적', '용도'):
            if rec[k] is not None:
                have[k] += 1
    out.close()

    rep.note(f"전유부에는 있는데 면적이 없는 호실 {n - have['전유면적']:,}개")
    rep.finish()
    print(f"\n호실 {n:,}개 → {OUT}")
    for k, v in have.items():
        print(f"  {k:8} {v:9,} ({v/max(n,1)*100:5.1f}%)")


if __name__ == "__main__":
    main()
