#!/usr/bin/env python3
"""토지 마스터 조립: 토지특성(D194) + 공시지가 시계열 + 공간분석(용도지역·개발제한).
키=PNU(19). 출력: data/tools/_land_master.jsonl + 커버리지/교차검증 리포트.
"""
import sys, json, glob, collections
sys.path.insert(0,'data/tools')
from dbf_inspect import read_dbf

# ── 공시지가 시계열 (D150 폴더 자동탐색: AL_*D150*_YYYYMMDD) ──
import re
def load_price():
    ts={}; found=[]
    for dbf in sorted(glob.glob("data/raw/*D150*/*.dbf")):
        m=re.search(r'(\d{4})\d{4}', dbf.rsplit('/',1)[-1])  # 폴더/파일명 내 YYYYMMDD → 연도
        if not m: continue
        yr=m.group(1); found.append(yr)
        n,f,rows=read_dbf(dbf,('cp949','utf-8'))
        for r in rows():
            try: iv=int(str(r['A9']).strip() or 0)
            except: iv=0
            if iv>0: ts.setdefault(r['A0'],{})[yr]=iv
    print(f"  공시지가 판 {len(found)}개: {sorted(found)}")
    return ts

def main():
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
    out.close()
    print(f"\n토지 마스터 {N:,} PNU → _land_master.jsonl")
    print(f"  공시지가 보유 {has_price:,} ({has_price/N*100:.1f}%)")
    print(f"  용도지역(공간) {has_sp:,} ({has_sp/N*100:.1f}%)")
    print(f"  개발제한 접함 {has_dev:,} ({has_dev/N*100:.1f}%)")
    tot=agree+disagree
    print(f"\n교차검증 (토지특성 요약 A14 vs UQ111 공간 대표):")
    print(f"  일치 {agree:,} · 불일치 {disagree:,} → 일치율 {agree/max(tot,1)*100:.1f}%")
    print(f"  (요약/공간 중 결측 {noref:,} 제외)")

if __name__=='__main__': main()
