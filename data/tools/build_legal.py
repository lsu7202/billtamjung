#!/usr/bin/env python3
"""F-15 법정건폐율/법정용적률 (토지이음 재현 로직 = 5174.py).

## 2026-09-01 — 파이프라인에서 뺐다. 원장이 정본이다

국토부 토지이용계획정보 원장(AL_D155, 1,040만 줄)이 필지마다 법정 건폐·용적을 직접
적어 준다. 이 스크립트는 그걸 **공간조인으로 재현**하려던 것이고, 원장이 생긴 뒤로는
틀린 값을 만드는 쪽이 됐다. 실측:

    원장과 값이 같음   892,425 필지 (99.7%)
    원장과 값이 다름     3,005 필지  ← 전부 우리가 틀렸다
    우리에게만 있음      1,479 필지  ← 전부 지어낸 값
    원장에만 있음          762 필지

토지이음에서 직접 열어 확인한 셋:

    종로구 예지동 213-2   지목 하천 · 용도지역 없음   → 우리는 60% / 800%
    종로구 교북동 5-61    지목 도로 · 종(種) 없음     → 우리는 60% / 200%
    종로구 창신동 170-1   필지 자체가 검색 안 됨      → 우리는 60% / 491%

예지동 213-2 는 원인이 화면에 보인다. 확인도면 **범례**에 일반상업지역이 있다 —
주변 폴리곤이 필지 위에 겹쳐 그려지는 것인데, 공간조인이 그걸 이 필지의 용도지역으로
읽었다. 토지이음은 「지역지구등 지정여부」에 그걸 안 쓴다.

**지우지 않고 남긴다.** 조례값 표(LEGAL)와 걸침 판정 산식은 원장을 검증할 때 쓴다.
다시 쓰려면 pipeline/build_all.py 에 단계를 되살리면 된다.

걸침 판정: 최소부분 330㎡(상업 660㎡) 이하 → 가중평균, 초과 → 병기.
가중평균: 건폐=면적가중 후 반올림 / 용적=각 기여분 절사(floor) 합산.
입력: _spatial_ALL 걸침 + 토지면적. 개발제한구역=산정제외.
출력: _legal_{sgg}.json (PNU→{법정건폐율,법정용적률,적용방식}).
사용: python build_legal.py [sgg5]  (기본 11680, ALL 가능)
"""
import sys, json, collections
import numpy as np
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from build_report import Report   # noqa: E402

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
    # 처리결과 문서 — 법정 건폐/용적을 못 낸 필지가 몇이고 왜인지가 남아야 한다.
    # 이 값은 화면의 「규제·특례」와 확인설명서로 그대로 나간다.
    doc = Report(f"build_legal_{sgg}", src="_land_master.jsonl + _spatial_ALL.json(용도지역)")
    out={}; method=collections.Counter()
    for pnu, area in larea.items():
        doc.read()
        sp=spatial.get(pnu,{})
        lb,lf,m=luris(sp.get('용도지역'), area, sp.get('개발제한비중'))
        method[m]+=1
        if lf is not None:
            out[pnu]={'법정건폐율':lb,'법정용적률':lf,'적용방식':m}
            doc.write()
        else:
            # 용도지역을 모르거나 표에 없는 이름이면 법정치를 못 낸다.
            # **지어내지 않는다** — 없는 채로 두고 몇 필지인지만 남긴다.
            doc.drop(f"법정치 산출 불가({m})", pnu)
    json.dump(out, open(f"data/tools/_legal_{sgg}.json",'w'), ensure_ascii=False)
    doc.also_read("_spatial_ALL.json(필지)", len(spatial), folded_to=len(spatial))
    doc.note(f"적용방식: {dict(method)}")
    doc.finish()
    print(f"[{sgg}] 법정치 산출 {len(out):,}/{len(larea):,}")
    print(f"  적용방식: {dict(method)}")
    for pnu in list(out)[:4]:
        print(f"  {pnu}: {out[pnu]}")

if __name__=='__main__': main()
