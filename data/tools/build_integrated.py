#!/usr/bin/env python3
"""통합 매물 뷰: 건물 마스터(PK) + 토지 마스터(PNU) + 교통(PNU) 조인.
1행 = 건물 1동. 매각은 미확보(별도). 출력 _integrated.jsonl + 커버리지.
"""
import json

def load_by_pnu(path, keys):
    d={}
    for line in open(path):
        r=json.loads(line); d[r['PNU']]={k:r.get(k) for k in keys}
    return d

def main():
    print("토지/교통 인덱스…")
    land=load_by_pnu("data/tools/_land_master.jsonl",
        ['지목','면적','토지이용상황','지세','지형형상','도로접면',
         '공시지가','용도지역','용도지역_대표','개발제한비중'])
    transit=load_by_pnu("data/tools/_transit_ALL.jsonl",
        ['역과의거리','주변지하철','주변버스'])
    aplus=json.load(open("data/tools/_sales_est.json"))    # PK → 추정 매각이력
    out=open("data/tools/_integrated.jsonl","w")
    N=0; hl=ht=hboth=0
    for line in open("data/tools/_building_master.jsonl"):
        b=json.loads(line); pnu=b['PNU']; N+=1
        L=land.get(pnu); Tr=transit.get(pnu)
        rec={
            # ── 건물 ──
            'PK':b['PK'],'주소':b['주소'],'도로명주소':b['도로명주소'],'대장구분':b['대장구분'],
            'PNU':pnu,
            '대지면적':b['대지면적'],'건축면적':b.get('건축면적'),'건폐율':b['건폐율'],'용적률':b['용적률'],'연면적':b['연면적'],
            '건폐용적_클린':b.get('건폐용적_클린','원본'),
            '주용도':b['주용도'],'주용도코드':b['주용도코드'],'기타용도':b['기타용도'],'구조':b['구조'],
            '지상층수':b['지상층수'],'지하층수':b['지하층수'],'사용승인일':b['사용승인일'],
            '최근대수선일':b.get('최근대수선일'),'대수선건수':b.get('대수선건수',0),
            '대지건폐용적_출처':b['대지건폐용적_출처'],
            # ── 토지 ──
            '지목':L['지목'] if L else None,
            '토지면적':L['면적'] if L else None,
            '토지이용상황':L['토지이용상황'] if L else None,
            '용도지역':L['용도지역_대표'] if L else None,
            '용도지역_걸침':L['용도지역'] if L else None,
            '개발제한비중':L['개발제한비중'] if L else None,
            '지세':L['지세'] if L else None,'지형형상':L['지형형상'] if L else None,
            '도로접면':L['도로접면'] if L else None,
            '공시지가':L['공시지가'] if L else None,
            # ── 교통 ──
            '역과의거리':Tr['역과의거리'] if Tr else None,
            '주변지하철':Tr['주변지하철'] if Tr else None,
            '주변버스':Tr['주변버스'] if Tr else None,
            # ── 매각 (건물별 추정 매각이력, 유저 수정 가능) ──
            '매각이력_추정': aplus.get(b['PK']),
        }
        out.write(json.dumps(rec,ensure_ascii=False)+"\n")
        if L: hl+=1
        if Tr: ht+=1
        if L and Tr: hboth+=1
    out.close()
    print(f"\n통합 매물 뷰 {N:,}동 → _integrated.jsonl")
    print(f"  토지 결합 {hl:,} ({hl/N*100:.1f}%) · 교통 결합 {ht:,} ({ht/N*100:.1f}%) · 둘다 {hboth:,} ({hboth/N*100:.1f}%)")

if __name__=='__main__': main()
