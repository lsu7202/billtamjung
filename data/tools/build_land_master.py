#!/usr/bin/env python3
"""토지 마스터 조립: 토지특성(D194) + 공시지가 시계열 + 공간분석(용도지역·개발제한).
키=PNU(19). 출력: data/tools/_land_master.jsonl + 커버리지/교차검증 리포트.
"""
import sys, json, glob, collections
sys.path.insert(0,'data/tools')
from dbf_inspect import read_dbf

# ── 공시지가 시계열 (D150 폴더 자동탐색: AL_*D150*_YYYYMMDD) ──
import re
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from build_report import Report   # noqa: E402
def load_price():
    # 연도별 최신 날짜 판만 선택 (같은 연도 여러 판이면 정정 최신본)
    byyear={}
    for dbf in sorted(glob.glob("data/raw/*D150*/*.dbf")):
        m=re.search(r'(\d{4})(\d{4})', dbf.rsplit('/',1)[-1])
        if not m: continue
        yr, mmdd = m.group(1), m.group(2)
        if yr not in byyear or mmdd>byyear[yr][0]: byyear[yr]=(mmdd,dbf)
    ts={}
    for yr in sorted(byyear):
        dbf=byyear[yr][1]
        n,f,rows=read_dbf(dbf,('cp949','utf-8'))
        for r in rows():
            try: iv=int(str(r['A9']).strip() or 0)
            except: iv=0
            if iv>0: ts.setdefault(r['A0'],{})[yr]=iv
    print(f"  공시지가 판(D150 dbf) {len(byyear)}개년: {sorted(byyear)}")

    # ── 옛 구간(1990~2015) — CSV 원천 ──────────────────────────────
    # D150 dbf 는 2016년부터만 있다. 그 앞은 「공시지가_YYYY년.csv」(cp949)로 따로 받아 뒀는데
    # **빌더가 그걸 안 읽어서**, 재빌드하면 26년치가 11년치로 줄었다(2026-08-31 발견).
    # 예전에 DB 에 직접 넣은 백필이 있어 화면은 멀쩡해 보였지만, 적재를 한 번 돌리면 날아간다.
    # 칸: 3=토지코드(PNU 19자리) · 4=공시지가(원/㎡) · 11=기준년도.
    import csv as _csv
    old_yr = 0
    for path in sorted(glob.glob("data/raw/공시지가_*년.csv")):
        m = re.search(r"(\d{4})", path.rsplit("/", 1)[-1])
        if not m:
            continue
        yr = m.group(1)
        if yr in byyear:                    # dbf 판이 있으면 그쪽이 정본
            continue
        with open(path, encoding="cp949", errors="replace") as f:
            rd = _csv.reader(f)
            next(rd, None)
            for row in rd:
                if len(row) < 12:
                    continue
                pnu = row[3].strip()
                if len(pnu) != 19:
                    continue
                try:
                    iv = int(float(row[4].strip() or 0))
                except ValueError:
                    continue
                if iv > 0:
                    ts.setdefault(pnu, {})[yr] = iv
        old_yr += 1
    print(f"  공시지가 판(옛 CSV) {old_yr}개년 추가")
    yrs = sorted({y for v in ts.values() for y in v})
    print(f"  → 전 구간 {yrs[0]}~{yrs[-1]} ({len(yrs)}개년)")
    return ts

def main():
    # 처리결과 문서 — 토지특성 DBF 를 읽어 parcels 의 재료를 만드는데 장부가 없었다.
    # 이 파일은 `rep` 를 이미 「용도지역 대표값」으로 쓰고 있어 문서 객체는 doc 로 둔다.
    doc = Report("build_land_master", src="토지특성 AL_D194 dbf + 공시지가 + 공간분석")
    print("공시지가 로드…"); price=load_price()
    print("공간분석 로드…"); spatial=json.load(open("data/tools/_spatial_ALL.json"))
    print("토지특성 조립…")
    out=open("data/tools/_land_master.jsonl","w")
    N=0; has_price=has_sp=has_dev=0
    agree=disagree=noref=0
    dist_use=collections.Counter()
    for dbf in sorted(glob.glob("data/raw/토지특성/AL_D194_*/AL_D194_*.dbf")):
        n,f,rows=read_dbf(dbf,('cp949',))
        for r in rows():
            pnu=r['A1']; N+=1
            doc.read()
            if not pnu or len(str(pnu)) != 19:
                doc.drop("PNU 가 19자리가 아님", str(pnu)); continue
            sp=spatial.get(pnu,{})
            rep=sp.get('용도지역',[{}])[0].get('명') if sp.get('용도지역') else None
            rec={
                'PNU':pnu,
                '주소':f"{r['A3']} {r['A7']}".strip(),
                '지목':r['A11'], '면적':float(r['A12'] or 0),
                '토지이용상황':r['A18'],
                '지세':r['A20'], '지형형상':r['A22'], '도로접면':r['A24'],
                '공시지가': price.get(pnu,{}),
                '용도지역': sp.get('용도지역',[]),
                '용도지역_대표': rep,
                '개발제한비중': sp.get('개발제한비중',0.0),
            }
            out.write(json.dumps(rec,ensure_ascii=False)+"\n")
            if rec['공시지가']: has_price+=1
            if rec['용도지역']: has_sp+=1; dist_use[rep]+=1
            if rec['개발제한비중']>0: has_dev+=1
            # 교차검증: 토지특성 요약 용도지역(A14) vs 공간 대표
            ref=r['A14']
            if rep and ref:
                if rep==ref: agree+=1
                else: disagree+=1
            else: noref+=1
            doc.write()
    out.close()
    doc.also_read("_spatial_ALL.json(필지)", len(spatial), folded_to=len(spatial))
    doc.also_read("공시지가 시계열(필지)", len(price), folded_to=len(price))
    # 요약(A14)과 공간 대표가 어긋나는 필지 — 값은 손대지 않고 사실만 남긴다
    doc.note_odd("토지특성 요약 용도지역 ≠ 공간 대표", None, None, n=disagree)
    doc.note(f"공시지가 보유 {has_price:,} · 용도지역(공간) {has_sp:,} · 개발제한 접함 {has_dev:,}")
    doc.finish()
    print(f"\n토지 마스터 {N:,} PNU → _land_master.jsonl")
    print(f"  공시지가 보유 {has_price:,} ({has_price/N*100:.1f}%)")
    print(f"  용도지역(공간) {has_sp:,} ({has_sp/N*100:.1f}%)")
    print(f"  개발제한 접함 {has_dev:,} ({has_dev/N*100:.1f}%)")
    tot=agree+disagree
    print(f"\n교차검증 (토지특성 요약 A14 vs UQ111 공간 대표):")
    print(f"  일치 {agree:,} · 불일치 {disagree:,} → 일치율 {agree/max(tot,1)*100:.1f}%")
    print(f"  (요약/공간 중 결측 {noref:,} 제외)")

if __name__=='__main__': main()
