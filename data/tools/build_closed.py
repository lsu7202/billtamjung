#!/usr/bin/env python3
"""폐쇄말소대장 표제부 → 사라진 건물 1행(2026-09-01).

## 무엇인가

**철거·멸실되어 대장이 닫힌 건물**이다. 현행 표제부에서는 사라졌고 여기에만 남는다.

    서울 346,402행 · 78칸 (현행 표제부 77칸 + 폐쇄말소구분·폐쇄말소일)

## 왜 필요한가

「건축물대장에 있는 주소인데 연속지적도에 없다」던 26,295건이 있었다.
현행 대장에서 사라진 건물이 우리 데이터에는 남아 있거나, 반대로 옛 주소를 물어보면
아무것도 안 나오는 일이 생긴다. **닫힌 대장을 갖고 있어야 「왜 없는지」에 답할 수 있다.**

중개 실무에서도 쓸모가 있다. 그 자리에 무엇이 있었는지, 언제 헐렸는지가
신축 검토·토지 매입에서 바로 필요한 정보다.

## 현행 표제부와 섞지 않는다

관리번호 계열이 다르다 — `관리폐쇄말소대장PK` 이지 `관리건축물대장PK` 가 아니다.
표를 따로 두고, 화면에서도 「폐쇄」임을 반드시 표시해야 한다.
살아 있는 건물과 섞이면 없는 건물을 팔게 된다.

## 폐쇄말소구분 넷

    말소 · 폐쇄 · 일부말소 · 일부폐쇄

「일부」는 건물의 일부만 닫힌 것이라 나머지는 살아 있다. 구분을 그대로 싣는다.

    data/.venv/bin/python data/tools/build_closed.py
"""
import collections
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hub_csv import rows as hub_rows          # noqa: E402
from build_report import Report               # noqa: E402

OUT = "data/tools/_closed.jsonl"
MP = {'0': '1', '1': '2', '2': '1'}

C = {
    "PK": "관리폐쇄말소대장PK",
    "폐쇄구분": "폐쇄말소구분코드명", "폐쇄일": "폐쇄말소일",
    "대장구분": "대장구분코드명", "대장종류": "대장종류코드명",
    "주소": "대지위치", "도로명주소": "도로명대지위치", "건물명": "건물명", "동명": "동명칭",
    "시군구": "시군구코드", "법정동": "법정동코드", "대지구분": "대지구분코드",
    "번": "번", "지": "지",
    "대지면적": "대지면적(㎡)", "건축면적": "건축면적(㎡)", "건폐율": "건폐율(%)",
    "연면적": "연면적(㎡)", "용적산정": "용적률산정연면적(㎡)", "용적률": "용적률(%)",
    "구조": "구조코드명", "주용도코드": "주용도코드", "주용도": "주용도코드명",
    "기타용도": "기타용도",
    "지상층수": "지상층수", "지하층수": "지하층수", "높이": "높이(m)",
    "세대수": "세대수(세대)", "가구수": "가구수(가구)", "호수": "호수(호)",
    "허가일": "허가일", "착공일": "착공일", "사용승인일": "사용승인일",
    "생성일자": "생성일자",
}


def mkpnu(sgg, emd, dg, bon, bu):
    if not (sgg.isdigit() and emd.isdigit() and bon.isdigit() and bu.isdigit()):
        return None
    p = f"{sgg}{emd}{MP.get(dg, dg)}{int(bon):04d}{int(bu):04d}"
    return p if len(p) == 19 else None


def fnum(s):
    """문자열이든 숫자든 받는다 — 호출부에서 이미 수치화된 값이 넘어오기도 한다."""
    if isinstance(s, (int, float)):
        return float(s)
    try:
        return float((s or '').strip())
    except ValueError:
        return 0.0


def _num(s):
    v = fnum(s)
    return round(v, 2) if v else None


def _int(s):
    v = int(fnum(s))
    return v or None


def _ymd(s):
    s = (s or '').strip()
    return s if (len(s) == 8 and s.isdigit() and '19000101' <= s <= '20301231') else None


def main():
    rep = Report("build_closed", src=("폐쇄말소", "표제부"), used=C.values())
    out = open(OUT, "w")
    n = 0
    kinds = collections.Counter()
    yrs = collections.Counter()
    have = collections.Counter()

    for r in hub_rows("폐쇄말소", "표제부", need=list(C.values())):
        g = lambda k: (r[C[k]] or '').strip()
        rep.read()
        pk = g('PK')
        if not pk:
            rep.drop("PK 없음"); continue

        pnu = mkpnu(g('시군구'), g('법정동'), g('대지구분'), g('번'), g('지'))
        if not pnu:
            rep.null("PNU 조립 불가", pk, g('주소'))

        closed = _ymd(g('폐쇄일'))
        if g('폐쇄일') and not closed:
            rep.null("폐쇄말소일 형식 이상", pk, g('폐쇄일'))

        # **클린징하지 않는다** — 대장이 준 값 그대로. 이상하면 기록만 남긴다.
        bcr, far = fnum(g('건폐율')), fnum(g('용적률'))
        if bcr > 100:
            rep.note_odd("건폐율 100% 초과 — 원본 그대로 실음", pk, bcr)
        if far > 2000:
            rep.note_odd("용적률 2000% 초과 — 원본 그대로 실음", pk, far)

        rec = {
            'PK': pk, 'PNU': pnu,
            '폐쇄구분': g('폐쇄구분') or None, '폐쇄일': closed,
            '대장구분': g('대장구분') or None, '대장종류': g('대장종류') or None,
            '주소': g('주소') or None, '도로명주소': g('도로명주소') or None,
            '건물명': g('건물명') or None, '동명': g('동명') or None,
            '시군구코드': g('시군구') or None, '법정동코드': g('법정동') or None,
            '대지면적': _num(g('대지면적')), '건축면적': _num(g('건축면적')), '건폐율': _num(bcr),
            '연면적': _num(g('연면적')), '용적률산정연면적': _num(g('용적산정')), '용적률': _num(far),
            '구조': g('구조') or None,
            '주용도코드': g('주용도코드') or None, '주용도': g('주용도') or None,
            '기타용도': g('기타용도') or None,
            '지상층수': _int(g('지상층수')), '지하층수': _int(g('지하층수')),
            '높이': _num(g('높이')),
            '세대수': _int(g('세대수')), '가구수': _int(g('가구수')), '호수': _int(g('호수')),
            '허가일': _ymd(g('허가일')), '착공일': _ymd(g('착공일')),
            '사용승인일': _ymd(g('사용승인일')),
            '생성일자': _ymd(g('생성일자')),
        }
        out.write(json.dumps(rec, ensure_ascii=False) + "\n")
        rep.write()
        n += 1
        kinds[rec['폐쇄구분'] or '(없음)'] += 1
        if closed:
            yrs[closed[:4]] += 1
        for k in ('PNU', '폐쇄일', '주소', '연면적', '사용승인일'):
            if rec[k] is not None:
                have[k] += 1
    out.close()

    rep.note(f"폐쇄말소구분: {dict(kinds)}")
    rep.finish()
    print(f"\n폐쇄말소 건물 {n:,}동 → {OUT}")
    print(f"  구분: {dict(kinds)}")
    print(f"  폐쇄 연도(최근 5): {dict(sorted(yrs.items())[-5:])}")
    for k, v in have.items():
        print(f"  {k:8} {v:7,} ({v/max(n,1)*100:5.1f}%)")


if __name__ == "__main__":
    main()
