#!/usr/bin/env python3
"""도로접면 세분화 — 필지 경계의 '도로 접면(면)'을 방향으로 검출.
각지 = 도로 병합이 아니라, 필지 경계가 서로 다른 방향에서 도로에 접하는 면 수로 판정.
① 도로필지(지목=도로) 폭 = 최소회전사각형 짧은변
② 각 건물필지 경계 edge 중 도로에 접한 것 → 방향(각도)로 클러스터 = 접면 '면' 수
③ 각 면의 도로폭(인접 도로필지 짧은변) → 주도로/부도로 → 표 매핑
세로(<8) 가/불은 폴리곤 불가 → 기존 토지특성값 유지.
사용: python build_road_frontage.py [sgg5]
"""
import sys, json, glob, math, collections
import shapefile
from shapely.geometry import shape, Point, LineString
from shapely import make_valid, STRtree
from shapely.ops import unary_union
sys.path.insert(0,'data/tools')
from dbf_inspect import read_dbf
from paths import LDREG

def perp_width(a, b, roadU):
    """edge(a→b)의 중점에서 도로쪽으로 수직선을 쏴 도로필지를 가로지르는 실제 폭 측정.
    양방향 수직 중 도로와 겹치는 쪽으로, 그 겹침 길이 = 도로폭."""
    mx,my=(a[0]+b[0])/2,(a[1]+b[1])/2
    dx,dy=b[0]-a[0],b[1]-a[1]; L=math.hypot(dx,dy)
    if L<0.3: return 0
    nx,ny=-dy/L,dx/L   # 법선(수직) 단위벡터
    best=0
    for sgn in (1,-1):
        # 중점에서 살짝 안쪽부터 60m까지 수직선
        p0=(mx+nx*sgn*0.1, my+ny*sgn*0.1)
        p1=(mx+nx*sgn*60, my+ny*sgn*60)
        ray=LineString([p0,p1])
        inter=ray.intersection(roadU)
        if inter.is_empty: continue
        # p0에서 연속된(가장 가까운) 도로 구간 길이 = 도로폭
        start=Point(p0)
        if inter.geom_type=='LineString':
            seg=inter
        else:
            parts=[g for g in getattr(inter,'geoms',[inter]) if g.geom_type=='LineString']
            if not parts: continue
            seg=min(parts, key=lambda g:g.distance(start))
        best=max(best, seg.length)
    return best

def band(w):
    if w>=40: return '초광대로'
    if w>=30: return '대광대로'
    if w>=25: return '일반광대로'
    if w>=12: return '중로'
    if w>=8:  return '소로'
    return '세로'

def classify(주, 부, n면):
    if 주 is None: return '맹지', 0
    b주=band(주); tri=n면>=3
    if 부 is None:
        return {'초광대로':('초광대로한면',82),'대광대로':('대광대로한면',77),
                '일반광대로':('일반광대로한면',72),'중로':('중로한면',54),
                '소로':('소로한면',32),'세로':('세로한면',None)}[b주]
    b부=band(부)
    T={('초광대로','일반광대로'):('광대소각(초광대로+광대로)',98,100),('초광대로','대광대로'):('광대소각(초광대로+광대로)',98,100),('초광대로','초광대로'):('광대소각(초광대로+광대로)',98,100),
     ('초광대로','중로'):('광대소각(초광대로+중로)',95,97),('초광대로','소로'):('광대소각(초광대로+소로)',92,93),('초광대로','세로'):('광대세각(초광대로+세로)',88,89),
     ('대광대로','일반광대로'):('광대소각(대광대로+광대로)',94,96),('대광대로','대광대로'):('광대소각(대광대로+광대로)',94,96),('대광대로','초광대로'):('광대소각(대광대로+광대로)',94,96),
     ('대광대로','중로'):('광대소각(대광대로+중로)',91,92),('대광대로','소로'):('광대소각(대광대로+소로)',87,89),('대광대로','세로'):('광대세각(대광대로+세로)',83,85),
     ('일반광대로','일반광대로'):('광대소각(일반광대로+광대로)',91,93),('일반광대로','대광대로'):('광대소각(일반광대로+광대로)',91,93),('일반광대로','초광대로'):('광대소각(일반광대로+광대로)',91,93),
     ('일반광대로','중로'):('광대소각(일반광대로+중로)',87,89),('일반광대로','소로'):('광대소각(일반광대로+소로)',84,86),('일반광대로','세로'):('광대세각(일반광대로+세로)',80,82),
     ('중로','중로'):('중로각지',69,71),('중로','소로'):('중로각지',69,71),('중로','세로'):('중로각지',69,71),
     ('소로','소로'):('소로각지',51,51),('소로','세로'):('소로각지',51,51),
     ('세로','세로'):('세로각지',None,None)}
    r=T.get((b주,b부))
    if not r: return f'{b주}각지', None
    nm,s2,s3=r
    if tri and s3 is not None: return nm+'(3면 이상)', s3
    return nm, s2

def main():
    sgg=sys.argv[1] if len(sys.argv)>1 else '11680'
    road_pnu=set(); parcel_road={}
    dbfs=glob.glob(f"data/raw/토지특성/AL_D194_{sgg}_*/*.dbf") or glob.glob("data/raw/토지특성/AL_D194_*/*.dbf")
    for dbf in dbfs:
        n,f,rows=read_dbf(dbf,('cp949',))
        for r in rows():
            if r['A11']=='도로': road_pnu.add(r['A1'])
            else: parcel_road[r['A1']]=r['A24']
    r=shapefile.Reader(LDREG,encoding='cp949')
    idx=[f[0] for f in r.fields[1:]].index('PNU')
    roads=[]; parcels=[]
    for sr in r.iterShapeRecords():
        pnu=sr.record[idx]
        if not pnu.startswith(sgg): continue
        try: g=make_valid(shape(sr.shape.__geo_interface__))
        except: continue
        if pnu in road_pnu: roads.append(g)
        elif pnu in parcel_road: parcels.append((pnu,g))
    print(f"[{sgg}] 도로필지 {len(roads):,} · 건물필지 {len(parcels):,}")
    rtree=STRtree(roads)

    def road_faces(pg):
        """필지 경계 edge 중 도로 접한 것 → 수직실측 폭을 방향클러스터로."""
        ext=pg.exterior if pg.geom_type=='Polygon' else max(pg.geoms,key=lambda x:x.area).exterior
        xy=list(ext.coords)
        # 인근 도로 union (수직 실측용, 60m 버퍼 내)
        faces=[]
        for i in range(len(xy)-1):
            a,b=xy[i],xy[i+1]
            if math.hypot(b[0]-a[0],b[1]-a[1])<0.5: continue
            mid=Point((a[0]+b[0])/2,(a[1]+b[1])/2); mb=mid.buffer(1.2)
            wmax=0
            for ri in rtree.query(mb, predicate='intersects'):
                if roads[ri].intersects(mb): wmax=max(wmax, 2*roads[ri].area/roads[ri].length if roads[ri].length else 0)
            if wmax<=0: continue
            ang=math.degrees(math.atan2(b[1]-a[1],b[0]-a[0]))%180
            faces.append((ang,wmax))
        # 방향 클러스터(±20°, 순환) → 각 클러스터 최대폭
        if not faces: return []
        faces.sort()
        clusters=[]
        for ang,w in faces:
            placed=False
            for c in clusters:
                d=abs(c['ang']-ang); d=min(d,180-d)
                if d<=20: c['w']=max(c['w'],w); placed=True; break
            if not placed: clusters.append({'ang':ang,'w':w})
        return sorted((c['w'] for c in clusters), reverse=True)

    out={}; fd=collections.Counter()
    for pnu,pg in parcels:
        widths=road_faces(pg)
        n면=len(widths)
        주=widths[0] if widths else None
        부=widths[1] if n면>=2 else None
        세분,점수=classify(주,부,n면)
        old=parcel_road.get(pnu,'')
        if 세분 in ('세로한면','세로각지') or 점수 is None:
            세분=old or 세분; 점수=None
        out[pnu]={'도로접면_기존':old,'접면도로수':n면,
                  '주도로폭':round(주,1) if 주 else None,'부도로폭':round(부,1) if 부 else None,
                  '도로접면_세분':세분,'접면점수':점수}
        fd[n면]+=1
    json.dump(out,open(f"data/tools/_frontage_{sgg}.json",'w'),ensure_ascii=False)
    print(f"판정 {len(out):,}필지 · 접면수 분포 {dict(sorted(fd.items())[:6])}")
    print(f"저장: _frontage_{sgg}.json")

if __name__=='__main__': main()
