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

  legal_bcr  그 용도지역의 서울시 조례값. 종을 모르면(「일반주거지역」처럼 상위 분류만
  legal_far  올 때) **비운다.** 제1·2·3종이 60/150 · 60/200 · 50/250 로 달라서 하나를
             고르면 지어내는 것이고, 그 값은 확인설명서로 그대로 나간다.

  regulations  용도지역을 뺀 나머지 전부. [명, 저촉여부, 코드] 목록.
               **UQ 코드(국토계획법)를 먼저, 그 다음 다른 법령.** 토지이음 화면이
               「국토의 계획 및 이용에 관한 법률에 따른 지역·지구등」과 「다른 법령 등에
               따른 지역·지구등」으로 나누는 것과 같은 순서다.
               각 묶음 안에서 포함 → 저촉 → 접함, 같은 등급끼리는 가나다순. 중복은 뺀다
               (같은 규제가 도면 단위로 여러 줄 오기도 한다 — 실측 토지거래허가구역 3줄).

    data/.venv/bin/python data/tools/build_luris.py [원장.csv]
"""
import csv
import glob
import gzip
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_legal import LEGAL                 # noqa: E402  조례표(서울시). 산식 정본은 그쪽
from build_report import Report               # noqa: E402

OUT = "data/exports/luris/parcel_luris.csv.gz"
# 저촉여부 순서 — 화면에 나가는 차례다
RANK = {"포함": 0, "저촉": 1, "접함": 2}


def find_src():
    c = sorted(glob.glob("data/raw/토지이용계획정보_서울/AL_D155_*.csv"))
    if not c:
        sys.exit("✗ data/raw/토지이용계획정보_서울/AL_D155_*.csv 없음 — "
                 "scripts/crawl_all.py --group annual 로 받으세요")
    return c[-1]                               # 여러 판이면 최신


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else find_src()
    rep = Report("build_luris", src=f"{os.path.basename(src)} (토지이용계획정보 원장)")
    print(f"원장: {src}")

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
                # 걸친 필지 — 어느 쪽 조례를 쓸지는 원장이 안 알려 준다. 이름만 병기하고
                # 법정치는 비운다. 면적 비중이 없으면 가중평균도 지어내는 것이다.
                rep.note_odd("용도지역이 둘 이상 — 이름만 병기하고 법정치는 비움", pnu, use_zone)
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
    rep.finish()
    print(f"\n완료: {n:,}필지 → {OUT} ({os.path.getsize(OUT)/2**20:.1f}MB)")
    print(f"  용도지역 {z:,} ({z/n*100:.1f}%) · 법정건폐/용적 {b:,} ({b/n*100:.1f}%)")
    print(f"  용도지역 둘 이상(법정치 비움) {multi:,} · 종 없는 상위분류만 {nolaw:,}")


if __name__ == "__main__":
    main()
