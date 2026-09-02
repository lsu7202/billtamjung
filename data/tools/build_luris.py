#!/usr/bin/env python3
"""토지이용계획정보 원장(AL_D155) → parcel_luris.csv.gz (2026-09-01 신설).

## 왜 신설하나

용도지역·법정건폐율·법정용적률·규제는 **국토부 토지이용계획정보 원장이 정본**이다.
그런데 원장을 gz 로 바꾸는 코드가 어디에도 없었다 — 지금 쓰는 gz 는 2026-08-30 에
손으로 만든 것이고, 원장을 새로 받아도 갈아 끼울 방법이 없었다.

2026-09-01 에 build_legal(공간조인으로 계산)을 파이프라인에서 빼면서 **이 gz 가 네 칸의
유일한 출처**가 됐다. 만드는 코드가 없는 파일에 화면·확인설명서가 매달린 셈이라 신설한다.

## 원장이 주는 것

    고유번호(PNU) · 저촉여부(포함·접함·저촉) · 용도지역지구코드 · 용도지역지구명

한 필지가 여러 줄로 온다(실측 21줄까지). 폴리곤 교차로 **계산**하던 옛 방식은 99.19%
까지밖에 못 갔고, 원장을 쓰면 100% 다(표본 2,857필지 대조 · 0136 주석).

## 네 칸을 어떻게 만드나

  use_zone   조례표(LEGAL)에 있는 **종별 용도지역** 중 저촉여부가 포함·저촉인 것.
             **「접함」은 안 센다** — 토지이음도 그 칸에 안 넣는다. 옆 필지에 닿았을 뿐이다.
             둘 이상이면 포함을 저촉보다 앞세우고, 그래도 여럿이면 이름을 병기한다
             (하나를 고르면 지어내는 것이 된다).

  legal_bcr  한 지역이면 서울시 조례값 그대로(전 필지의 95.3%).
  legal_far  **걸친 필지는 국토계획법 제84조대로 면적 가중평균**한다. 작은 쪽이 330㎡
             (상업 낀 곳은 660㎡)를 넘으면 법이 가중평균을 금하므로 값을 병기한다.
             면적 비중은 공간조인(_spatial_ALL.json), 필지 면적은 토지특성 원장에서 온다.
             원장과 공간조인의 용도지역 목록이 다르면(걸침의 7.2%) **비운다.**
             종을 모르면(「일반주거지역」처럼 상위 분류만 올 때)도 비운다 — 제1·2·3종이
             60/150 · 60/200 · 50/250 로 달라서 하나를 고르면 지어내는 것이고, 그 값은
             확인설명서로 그대로 나간다.

  regulations  용도지역을 뺀 나머지 전부. [명, 저촉여부, 코드] 목록.
               **UQ 코드(국토계획법)를 먼저, 그 다음 다른 법령.** 토지이음 화면이
               「국토의 계획 및 이용에 관한 법률에 따른 지역·지구등」과 「다른 법령 등에
               따른 지역·지구등」으로 나누는 것과 같은 순서다.
               각 묶음 안에서 포함 → 저촉 → 접함, 같은 등급끼리는 가나다순. 중복은 뺀다
               (같은 규제가 도면 단위로 여러 줄 오기도 한다 — 실측 토지거래허가구역 3줄).

## 토지이음과는 왜 안 맞나 (2026-09-02 실측)

걸친 필지의 건폐·용적을 토지이음 「행위제한내용설명 → 건폐율·용적률」과 맞추려 했는데,
**토지이음 화면이 자기 자신과 안 맞는다.** 화면에 같이 실린 산출면적과 조례값으로
화면의 산출정보를 다시 계산해 본 결과(47필지):

    자기 화면으로 재현됨            8필지 (17.0%)
    조례 최대치를 넘는 값           12필지  ← 가중평균으로는 나올 수 없다
    그중 건폐율 110%                2필지  ← 대지보다 바닥이 넓다는 뜻

    강남구 삼성동 35-29  전체 11.4㎡ = 제2종 5.7㎡ + 제3종 5.7㎡
                        조례 60/200 · 50/250 → 가중평균 55% / 225%
                        토지이음 화면 110% / 450%   (60+50, 200+250 을 그냥 더한 값)

이 필지는 「제3종일반주거지역(안)」과 「지구단위계획구역(안)」이 걸려 있다. 예정 지역이
현재 지역과 같은 땅에 겹치는데 토지이음이 두 겹으로 세어 비중 합이 2가 됐다. 화면 위에
「용도지역별 면적은 단순 추출한 것으로서 전체면적과 일치하지 않을 수 있습니다」,
「본 서비스는 법적 효력이 없으며」라고 적혀 있는 그대로다.

그래서 **토지이음을 정답지로 삼지 않는다.** 우리는 국토계획법 제84조와 서울시 도시계획
조례를 따른다. 토지이음도 근거법령으로 같은 조문을 든다. 대조 도구는 남겨 뒀다 —
scripts/verify_eum_selfconsistent.py.

    data/.venv/bin/python data/tools/build_luris.py [원장.csv]
"""
import collections
import csv
import decimal
import glob
import gzip
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_legal import LEGAL                 # noqa: E402  조례표(서울시). 산식 정본은 그쪽
from build_report import Report               # noqa: E402

OUT = "data/exports/luris/parcel_luris.csv.gz"
SPATIAL = "data/tools/_spatial_ALL.json"      # 용도지역 면적 비중 (spatial_join 단계)
LAND = "data/tools/_land_master.jsonl"        # 필지 면적 (land_master 단계)
# 저촉여부 순서 — 화면에 나가는 차례다
RANK = {"포함": 0, "저촉": 1, "접함": 2}


def find_src():
    c = sorted(glob.glob("data/raw/토지이용계획정보_서울/AL_D155_*.csv"))
    if not c:
        sys.exit("✗ data/raw/토지이용계획정보_서울/AL_D155_*.csv 없음 — "
                 "scripts/crawl_all.py --group annual 로 받으세요")
    return c[-1]                               # 여러 판이면 최신


def load_ratios():
    """PNU → {용도지역명: 면적비중}. 공간조인이 낸 것."""
    if not os.path.exists(SPATIAL):
        sys.exit(f"✗ {SPATIAL} 없음 — 파이프라인의 spatial_join 단계를 먼저 돌리세요")
    sp = json.load(open(SPATIAL, encoding="utf-8"))
    out = {}
    for pnu, v in sp.items():
        z = {x["명"]: x["비중"] for x in (v.get("용도지역") or []) if x["명"] in LEGAL}
        if z:
            out[pnu] = z
    return out


def load_areas():
    """PNU → 필지 면적(㎡). 토지특성 원장이 준다."""
    if not os.path.exists(LAND):
        sys.exit(f"✗ {LAND} 없음 — 파이프라인의 land_master 단계를 먼저 돌리세요")
    out = {}
    for line in open(LAND, encoding="utf-8"):
        r = json.loads(line)
        if r.get("면적"):
            out[r["PNU"]] = float(r["면적"])
    return out


def half_up(x):
    """사사오입. 파이썬 round() 는 「오사오입」이라 235.5 를 236 이 아니라 236… 짝수로 붙인다.

    행정 관례는 사사오입이고 토지이음도 그렇게 낸다(실측: 참값 235.5 → 화면 236%).
    소수 오차도 같이 걷어낸다 — 면적을 곱했다 나누면 235.5 가 235.4999… 로 떨어져
    round() 가 235 를 준다.
    """
    return int(decimal.Decimal(repr(x)).quantize(decimal.Decimal("1"),
                                                 rounding=decimal.ROUND_HALF_UP))


def straddle(names, ratios, area):
    """걸친 필지의 법정 건폐·용적. → (건폐, 용적, 방식) · 못 내면 (None, None, 사유)

    국토계획법 제84조: 가장 작은 부분이 330㎡(상업이 끼면 660㎡) 이하면 **면적 가중평균**,
    넘으면 각 부분에 각각 적용한다(=값을 병기한다).

    가중평균은 **비중으로 바로** 낸다. 면적은 Σ(조례×면적)÷Σ면적 에서 약분되므로
    곱했다 나눌 이유가 없고, 곱하면 소수 오차만 생긴다. 면적이 필요한 곳은 330㎡ 문턱뿐이다.
    """
    if not ratios or set(names) != set(ratios):
        # 원장이 말하는 지역과 공간조인이 찾은 지역이 다르다. 비중을 갖다 쓸 수 없다.
        return None, None, "목록불일치"
    if not area:
        return None, None, "면적없음"
    w = {n: ratios[n] for n in names}
    wsum = sum(w.values())
    if wsum <= 0:
        return None, None, "면적없음"
    threshold = 660.0 if any("상업" in n for n in names) else 330.0
    if min(w.values()) * area > threshold:
        # 법이 가중평균을 금한다 — 각 부분이 제 조례를 따른다. 값을 병기한다.
        ub = sorted({LEGAL[n][0] for n in names})
        uf = sorted({LEGAL[n][1] for n in names})
        return ", ".join(f"{x}%" for x in ub), ", ".join(f"{x}%" for x in uf), "병기"
    b = half_up(sum(LEGAL[n][0] * v for n, v in w.items()) / wsum)
    f = half_up(sum(LEGAL[n][1] * v for n, v in w.items()) / wsum)
    return f"{b}%", f"{f}%", "가중평균"


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else find_src()
    rep = Report("build_luris",
                 src=f"{os.path.basename(src)} (토지이용계획정보 원장) + 공간조인 비중 + 토지면적")
    print(f"원장: {src}")
    print("면적 비중·필지 면적 로드…")
    ratios, areas = load_ratios(), load_areas()
    rep.also_read("_spatial_ALL.json(용도지역 비중)", len(ratios), folded_to=len(ratios))
    rep.also_read("_land_master.jsonl(필지 면적)", len(areas), folded_to=len(areas))

    acc = {}                                   # PNU → {(명, 저촉, 코드)}
    with open(src, encoding="cp949", errors="replace", newline="") as f:
        rd = csv.reader(f)
        hdr = next(rd)
        need = ["고유번호", "저촉여부", "용도지역지구코드", "용도지역지구명"]
        if any(c not in hdr for c in need):
            sys.exit(f"✗ 원장 칸이 다릅니다. 기대 {need}, 받은 것 {hdr}")
        i_pnu, i_jc, i_cd, i_nm = (hdr.index(c) for c in need)
        for row in rd:
            rep.read()
            if len(row) <= i_nm:
                rep.drop("칸 수가 모자람"); continue
            pnu = row[i_pnu].strip()
            if len(pnu) != 19 or not pnu.isdigit():
                rep.drop("PNU 가 19자리 숫자가 아님", pnu); continue
            nm, jc, cd = row[i_nm].strip(), row[i_jc].strip(), row[i_cd].strip()
            if not nm:
                rep.drop("용도지역지구명이 빔", pnu); continue
            s = acc.setdefault(pnu, set())
            before = len(s)
            s.add((nm, jc, cd))
            if len(s) == before:
                # 같은 규제가 도면 단위로 여러 줄 온다. 값은 같으니 합친다.
                rep.merge("같은 (명·저촉여부·코드) 가 여러 줄", pnu)
            else:
                rep.write()

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    n = z = b = 0
    multi = nolaw = 0
    how = collections.Counter()
    with gzip.open(OUT, "wt", encoding="utf-8", newline="") as fo:
        w = csv.writer(fo)
        w.writerow(["pnu", "use_zone", "legal_bcr", "legal_far", "regulations"])
        for pnu in sorted(acc):
            items = acc[pnu]
            # ── 용도지역: 조례표에 이름이 있는 것만. 접함은 안 센다
            zones = sorted((it for it in items if it[0] in LEGAL and it[1] != "접함"),
                           key=lambda it: (RANK.get(it[1], 9), it[0]))
            if len(zones) >= 2:
                multi += 1
            use_zone = ", ".join(dict.fromkeys(x[0] for x in zones))
            bcr = far = ""
            if len(zones) == 1:
                bcr, far = (f"{v}%" for v in LEGAL[zones[0][0]])
            elif zones:
                # 걸친 필지 — 국토계획법 제84조. 면적 비중은 공간조인이 준다.
                names = [x[0] for x in zones]
                bcr, far, m = straddle(names, ratios.get(pnu), areas.get(pnu))
                how[m] += 1
                if bcr is None:
                    bcr = far = ""
                    rep.note_odd(f"걸침인데 법정치를 못 냄({m}) — 이름만 병기", pnu, use_zone)
            elif any(it[0] in ("주거지역", "일반주거지역", "상업지역", "공업지역", "녹지지역")
                     for it in items):
                nolaw += 1        # 종이 없는 상위 분류만 온다 — 조례값을 정할 수 없다

            # ── 규제: 용도지역을 뺀 나머지. UQ(국토계획법) 먼저, 그다음 다른 법령
            rest = [it for it in items if it not in set(zones) and it[0] not in LEGAL]
            rest.sort(key=lambda it: (0 if it[2].startswith("UQ") else 1,
                                      RANK.get(it[1], 9), it[0]))
            w.writerow([pnu, use_zone, bcr, far,
                        json.dumps([list(x) for x in rest], ensure_ascii=False)])
            n += 1
            z += bool(use_zone)
            b += bool(bcr)

    # 줄 단위(1,040만)와 출력 단위(필지)가 다르다. 접은 것을 안 적으면
    # 「낸 줄이 대상 줄의 50% 미만」으로 중단이 뜬다 — 접는 빌더는 원래 그렇다.
    rep.output(n)
    rep.merge("한 필지의 여러 줄을 한 행으로 접음", n=rep.n_write - n)
    rep.note(f"필지 {n:,} · 용도지역 {z:,} · 법정치 {b:,} · 걸침 {multi:,} · 종 없는 상위분류 {nolaw:,}")
    if how:
        rep.note("걸침 처리: " + " · ".join(f"{k} {v:,}" for k, v in how.most_common()))
    rep.finish()
    print(f"\n완료: {n:,}필지 → {OUT} ({os.path.getsize(OUT)/2**20:.1f}MB)")
    print(f"  용도지역 {z:,} ({z/n*100:.1f}%) · 법정건폐/용적 {b:,} ({b/n*100:.1f}%)")
    print(f"  용도지역 둘 이상 {multi:,} · 종 없는 상위분류만 {nolaw:,}")
    for k, v in how.most_common():
        print(f"    걸침 {k:<8} {v:>7,}")


if __name__ == "__main__":
    main()
