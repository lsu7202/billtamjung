#!/usr/bin/env python3
"""강남(11680) 통합 샘플 — 새 필드 구조(schema.md v0)로 전 필드 CSV.
소스: 건물·토지 마스터 + 교통 + 매각(A+/A) + 법정치 + 규제.
출력: data/exports/강남_전체.csv (utf-8-sig, 엑셀 바로 열림).
"""
import json, csv, collections
import shapefile
from shapely.geometry import shape
from pyproj import Transformer

SGG='11680'
_T4326 = Transformer.from_crs(5174, 4326, always_xy=True)  # 5174→WGS84(경위도)

def load_coords(sgg):
    """강남 필지 중심점 → (x=경도, y=위도)."""
    r=shapefile.Reader("data/raw/LSMD_CONT_LDREG_5174_서울/LSMD_CONT_LDREG_5174_11_202606",encoding='cp949')
    idx=[f[0] for f in r.fields[1:]].index('PNU')
    out={}
    for sr in r.iterShapeRecords():
        pnu=sr.record[idx]
        if not pnu.startswith(sgg): continue
        try:
            c=shape(sr.shape.__geo_interface__).representative_point()
            lon,lat=_T4326.transform(c.x,c.y)
            out[pnu]=(round(lon,6),round(lat,6))
        except: continue
    return out
def load_jsonl_by_pnu(path, keys):
    d={}
    for line in open(path):
        r=json.loads(line)
        if r.get('PNU','').startswith(SGG): d[r['PNU']]={k:r.get(k) for k in keys}
    return d

def load_floors(pks):
    """층별개요 djy_04 → PK별 층별 프리필 [{층,용도,면적}]. 강남 PK만."""
    fl={}
    with open("data/raw/seoul/mart_djy_04_seoul.txt",'rb') as f:
        for line in f:
            p=line.rstrip(b'\r\n').split(b'|')
            pk=p[0].decode('utf-8',errors='replace')
            if pk not in pks: continue
            try:
                층=p[21].decode('utf-8',errors='replace'); 용도=p[26].decode('utf-8',errors='replace')
                면적=float(p[28] or 0)
            except: continue
            fl.setdefault(pk,[]).append({'층':층,'용도':용도,'면적':round(면적,2)})
    return fl

def main():
    print("소스 로드…")
    land=load_jsonl_by_pnu("data/tools/_land_master.jsonl",
        ['지목','면적','토지이용상황','지세','지형형상','도로접면','공시지가'])
    # 강남 PK 집합 → 층별개요 프리필
    gpks=set()
    for line in open("data/tools/_building_master.jsonl"):
        b=json.loads(line)
        if (b.get('PNU') or '').startswith(SGG): gpks.add(b['PK'])
    print(f"층별개요 프리필 로드({len(gpks):,} PK)…"); floors=load_floors(gpks)
    print("필지 좌표 로드…"); coords=load_coords(SGG)
    spatial=json.load(open("data/tools/_spatial_ALL.json"))
    transit=load_jsonl_by_pnu("data/tools/_transit_ALL.jsonl",['역과의거리','주변지하철','주변버스'])
    legal=json.load(open(f"data/tools/_legal_{SGG}.json"))
    reg=json.load(open(f"data/tools/_regulations_{SGG}.json"))
    aplus=json.load(open("data/tools/_sales_aplus.json"))

    def yongdo(pnu):
        z=spatial.get(pnu,{}).get('용도지역')
        if not z: return None
        if len(z)==1: return z[0]['명']
        return " + ".join(f"{x['명']} {round(x['비중']*100)}%" for x in z)

    YEARS=[str(y) for y in range(2016,2027)]
    cols=(['PK','PNU','시군구','법정동','주소','도로명주소','x','y']
        +['지목','토지면적','토지이용상황','지형형상','도로접면','지세']
        +['용도지역','법정건폐율','법정용적률','법정_적용방식',
          '고도지구','지구단위계획','정비구역','경관지구','방화지구','문화재보존','개발제한']
        +['대장구분','주용도','기타용도','구조','연면적','건축면적','대지면적','건폐율','용적률','용적여유분',
          '용적률산정연면적','지상층수','지하층수','엘리베이터','주차','사용승인일','최근대수선일','층별개요_프리필']
        +['공시지가_'+y for y in YEARS]+['공시지가_최신','상승률_5년','상승률_10년']
        +['역과의거리','최근접역','지하철수','최근접버스','버스수','주변지하철_전체','주변버스_전체']
        +['매각횟수','최근매각_년월','최근매각_금액','최근매각_단가'])

    out=open("data/exports/강남_전체.csv","w",newline='',encoding='utf-8-sig')
    w=csv.writer(out); w.writerow(cols); n=0
    for line in open("data/tools/_building_master.jsonl"):
        b=json.loads(line); pnu=b['PNU']
        if not pnu or not pnu.startswith(SGG): continue
        n+=1
        L=land.get(pnu,{}); Tr=transit.get(pnu,{}); lg=legal.get(pnu,{}); rg=reg.get(pnu,{})
        gj=L.get('공시지가') or {}
        # 공시지가 상승률
        latest=gj.get('2026'); p5=gj.get('2021'); p10=gj.get('2016')
        up5=round((latest-p5)/p5*100,1) if latest and p5 else None
        up10=round((latest-p10)/p10*100,1) if latest and p10 else None
        far=b.get('용적률'); lf=lg.get('법정용적률')
        여유=None
        if far and lf and ',' not in lf:  # 병기 아닐 때만 여유분
            try: 여유=round(float(lf.rstrip('%'))-far,1)
            except: pass
        subs=Tr.get('주변지하철') or []; buses=Tr.get('주변버스') or []
        ap=aplus.get(b['PK']) or []
        xy=coords.get(pnu, (None,None))
        row=[b['PK'],pnu,'강남구',pnu[:10],b['주소'],b['도로명주소'],xy[0],xy[1],
            L.get('지목'),L.get('면적'),L.get('토지이용상황'),L.get('지형형상'),L.get('도로접면'),L.get('지세'),
            yongdo(pnu),lg.get('법정건폐율'),lg.get('법정용적률'),lg.get('적용방식'),
            rg.get('고도지구',''),rg.get('지구단위계획',''),rg.get('정비구역',''),rg.get('경관지구',''),
            rg.get('방화지구',''),rg.get('문화재보존',''),spatial.get(pnu,{}).get('개발제한비중',0),
            b['대장구분'],b['주용도'],b['기타용도'],b['구조'],b['연면적'],b.get('건축면적'),b['대지면적'],
            b['건폐율'],far,여유,b.get('용적률산정연면적'),b['지상층수'],b['지하층수'],
            b.get('엘리베이터'),b.get('주차'),b['사용승인일'],b.get('최근대수선일'),
            json.dumps(floors.get(b['PK'],[]),ensure_ascii=False) if floors.get(b['PK']) else None,
            *[gj.get(y) for y in YEARS],latest,up5,up10,
            Tr.get('역과의거리'),
            (f"{subs[0]['역명']}({subs[0]['호선']}) 도보{subs[0]['도보']}분" if subs else None),
            len(subs),
            (f"{buses[0]['정류장명']} {buses[0]['거리']}m" if buses else None),
            len(buses),
            json.dumps(subs,ensure_ascii=False) if subs else None,
            json.dumps(buses,ensure_ascii=False) if buses else None,
            len(ap),(ap[-1]['계약년월'] if ap else None),(ap[-1]['금액'] if ap else None),
            (ap[-1]['단가_연면적'] if ap else None)]
        w.writerow(row)
    out.close()
    print(f"강남 {n:,}동 → data/exports/강남_전체.csv ({len(cols)}개 필드)")

if __name__=='__main__': main()
