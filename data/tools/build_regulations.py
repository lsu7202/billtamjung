#!/usr/bin/env python3
"""규제 레이어 공간교차 (강남 11680 기준).
필지(지적도 5174) ∩ 고도지구·지구단위·정비·재정비·경관·방화·문화재.
5186 레이어는 5174로 재투영. 출력: _regulations_{sgg}.json (PNU→규제 플래그).
사용: python build_regulations.py [sgg5]  (기본 11680)
"""
import sys, json, glob, re, os
import shapefile
from shapely.geometry import shape
from shapely import STRtree, make_valid, intersection
from shapely.ops import transform as shp_transform
from pyproj import Transformer
from paths import LDREG

_T = Transformer.from_crs(5186, 5174, always_xy=True)
def to5174(g): return shp_transform(lambda x,y,z=None:_T.transform(x,y), g)

def load_layer(folder, val_field, reproject, label):
    """→ [(geom5174, 값)]"""
    path=glob.glob(f"data/raw/{folder}/*.shp")
    if not path: path=glob.glob(f"data/raw/{folder}/*/*.shp")
    r=shapefile.Reader(path[0][:-4], encoding='cp949')
    flds=[f[0] for f in r.fields[1:]]; idx={f:i for i,f in enumerate(flds)}
    out=[]
    for sr in r.iterShapeRecords():
        rec=sr.record
        try:
            g=shape(sr.shape.__geo_interface__)
            if reproject: g=to5174(g)
            if not g.is_valid: g=make_valid(g)
        except: continue
        # 값 추출 (없으면 REMARK/ALIAS 폴백, 최종 'Y')
        if val_field=='고도':
            v=rec[idx['REMARK']] or rec[idx['ALIAS']]
        elif val_field in idx:
            v=rec[idx[val_field]] or (rec[idx['REMARK']] if 'REMARK' in idx else '') or (rec[idx['ALIAS']] if 'ALIAS' in idx else '')
        else:
            v=''
        out.append((g, str(v).strip() or 'Y'))
    return out

LAYERS=[
 ('고도지구','LSMD_CONT_UQ123_서울','고도',True),
 ('지구단위계획','C_UQ161','DGM_NM',False),
 ('정비구역','LSMD_CONT_UD602_서울','ALIAS',True),
 ('재정비촉진','LSMD_CONT_UD603_서울','ALIAS',True),
 ('경관지구','LSMD_CONT_UQ121_서울','ALIAS',True),
 ('방화지구','LSMD_CONT_UQ124_서울','ALIAS',True),
 ('문화재보존','LSMD_CONT_UO301_서울','ALIAS',True),
]

def main():
    sgg=sys.argv[1] if len(sys.argv)>1 else '11680'
    # 강남 필지 (지적도 5174)
    r=shapefile.Reader(LDREG,encoding='cp949')
    pidx=[f[0] for f in r.fields[1:]].index('PNU')
    parcels=[]
    for sr in r.iterShapeRecords():
        pnu=sr.record[pidx]
        if not pnu.startswith(sgg): continue
        g=shape(sr.shape.__geo_interface__)
        parcels.append((pnu, make_valid(g) if not g.is_valid else g))
    print(f"[{sgg}] 필지 {len(parcels):,}")
    reg={pnu:{} for pnu,_ in parcels}
    pgeoms=[g for _,g in parcels]
    ptree=STRtree(pgeoms)
    for name, folder, vf, rep in LAYERS:
        polys=load_layer(folder, vf, rep, name)
        hit=0
        for g, val in polys:
            for pi in ptree.query(g, predicate='intersects'):
                # 실제 겹침 면적 확인(경계 접촉 제외)
                try:
                    if intersection(pgeoms[pi], g).area <= 1: continue
                except: continue
                pnu=parcels[pi][0]
                reg[pnu][name]=val   # 값 보존(높이·구역명·종 등, 없으면 'Y')
                hit+=1
        n_pnu=sum(1 for p in reg if name in reg[p])
        print(f"  {name}: {n_pnu:,} 필지 ({len(polys)} 폴리곤)")
    json.dump(reg, open(f"data/tools/_regulations_{sgg}.json",'w'), ensure_ascii=False)
    print(f"저장: _regulations_{sgg}.json")

if __name__=='__main__': main()
