#!/usr/bin/env python3
"""총괄표제부(단지) 마스터 — mart_djy_02 → _complex.jsonl (2026-08-31).

## 왜 만드나
지금까지 총괄표제부는 **대지면적·건폐율·용적률 세 칸만 빌려 쓰고 버렸다**(build_building_master.load_chg).
그래서 두 가지가 우리 데이터에 없다:
  ① 단지명 — 「헬리오시티」「현대아파트」로 부를 이름이 없다
  ② 동별 표제부가 없는 33곳 — 학교·관공서·군시설. 총괄표제부에만 있어서 건물로 안 보인다
부속지번 마트(djy_05)는 단지 단위 필지 관계도 싣는데 받을 표가 없어,
building_parcels 에 갈 곳 없는 14,255행(단지 3,669개)이 떠 있었다.

## 2026-08-31 — 이름으로 읽는다

옛 판은 파이프 전국본을 자리 번호로 읽었다. 총괄표제부는 머리 블록이 표제부보다
**두 칸 밀려** 있어서, 표제부 감각으로 p[5] 를 주소로 읽으면 엉뚱한 칸이 들어온다.
실제로 그렇게 다쳤다. 새 서울본은 머리가 있는 CSV 라 이름으로 읽는다.

**클린징을 하지 않는다.** 옛 판은 건폐율>100%·용적률>2000% 를 다시 계산해 넣었다.
그건 대장이 준 값이 아니다. 이상하면 이상한 채로 싣고 사실만 기록한다.

    data/.venv/bin/python data/tools/build_complex.py
"""
import collections
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hub_csv import rows as hub_rows          # noqa: E402
from build_report import Report               # noqa: E402

OUT = "data/tools/_complex.jsonl"

MP = {'0': '1', '1': '2', '2': '1'}

# ── 총괄표제부에서 읽는 칸 ──────────────────────────────────────
C = {
    "PK": "관리건축물대장PK", "대장구분": "대장구분코드명",
    "주소": "대지위치", "도로명주소": "도로명대지위치", "단지명": "건물명",
    "시군구": "시군구코드", "법정동": "법정동코드", "대지구분": "대지구분코드",
    "번": "번", "지": "지",
    "대지면적": "대지면적(㎡)", "건축면적": "건축면적(㎡)", "건폐율": "건폐율(%)",
    "연면적": "연면적(㎡)", "용적산정": "용적률산정연면적(㎡)", "용적률": "용적률(%)",
    "주용도코드": "주용도코드", "주용도": "주용도코드명", "기타용도": "기타용도",
    "세대수": "세대수(세대)", "가구수": "가구수(가구)",
    "주건축물수": "주건축물수", "부속건축물수": "부속건축물수",
    "부속건축물면적": "부속건축물면적(㎡)",
    "총주차": "총주차수",
    "옥내기계": "옥내기계식대수(대)", "옥외기계": "옥외기계식대수(대)",
    "옥내자주": "옥내자주식대수(대)", "옥외자주": "옥외자주식대수(대)",
    "허가일": "허가일", "착공일": "착공일", "사용승인일": "사용승인일",
    "대장종류": "대장종류코드명", "외필지수": "외필지수",
}


def mkpnu(sgg, emd, dg, bon, bu):
    if not (sgg.isdigit() and emd.isdigit() and bon.isdigit() and bu.isdigit()):
        return None
    s = f"{sgg}{emd}{MP.get(dg, dg)}{int(bon):04d}{int(bu):04d}"
    return s if len(s) == 19 else None


def fnum(s):
    try:
        return float(str(s).replace(',', '').strip() or 0)
    except ValueError:
        return 0.0


def _int(s):
    v = int(fnum(s))
    return v or None


def _num(s):
    v = fnum(s)
    return round(v, 2) if v else None


def _ymd(s):
    s = (s or '').strip()
    return s if (len(s) == 8 and s.isdigit() and '19000101' <= s <= '20301231') else None


def main():
    out = open(OUT, "w")
    rep = Report("build_complex", src=("대장", "총괄표제부"), used=C.values())
    n = 0
    kind = collections.Counter()
    have = collections.Counter()

    for r in hub_rows("대장", "총괄표제부", need=list(C.values())):
        g = lambda k: (r[C[k]] or '').strip()
        rep.read()
        pk = g('PK')
        if not pk:
            rep.drop("PK 없음"); continue

        pnu = mkpnu(g('시군구'), g('법정동'), g('대지구분'), g('번'), g('지'))
        if not pnu:
            rep.null("PNU 조립 불가", pk, g('주소'))

        # 주차 — 네 쌍(옥내·옥외 × 기계·자주)의 합. 총주차수 칸과 대조만 하고 합을 쓴다.
        park = int(fnum(g('옥내기계')) + fnum(g('옥외기계'))
                   + fnum(g('옥내자주')) + fnum(g('옥외자주'))) or None

        # **클린징을 하지 않는다.** 이상하면 이상한 채로 싣고 기록만 남긴다.
        bcr, far = fnum(g('건폐율')), fnum(g('용적률'))
        if bcr > 100:
            rep.note_odd("건폐율 100% 초과 — 원본 그대로 실음", pk, bcr)
        if far > 2000:
            rep.note_odd("용적률 2000% 초과 — 원본 그대로 실음", pk, far)

        addr = g('주소')
        rec = {
            'PK': pk, '대장구분': g('대장구분'), '대장종류': g('대장종류') or None,
            'PNU': pnu,
            # 98.7% 는 '서울특별시…' 로 완전하고 1.3%(246건)는 지번만 있다.
            # 지어내지 않는다 — 불완전한 것은 그대로 두고 addr_full 로 표시만 나눈다.
            '주소': addr or None, '주소완전': bool(addr.startswith('서울')),
            '도로명주소': g('도로명주소') or None, '단지명': g('단지명') or None,
            '시군구코드': g('시군구') or None, '법정동코드': g('법정동') or None,
            '대지면적': _num(g('대지면적')), '건축면적': _num(g('건축면적')), '건폐율': _num(bcr),
            '연면적': _num(g('연면적')), '용적률산정연면적': _num(g('용적산정')), '용적률': _num(far),
            '주용도코드': g('주용도코드') or None, '주용도': g('주용도') or None,
            '기타용도': g('기타용도') or None,
            '세대수': _int(g('세대수')), '가구수': _int(g('가구수')),
            '주건축물수': _int(g('주건축물수')), '부속건축물수': _int(g('부속건축물수')),
            '부속건축물면적': _num(g('부속건축물면적')),
            '주차': park, '외필지수': _int(g('외필지수')),
            '허가일': _ymd(g('허가일')), '착공일': _ymd(g('착공일')),
            '사용승인일': _ymd(g('사용승인일')),
        }
        out.write(json.dumps(rec, ensure_ascii=False) + "\n")
        rep.write()
        n += 1
        kind[g('대장구분') or '(없음)'] += 1
        for k in ('PNU', '주소', '단지명', '대지면적', '용적률', '세대수', '주차', '사용승인일'):
            if rec[k] is not None:
                have[k] += 1
    out.close()
    rep.note(f"대장구분: {dict(kind)}")
    rep.finish()
    print(f"\n총괄표제부 {n:,}개 → {OUT}")
    for k, v in have.items():
        print(f"  {k:10} {v:6,} ({v/max(n,1)*100:5.1f}%)")


if __name__ == "__main__":
    main()
