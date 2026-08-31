#!/usr/bin/env python3
"""통합 매물 뷰: 건물 마스터(PK) + 토지 마스터(PNU) + 교통(PNU) 조인.
1행 = 건물 1동. 매각은 미확보(별도). 출력 _integrated.jsonl + 커버리지.

용적률 결측 보완도 여기서 한다 — build_building_master는 표제부를 한 줄씩 읽어서
"이 PNU에 몇 동이 있는지"를 그 시점에 모른다. 필지 전수를 본 뒤에야 판정할 수 있고,
여기가 전 건물을 두 번 훑을 수 있는 첫 자리다.
"""
import collections, json

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
        # 용적률은 **대장이 준 것만** 싣는다. 용적산정연면적÷대지면적으로 채울 수 있어도
        # 채우지 않는다 — 이 값이 계약서·확인설명서로 그대로 넘어가기 때문이다(0144).
        # 계산분은 검색 전용 master.building_calc 로 간다(scripts/build_building_calc.py).
        far=b['용적률']; far_src='대장' if far else None
        rec={
            # ── 건물 ──
            'PK':b['PK'],'주소':b['주소'],'도로명주소':b['도로명주소'],'대장구분':b['대장구분'],
            'PNU':pnu,
            '대지면적':b['대지면적'],'건축면적':b.get('건축면적'),'건폐율':b['건폐율'],'용적률':far,'연면적':b['연면적'],
            '용적률산정연면적':b.get('용적률산정연면적'),
            '건폐용적_클린':b.get('건폐용적_클린','원본'),
            '건폐율출처':b.get('건폐율출처'),'용적률출처':far_src,
            '주용도':b['주용도'],'주용도코드':b['주용도코드'],'기타용도':b['기타용도'],'구조':b['구조'],
            '지상층수':b['지상층수'],'지하층수':b['지하층수'],'높이':b.get('높이'),
            '엘리베이터':b.get('엘리베이터'),'주차':b.get('주차'),
            '사용승인일':b['사용승인일'],
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
