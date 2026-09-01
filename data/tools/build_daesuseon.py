#!/usr/bin/env python3
"""대수선 이력: 인허가 기본개요 → PNU 별 **구분마다 최근 날짜**.

## 무엇을 담나

인허가 한 건 = 날짜 하나 + 건축구분 하나다. 한 필지에 그런 건이 여러 개 쌓인다.
강남구 삼성동 159번지는 26건이다:

    2002-03-13 증축 · 2008-07-02 대수선 · 2010-05-31 증축 · … · 2026-06-22 대수선

옛 판은 **가장 늦은 날짜 하나**만 남기고 구분을 버렸다. 그래서 「2026-06-22 에 뭘
했는지」를 알 수 없었다. 일원동 50번지는 최근이 증축이라, 대수선 이력(2025-12-31)이
아예 안 보였다. 강남구만 봐도 구분이 두 종류 이상인 필지가 602개다.

    {PNU: {"증축":  {"최근": "20261224", "건수": 12},
           "대수선": {"최근": "20260622", "건수": 14},
           "_최근":  {"일자": "20261224", "구분": "증축"},
           "_건수": 26}}

## 날짜는 사용승인일이다 (2026-08-31 변경)

옛 판은 `c[37]`(실제착공일)을 1순위로 썼다. 주석은 「사용승인일」이라 적혀 있었는데
자리가 달랐다. 서울 대수선류 94,480건 실측:

    사용승인일 있음 85.3%  ·  허가일 81.6%  ·  실제착공일 56.0%

제일 잘 찬 칸(사용승인일)을 안 쓰고 제일 빈 칸(착공일)을 1순위로 써서 18.4%가 버려졌다.
뜻으로도 사용승인일이 맞다 — **공사가 끝나 쓸 수 있게 된 날**이라야 「언제 새것처럼
됐나」에 답이 되고, 건물 연식도 사용승인일로 재니 같은 자로 비교된다. 착공만 하고
승인이 안 난 건은 아직 공사 중이다. 착공→사용승인 간격은 중앙값 2개월이다.

    날짜 = 사용승인일 → (없으면) 건축허가일

    data/.venv/bin/python data/tools/build_daesuseon.py
"""
import collections
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hub_csv import rows                                          # noqa: E402
from build_report import Report                                   # noqa: E402

OUT = "data/tools/_daesuseon_seoul.json"
# 신축·용도변경·발코니·행정변경·가설은 뺀다 — 「고쳤다」가 아니다
TARGET = ["증축", "개축", "재축", "대수선", "이전"]
MP = {"0": "1", "1": "2", "2": "1"}

NEED = ["시군구코드", "법정동코드", "대지구분코드", "번", "지",
        "건축구분명", "사용승인일", "건축허가일"]


def mkpnu(sgg, emd, dg, bon, bu):
    if not (sgg.isdigit() and emd.isdigit() and bon.isdigit() and bu.isdigit()):
        return None
    p = f"{sgg}{emd}{MP.get(dg, dg)}{int(bon):04d}{int(bu):04d}"
    return p if len(p) == 19 else None


def dig(s):
    s = "".join(ch for ch in (s or "") if ch.isdigit())
    return s if len(s) == 8 else None


def main():
    # 처리결과 문서 — 인허가 기본개요 55만 줄을 읽는데 2026-09-01 까지 장부가 없었다.
    # 신축·용도변경 등 안 쓰는 구분을 걸러 내는 단계라 「몇 줄이 왜 빠졌나」가 특히 중요하다.
    rep = Report("build_daesuseon", src=("인허가", "기본개요"), used=NEED + ["건축구분명"])
    acc = collections.defaultdict(lambda: collections.defaultdict(lambda: {"최근": None, "건수": 0}))
    src = collections.Counter()
    n = no_date = no_pnu = 0
    skipped = collections.Counter()
    for r in rows("인허가", "기본개요", need=NEED):
        rep.read()
        g = r["건축구분명"].strip()
        if g not in TARGET:
            # 신축·용도변경·발코니·행정변경·가설 — 「고쳤다」가 아니라 우리 관심 밖이다.
            skipped[g or "(빈칸)"] += 1
            continue
        pnu = mkpnu(r["시군구코드"], r["법정동코드"], r["대지구분코드"], r["번"], r["지"])
        if not pnu:
            no_pnu += 1
            rep.drop("PNU 조립 불가", r["시군구코드"] + r["법정동코드"])
            continue
        d = dig(r["사용승인일"])
        if d:
            src["사용승인일"] += 1
        else:
            d = dig(r["건축허가일"])
            if d:
                src["건축허가일"] += 1
        if not d:
            no_date += 1
            rep.drop("사용승인일·건축허가일 둘 다 못 읽음", pnu)
            continue
        n += 1
        rep.write()
        e = acc[pnu][g]
        e["건수"] += 1
        if not e["최근"] or d > e["최근"]:
            e["최근"] = d

    out = {}
    for pnu, by in acc.items():
        rec = {g: dict(v) for g, v in by.items()}
        top = max(by.items(), key=lambda kv: kv[1]["최근"])
        rec["_최근"] = {"일자": top[1]["최근"], "구분": top[0]}
        rec["_건수"] = sum(v["건수"] for v in by.values())
        out[pnu] = rec
    json.dump(out, open(OUT, "w"), ensure_ascii=False)

    # 관심 밖 구분은 버린 것이 아니라 **애초에 대상이 아니다.** 그래도 몇 줄이
    # 어느 구분으로 빠졌는지는 남긴다 — 나중에 대상을 넓힐 때 근거가 된다.
    for k, v in skipped.most_common():
        rep.skip(f"대상 구분 아님({k})", n=v)
    rep.output(len(out))
    rep.merge("같은 필지의 여러 건을 구분별 최근 한 값으로 접음", n=n - len(out))
    rep.note(f"날짜 출처: {dict(src)}")
    rep.finish()

    print(f"대수선류 {n:,}건 → 필지 {len(out):,}개 → {OUT}")
    print(f"  날짜 출처: {dict(src)}")
    print(f"  버림: 날짜없음 {no_date:,} · PNU불가 {no_pnu:,}")
    kinds = collections.Counter()
    multi = 0
    for rec in out.values():
        ks = [k for k in rec if not k.startswith("_")]
        kinds.update(ks)
        multi += len(ks) >= 2
    print(f"  구분별 필지수: {dict(kinds.most_common())}")
    print(f"  구분이 둘 이상인 필지: {multi:,}개 ({multi/len(out)*100:.1f}%)")


if __name__ == "__main__":
    main()
