#!/usr/bin/env python3
"""교통 파생: 건물(필지중심) → 주변 지하철/버스 + 역과의거리.
좌표: 지적도 5174. 역/정류소 WGS84(4326)→5174 재투영. STRtree 근접.
주변 지하철=반경1000m, 주변 버스=반경500m, 역과의거리=최단 지하철.
도보분 = round(거리/80).  사용: python build_transit.py [sgg5|ALL]
"""
import sys, json, glob
import shapefile
from shapely.geometry import shape, Point
from shapely import STRtree
from pyproj import Transformer

T=Transformer.from_crs(4326, 5174, always_xy=True)  # (lon,lat)→(x,y)
LDREG="data/raw/LSMD_CONT_LDREG_5174_서울/LSMD_CONT_LDREG_5174_11_202606"

def load_subway():
    d=json.load(open("data/raw/서울시 역사마스터 정보.json",encoding='utf-8'))['DATA']
    pts=[]; meta=[]
    for r in d:
        try: x,y=T.transform(float(r['lot']),float(r['lat']))
        except: continue
        pts.append(Point(x,y)); meta.append({'역명':r['bldn_nm'],'호선':r['route']})
    return pts, meta

def load_bus():
    d=json.load(open("data/raw/서울시 버스정류소 위치정보.json",encoding='utf-8'))['DATA']
    pts=[]; meta=[]
    for r in d:
        try: x,y=T.transform(float(r['xcrd']),float(r['ycrd']))
        except: continue
        pts.append(Point(x,y)); meta.append({'정류장명':r['stops_nm']})
    return pts, meta

def walkmin(dist): return max(1,round(dist/80))

def run(sgg):
    sub_g,sub_m=load_subway(); bus_g,bus_m=load_bus()
    print(f"지하철 {len(sub_g)} · 버스 {len(bus_g)}")
    subtree=STRtree(sub_g); bustree=STRtree(bus_g)
    r=shapefile.Reader(LDREG,encoding='cp949')
    flds=[f[0] for f in r.fields[1:]]; idx={f:i for i,f in enumerate(flds)}
    out=open(f"data/tools/_transit_{sgg}.jsonl","w")
    N=0
    import time; t=time.time()
    for sr in r.iterShapeRecords():
        rec=sr.record
        if sgg!='ALL' and rec[idx['COL_ADM_SE']]!=sgg: continue
        pnu=rec[idx['PNU']]
        try: c=shape(sr.shape.__geo_interface__).centroid
        except: continue
        N+=1
        # 최단 지하철
        ni=subtree.nearest(c); nd=c.distance(sub_g[ni])
        # 주변 지하철 1000m
        subs=[]
        for i in subtree.query(c, predicate='dwithin', distance=1000):
            dd=c.distance(sub_g[i])
            subs.append({**sub_m[i],'거리':round(dd),'도보':walkmin(dd)})
        subs.sort(key=lambda z:z['거리'])
        # 주변 버스 500m
        buses=[]
        for i in bustree.query(c, predicate='dwithin', distance=500):
            dd=c.distance(bus_g[i])
            buses.append({**bus_m[i],'거리':round(dd),'도보':walkmin(dd)})
        buses.sort(key=lambda z:z['거리'])
        out.write(json.dumps({'PNU':pnu,'역과의거리':round(nd),
            '주변지하철':subs,'주변버스':buses},ensure_ascii=False)+"\n")
        if N%50000==0: print(f"  {N:,} ({time.time()-t:.0f}s)")
    out.close()
    print(f"[{sgg}] {N:,} 필지 → _transit_{sgg}.jsonl ({time.time()-t:.0f}s)")

if __name__=='__main__':
    run(sys.argv[1] if len(sys.argv)>1 else '11110')
