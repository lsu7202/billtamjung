#!/usr/bin/env python3
"""F-15 법정건폐율/법정용적률 파생 (서울시 도시계획조례 매핑표).
걸침 필지 = 면적가중평균 (국계법 84조: 최소부분 330㎡ 이하면 넓은 용도지역에 흡수).
개발제한구역(용도구역) 해당 → 법정치 산정 무의미, '개발제한' 표시.
도심부(한양도성) 상업 할인은 종로·중구 한정 → 강남 무관.
사용: python build_legal.py [시군구코드5|ALL]  (기본 강남 11680)
"""
import sys, json, collections

# (건폐율%, 용적률%) — 서울시 도시계획조례 제54·55조
ZONE={
 '제1종전용주거지역':(50,100), '제2종전용주거지역':(40,120),
 '제1종일반주거지역':(60,150), '제2종일반주거지역':(60,200), '제3종일반주거지역':(50,250),
 '준주거지역':(60,400),
 '중심상업지역':(60,1000), '일반상업지역':(60,800), '근린상업지역':(60,600), '유통상업지역':(60,600),
 '전용공업지역':(60,200), '일반공업지역':(60,200), '준공업지역':(60,400),
 '보전녹지지역':(20,50), '생산녹지지역':(20,50), '자연녹지지역':(20,50),
}
# 종 미분류/미지정 = 조례값 없음 → null
NOVAL={'주거지역','일반주거지역','상업지역','공업지역','녹지지역','미지정'}
MIN_AREA=330.0  # 국계법 84조 소부분 흡수 임계

def legal(걸침, 토지면적, 개발제한비중):
    """→ (법정건폐율, 법정용적률, 비고)"""
    if 개발제한비중 and 개발제한비중>=0.5:
        return None, None, '개발제한구역'
    if not 걸침: return None,None,'용도지역없음'
    parts=[(z['명'],z['비중']) for z in 걸침]
    # 330㎡ 이하 소부분 흡수 (토지면적 알 때만)
    if 토지면적 and len(parts)>1:
        big=[(nm,w) for nm,w in parts if w*토지면적>MIN_AREA]
        if big: parts=big
    tot=sum(w for _,w in parts)
    parts=[(nm,w/tot) for nm,w in parts]
    bcr=far=0.0; unknown=False
    for nm,w in parts:
        if nm in ZONE: b,f=ZONE[nm]; bcr+=b*w; far+=f*w
        elif nm in NOVAL: unknown=True
        else: unknown=True
    if unknown and bcr==0: return None,None,'조례값없음('+parts[0][0]+')'
    note='' if len(parts)==1 else '걸침가중'
    if unknown: note=(note+' 일부미상').strip()
    return round(bcr,1), round(far,1), note or '단일'

def main():
    sgg=sys.argv[1] if len(sys.argv)>1 else '11680'
    n=0; done=0; note_cnt=collections.Counter(); ex=[]
    for line in open("data/tools/_integrated.jsonl"):
        r=json.loads(line)
        if sgg!='ALL' and not (r['PNU'] or '').startswith(sgg): continue
        n+=1
        lb,lf,note=legal(r.get('용도지역_걸침'), r.get('토지면적'), r.get('개발제한비중'))
        note_cnt[note.split()[0] if note else note]+=1
        if lf is not None:
            done+=1
            여유=round(lf-r['용적률'],1) if r['용적률'] else None
            if len(ex)<6 and r['용적률'] and note=='단일' and r['대장구분']=='일반':
                ex.append((r['주소'],r['용도지역'],r['용적률'],lf,여유))
    print(f"[{sgg}] 건물 {n:,}동 · 법정치 산출 {done:,} ({done/n*100:.1f}%)")
    print(f"  비고 분포: {dict(note_cnt)}")
    print("\n예시 (실제용적 → 법정용적 = 여유분):")
    for addr,z,cur,lf,yeo in ex:
        print(f"  {addr} · {z}: {cur}% → 법정 {lf}% = 여유 {yeo}%p")

if __name__=='__main__': main()
