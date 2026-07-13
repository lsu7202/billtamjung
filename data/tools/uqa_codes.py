#!/usr/bin/env python3
"""국토계획법 용도지역 UQA 코드 → 용도지역명 (표준 코드표).
UQ111의 ALIAS는 비신뢰(대부분 공란·지구단위/사업명 노이즈)이므로 코드로만 매핑.
8개 코드는 서울 UQ111 ALIAS 실측으로 검증됨(주석 ✓).
변형코드(끝자리≠0, 예 1221)는 base(첫3+0)로 롤업.
"""
UQA_NAME = {
    '1100':'주거지역',            '1110':'제1종전용주거지역',  # ✓ALIAS
    '1120':'제2종전용주거지역',
    '1200':'일반주거지역',        '1210':'제1종일반주거지역',  # ✓
    '1220':'제2종일반주거지역',   # ✓ (7·11·12층이하 변형 포함)
    '1230':'제3종일반주거지역',   # ✓
    '1300':'준주거지역',          # ✓
    '2000':'상업지역',            '2100':'중심상업지역',
    '2200':'일반상업지역',        # ✓
    '2300':'근린상업지역',        # ✓
    '2400':'유통상업지역',
    '3000':'공업지역',            '3100':'전용공업지역',
    '3200':'일반공업지역',        '3300':'준공업지역',
    '4000':'녹지지역',            '4100':'보전녹지지역',
    '4200':'생산녹지지역',        '4300':'자연녹지지역',       # ✓
    '5100':'보전관리지역',        '5200':'생산관리지역',
    '5300':'계획관리지역',        '6000':'농림지역',
    '7000':'자연환경보전지역',    '9990':'미지정',
}

def uqa_name(code):
    """정확 코드 → 없으면 base(첫3+0) → 없으면 대분류(첫1+000) 롤업."""
    if not code: return None, None
    if code in UQA_NAME: return UQA_NAME[code], code
    base = code[:3]+'0'
    if base in UQA_NAME: return UQA_NAME[base], base
    grp = code[:1]+'000'
    if grp in UQA_NAME: return UQA_NAME[grp], grp
    return None, code

if __name__=='__main__':
    # 기존 _spatial_ALL.json 재매핑 (명만 교정)
    import json, collections
    p="data/tools/_spatial_ALL.json"
    d=json.load(open(p))
    dist=collections.Counter(); unmapped=collections.Counter()
    for pnu,rec in d.items():
        for z in rec['용도지역']:
            nm,base=uqa_name(z['코드'])
            if nm is None: unmapped[z['코드']]+=1
            z['명']=nm or z['코드']; z['코드']=base or z['코드']
        # 대표 용도지역(최대비중)
        if rec['용도지역']:
            dist[rec['용도지역'][0]['명']]+=1
    json.dump(d, open(p,'w'), ensure_ascii=False)
    print("대표 용도지역 분포(최대비중 기준):")
    for k,c in dist.most_common(): print(f"  {k}: {c:,}")
    if unmapped: print("미매핑 코드:", dict(unmapped))
    else: print("미매핑 없음 ✅")
