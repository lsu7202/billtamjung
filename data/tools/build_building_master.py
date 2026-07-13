#!/usr/bin/env python3
"""건물 마스터 조립: 표제부(djy_03) 기준 1동=1행, PK 키.
대지면적·건폐율·용적률 = 총괄표제부(PNU) 우선 → 표제부 자체 → (대지면적만)토지특성.
FK: PNU(조립) → 토지 마스터. 층별 임대정보 프리필용 층별개요는 별도.
출력: _building_master.jsonl + 커버리지 리포트.
"""
import sys, json, glob, collections
sys.path.insert(0,'data/tools')
from dbf_inspect import read_dbf

MP={'0':'1','1':'2','2':'1'}
def mkpnu(sgg,emd,dg,bon,bu):
    if not(sgg.isdigit() and emd.isdigit() and bon.isdigit() and bu.isdigit()): return None
    p=f"{sgg}{emd}{MP.get(dg,dg)}{int(bon):04d}{int(bu):04d}"
    return p if len(p)==19 else None
def fnum(s):
    s=(s or '').strip()
    try: return float(s)
    except: return 0.0

def load_chg():
    """총괄표제부 PNU→{대지,건폐,용적}. 24 대지·26 건폐·29 용적."""
    d={}
    with open("data/raw/seoul/mart_djy_02_seoul.txt",'rb') as f:
        for line in f:
            p=[x.decode('utf-8',errors='replace') for x in line.rstrip(b'\r\n').split(b'|')]
            pnu=mkpnu(p[10],p[11],p[12],p[13],p[14])
            if not pnu: continue
            d[pnu]={'대지면적':fnum(p[24]),'건폐율':fnum(p[26]),'용적률':fnum(p[29])}
    return d

def load_daesuseon():
    """kcy_05 대수선 인허가 → PNU→{최근대수선일, 건수}. (2022 누적편중 주의)"""
    latest={}; cnt=collections.Counter()
    with open("data/raw/seoul/mart_kcy_05_seoul.txt",'rb') as f:
        for line in f:
            p=[x.decode('utf-8',errors='replace') for x in line.rstrip(b'\r\n').split(b'|')]
            pnu=mkpnu(p[3],p[4],p[5],p[6],p[7])
            if not pnu: continue
            d=p[15].strip()
            if len(d)==8 and d.isdigit():
                cnt[pnu]+=1
                if pnu not in latest or d>latest[pnu]: latest[pnu]=d
    return {pnu:{'최근대수선일':latest[pnu],'대수선건수':cnt[pnu]} for pnu in latest}

def load_land_area():
    """토지특성 PNU→면적(A12)."""
    d={}
    for dbf in sorted(glob.glob("data/raw/토지특성/AL_D194_*/AL_D194_*.dbf")):
        n,f,rows=read_dbf(dbf,('cp949',))
        for r in rows(): d[r['A1']]=float(r['A12'] or 0)
    return d

def main():
    print("총괄표제부 로드…"); chg=load_chg()
    print("대수선 로드…"); ds=load_daesuseon()
    print("토지면적 로드…"); larea=load_land_area()
    landset=set(larea)
    print("표제부 조립…")
    out=open("data/tools/_building_master.jsonl","w")
    N=0; src=collections.Counter()
    has_pnu=has_land=has_area=has_far=0
    with open("data/raw/seoul/mart_djy_03_seoul.txt",'rb') as f:
        for line in f:
            p=[x.decode('utf-8',errors='replace') for x in line.rstrip(b'\r\n').split(b'|')]
            N+=1
            pnu=mkpnu(p[8],p[9],p[10],p[11],p[12])
            # 대지·건폐·용적: 총괄 우선 → 표제부 → (대지)토지
            area=bcr=far=0.0; s='표제부'
            g=chg.get(pnu) if pnu else None
            if g and g['대지면적']>0:
                area,bcr,far,s=g['대지면적'],g['건폐율'],g['용적률'],'총괄'
            if area==0 and fnum(p[25])>0:
                area,bcr,far,s=fnum(p[25]),fnum(p[27]),fnum(p[30]),'표제부'
            if area==0 and pnu in larea and larea[pnu]>0:
                area,s=larea[pnu],'토지특성'
            rec={
                'PK':p[0], '대장구분':p[2], '주소':p[5], '도로명주소':p[6],
                'PNU':pnu,
                '대지면적':round(area,2),'건폐율':round(bcr,2),'용적률':round(far,2),
                '대지건폐용적_출처':s,
                '연면적':fnum(p[28]), '주용도코드':p[34],'주용도':p[35],'기타용도':p[36],
                '구조':p[32], '지상층수':int(fnum(p[43])),'지하층수':int(fnum(p[44])),
                '사용승인일':p[60].strip(),
                '최근대수선일': (ds.get(pnu) or {}).get('최근대수선일') if pnu else None,
                '대수선건수': (ds.get(pnu) or {}).get('대수선건수', 0) if pnu else 0,
            }
            out.write(json.dumps(rec,ensure_ascii=False)+"\n")
            src[s]+=1
            if pnu: has_pnu+=1
            if pnu in landset: has_land+=1
            if area>0: has_area+=1
            if far>0: has_far+=1
    out.close()
    print(f"\n건물 마스터 {N:,}동 → _building_master.jsonl")
    print(f"  PNU 조립 {has_pnu:,} ({has_pnu/N*100:.1f}%) · 토지 매칭 {has_land:,} ({has_land/N*100:.1f}%)")
    print(f"  대지면적 확보 {has_area:,} ({has_area/N*100:.1f}%) · 용적률 확보 {has_far:,} ({has_far/N*100:.1f}%)")
    print(f"  대지/건폐/용적 출처: {dict(src)}")

if __name__=='__main__': main()
