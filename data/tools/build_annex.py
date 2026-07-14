#!/usr/bin/env python3
"""부속지번 관계표 — 건물(PK) ↔ 필지들(대표+부속 PNU).
djy_05(부속지번 마트) 파싱. 값은 안 건드리고 "관련 필지 링크"만.
용도: 매물상세에서 관련 필지 같이 표시(각 필지는 독립 데이터). 합산/변형 없음.
출력: _annex_{sgg}.json (PK → {대표, 부속[], 전체[]}).  sgg=ALL 가능.
"""
import sys, json, collections

MP={'0':'1','1':'2','2':'1'}
def mk(sgg,emd,dg,bon,bu):
    if not(sgg.isdigit() and emd.isdigit() and bon.isdigit() and bu.isdigit()): return None
    s=f"{sgg}{emd}{MP.get(dg,dg)}{int(bon):04d}{int(bu):04d}"
    return s if len(s)==19 else None

def main():
    sgg=sys.argv[1] if len(sys.argv)>1 else '11680'
    rep={}; subs=collections.defaultdict(set)
    with open("data/raw/seoul/mart_djy_05_seoul.txt",'rb') as f:
        for line in f:
            p=[x.decode('utf-8',errors='replace') for x in line.rstrip(b'\r\n').split(b'|')]
            if sgg!='ALL' and not p[8].startswith(sgg): continue
            pk=p[0]
            r=mk(p[8],p[9],p[10],p[11],p[12])      # 대표(idx8~12)
            s=mk(p[23],p[24],p[25],p[26],p[27])    # 부속(idx23~27)
            if r: rep[pk]=r
            if s: subs[pk].add(s)
    out={}
    for pk, r in rep.items():
        sub=sorted(subs.get(pk,set())-{r})          # 대표 제외한 부속만
        if not sub: continue                        # 단일필지 = 관계 없음(스킵)
        out[pk]={'대표':r, '부속':sub, '전체':[r]+sub}
    json.dump(out, open(f"data/tools/_annex_{sgg}.json",'w'), ensure_ascii=False)
    # 통계
    n=len(out); tot_p=sum(len(v['전체']) for v in out.values())
    dist=collections.Counter(len(v['부속']) for v in out.values())
    print(f"[{sgg}] 다필지 건물 {n:,} · 평균 {tot_p/max(n,1):.1f}필지/건물")
    print(f"  부속수 분포: {dict(sorted(dist.items())[:8])}")
    for pk in list(out)[:2]:
        print(f"  PK {pk}: 대표 {out[pk]['대표']} + 부속 {len(out[pk]['부속'])}개")
    print(f"저장: _annex_{sgg}.json")

if __name__=='__main__': main()
