#!/usr/bin/env python3
"""F-15 법정건폐율/법정용적률 (토지이음 재현 로직 = 5174.py).
걸침 판정: 최소부분 330㎡(상업 660㎡) 이하 → 가중평균, 초과 → 병기.
가중평균: 건폐=면적가중 후 반올림 / 용적=각 기여분 절사(floor) 합산.
입력: _spatial_ALL 걸침 + 토지면적. 개발제한구역=산정제외.
출력: _legal_{sgg}.json (PNU→{법정건폐율,법정용적률,적용방식}).
사용: python build_legal.py [sgg5]  (기본 11680, ALL 가능)
"""
import sys, json, collections
import numpy as np

# 서울시 도시계획조례 (5174.py 표 = 토지이음 대조본)
LEGAL={'제1종전용주거지역':(50,100),'제2종전용주거지역':(40,120),
'제1종일반주거지역':(60,150),'제2종일반주거지역':(60,200),'제3종일반주거지역':(50,250),
'준주거지역':(60,400),'중심상업지역':(60,1000),'일반상업지역':(60,800),
'근린상업지역':(60,600),'유통상업지역':(60,600),'전용공업지역':(60,300),
'일반공업지역':(60,350),'준공업지역':(60,400),
'보전녹지지역':(20,50),'생산녹지지역':(20,50),'자연녹지지역':(20,50)}

def luris(걸침, 토지면적, 개발제한비중):
    """→ (법정건폐율, 법정용적률, 적용방식) 문자열/None"""
    if 개발제한비중 and 개발제한비중>=0.5:
        return None, None, '개발제한'
    if not 걸침: return None, None, '용도지역없음'
    names=[z['명'] for z in 걸침]
    if any(n not in LEGAL for n in names):
        return None, None, '조례값없음'
    areas=np.array([z['비중']*토지면적 for z in 걸침], float) if 토지면적 else np.array([z['비중'] for z in 걸침])
    bcr=np.array([LEGAL[n][0] for n in names], float)
    far=np.array([LEGAL[n][1] for n in names], float)
    tot=float(sum(areas))
    if len(names)==1:
        return f"{int(bcr[0])}%", f"{int(far[0])}%", '단일'
    # 걸침 판정
    threshold=660.0 if any('상업' in n for n in names) else 330.0
    has_green=any('녹지' in n for n in names)
    if has_green:
        gi=[i for i,n in enumerate(names) if '녹지' in n]
        wavg=bool(np.all(areas[gi]<=threshold))
    else:
        wavg=bool(np.any(areas<=threshold))
    if wavg:
        fb=round(float(np.sum(bcr*areas))/tot)              # 건폐 가중평균→반올림
        ff=int(np.sum(np.floor(areas/tot*far)))             # 용적 절사합산
        return f"{int(fb)}%", f"{int(ff)}%", '가중평균'
    else:
        ub=sorted(set(int(x) for x in bcr)); uf=sorted(set(int(x) for x in far))
        return ", ".join(f"{x}%" for x in ub), ", ".join(f"{x}%" for x in uf), '병기'

def main():
    sgg=sys.argv[1] if len(sys.argv)>1 else '11680'
    spatial=json.load(open("data/tools/_spatial_ALL.json"))
    # 토지면적 (토지 마스터)
    larea={}
    for line in open("data/tools/_land_master.jsonl"):
        r=json.loads(line)
        if sgg=='ALL' or r['PNU'].startswith(sgg): larea[r['PNU']]=r.get('면적')
    out={}; method=collections.Counter()
    for pnu, area in larea.items():
        sp=spatial.get(pnu,{})
        lb,lf,m=luris(sp.get('용도지역'), area, sp.get('개발제한비중'))
        method[m]+=1
        if lf is not None: out[pnu]={'법정건폐율':lb,'법정용적률':lf,'적용방식':m}
    json.dump(out, open(f"data/tools/_legal_{sgg}.json",'w'), ensure_ascii=False)
    print(f"[{sgg}] 법정치 산출 {len(out):,}/{len(larea):,}")
    print(f"  적용방식: {dict(method)}")
    for pnu in list(out)[:4]:
        print(f"  {pnu}: {out[pnu]}")

if __name__=='__main__': main()
