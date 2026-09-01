#!/usr/bin/env python3
"""필지(지적도) ∩ 용도지역(UQ111) ∩ 개발제한(UD801) 면적가중 공간조인.
좌표계: 모두 EPSG:5174(중부원점 TM), 재투영 불필요. shapely STRtree 사용.
출력: PNU별 [용도지역명→면적비중], 개발제한 비중.
사용: python spatial_join.py [시군구코드5|ALL]
"""
import sys, os, json, time, glob, re
import shapefile
from shapely.geometry import shape
from shapely import STRtree, area, intersection, make_valid
from shapely.ops import transform as shp_transform
from pyproj import Transformer
from uqa_codes import uqa_name
from paths import LDREG, UD801, UQ111
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from build_report import Report   # noqa: E402

# UD801은 EPSG:5186, 나머지(지적도·UQ111)는 5174 → UD801만 재투영
_T = Transformer.from_crs(5186, 5174, always_xy=True)
def to5174(g):
    return shp_transform(lambda x, y, z=None: _T.transform(x, y), g)

LDREG=LDREG
UQ111=UQ111
UD801=UD801

def load_polys(path, want_fields, sgg=None, reproject=False):
    r=shapefile.Reader(path, encoding='cp949')
    flds=[f[0] for f in r.fields[1:]]
    idx={f:i for i,f in enumerate(flds)}
    geoms=[]; attrs=[]
    for sr in r.iterShapeRecords():
        rec=sr.record
        if sgg and rec[idx['COL_ADM_SE']]!=sgg: continue
        try:
            g=shape(sr.shape.__geo_interface__)
            if reproject: g=to5174(g)
            if not g.is_valid: g=make_valid(g)
        except Exception:
            continue
        geoms.append(g)
        attrs.append({k:rec[idx[k]] for k in want_fields})
    return geoms, attrs

def uqa_code(mnum):
    m=re.search(r'UQA(\d{4})', mnum or '')
    return m.group(1) if m else None

def run(sgg):
    t0=time.time()
    sggf=None if sgg=='ALL' else sgg
    parcels_g, parcels_a = load_polys(LDREG, ['PNU'], sggf)
    zones_g, zones_a = load_polys(UQ111, ['ALIAS','MNUM'], sggf)
    dev_g, _ = load_polys(UD801, ['MNUM'], sggf, reproject=True)  # 5186→5174
    print(f"필지 {len(parcels_g):,} · 용도지역 {len(zones_g):,} · 개발제한 {len(dev_g):,}  (로드 {time.time()-t0:.1f}s)")

    # 토지이음(정본)과 표본 2,857필지로 임계를 맞춰 고른 값(2026-08-28).
    # 1%면 정본이 적는 작은 조각이 잘리고, 0.02%면 정본이 안 적는 조각까지 센다.
    #   1%  98.77%   ·  0.2%  99.19%  ·  **0.1%  99.54%**  ·  0.05%  99.26%
    MIN_SHARE=float(os.environ.get("MIN_SHARE", "0.001"))
    ztree=STRtree(zones_g)
    dtree=STRtree(dev_g) if dev_g else None
    # 처리결과 문서 — 면적 0 인 필지를 조용히 건너뛰던 자리가 있었다.
    # 여기서 빠지면 그 필지는 용도지역을 영영 못 받는다.
    doc = Report(f"spatial_join_{sgg or 'ALL'}", src="연속지적도 ∩ 용도지역(UQ111) ∩ 개발제한(UD801)")
    out={}
    multi=covered=devcnt=0
    t1=time.time()
    for i,(pg,pa) in enumerate(zip(parcels_g, parcels_a)):
        doc.read()
        pnu=pa['PNU']; parea=pg.area
        if parea<=0:
            doc.drop("필지 면적이 0 이하", pnu); continue
        rec={'용도지역':[], '개발제한비중':0.0}
        # 용도지역
        cand=ztree.query(pg, predicate='intersects')
        parts={}
        for zi in cand:
            try: ia=intersection(pg, zones_g[zi]).area
            except Exception: continue
            if ia<=0: continue
            name,code=uqa_name(uqa_code(zones_a[zi]['MNUM']))
            # UQ111 이 안 덮은 자리를 「미지정」으로 세면 필지가 반쪽으로 갈린다.
            # 토지이음은 그 자리를 아예 안 적는다 — 우리도 안 적는다(2026-08-28).
            if name=='미지정': continue
            key=(name,code)
            parts[key]=parts.get(key,0.0)+ia
        if parts:
            covered+=1
            # 슬리버 제거 + 재정규화
            kept={k:v for k,v in parts.items() if v/parea>=MIN_SHARE}
            if not kept: kept={max(parts,key=parts.get):max(parts.values())}
            tot=sum(kept.values())
            rec['용도지역']=sorted(
                [{'명':k[0],'코드':k[1],'비중':round(v/tot,4)} for k,v in kept.items()],
                key=lambda x:-x['비중'])
            if len(rec['용도지역'])>1: multi+=1
        # 개발제한
        if dtree is not None:
            dc=dtree.query(pg, predicate='intersects')
            da=0.0
            for di in dc:
                try: da+=intersection(pg, dev_g[di]).area
                except Exception: continue
            if da>0:
                rec['개발제한비중']=round(da/parea,4); devcnt+=1
        out[pnu]=rec
        doc.write()
        if (i+1)%50000==0:
            print(f"  {i+1:,} 처리 ({time.time()-t1:.0f}s)")
    dt=time.time()-t1
    N=len(parcels_g)
    doc.also_read("용도지역 폴리곤", len(zones_g))
    doc.also_read("개발제한 폴리곤", len(dev_g))
    doc.output(len(out))
    doc.note(f"용도지역 배정 {covered:,} · 걸침(2+) {multi:,} · 개발제한 접함 {devcnt:,}")
    doc.finish()
    print(f"\n[{sgg}] 필지 {N:,}")
    print(f"  용도지역 배정 {covered:,} ({covered/N*100:.1f}%) · 걸침(2+) {multi:,} ({multi/max(covered,1)*100:.1f}%)")
    print(f"  개발제한 접함 {devcnt:,} ({devcnt/N*100:.1f}%)")
    print(f"  조인 {dt:.1f}s ({N/max(dt,0.1):.0f} 필지/s)")
    ex=list(out.items())[:2]+[ (k,v) for k,v in out.items() if len(v['용도지역'])>1 ][:2]
    for k,v in ex: print(f"  {k}: {v}")
    return out

if __name__=='__main__':
    sgg=sys.argv[1] if len(sys.argv)>1 else '11110'
    out=run(sgg)
    fn = "data/tools/_spatial_ALL.json" if sgg=='ALL' else f"data/tools/_spatial_{sgg}.json"
    json.dump(out, open(fn,'w'), ensure_ascii=False)
    print(f"저장: {fn} ({len(out):,} PNU)")
