#!/usr/bin/env python3
"""규제 레이어 공간교차 (강남 11680 기준).

## 2026-09-01 — 파이프라인에서 뺐다. 원장이 정본이다

이 스크립트는 필지에 겹치는 규제 레이어를 폴리곤 교차로 찾는다. 그런데 실제로 나오는
플래그는 **지구단위계획 하나뿐**이고(252,789필지), 원장은 지역·지구를 전부 + 저촉여부
(포함·접함·저촉) + 코드까지 적어 준다:

    우리   {"지구단위계획": "경복궁서측지구단위계획구역"}
    원장   [["도시지역","포함","UQA01X"], ["지구단위계획구역","포함","UQQ300"],
            ["토지거래계약에관한허가구역","포함","UQQ600"], ["상대보호구역","포함","UOA120"],
            ["역사문화환경보존지역","포함","UOC800"], ["중점경관관리구역","포함","ZQ0001"], …]

**지우지 않고 남긴다.** 레이어 목록과 교차 판정은 원장을 검증할 때 쓴다.

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
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from build_report import Report   # noqa: E402

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
    # 처리결과 문서 — 이 파일은 `rep` 를 이미 「대표 필드명」으로 쓰므로 문서는 doc.
    # 규제 플래그는 화면의 「규제·특례」로 그대로 나간다. 못 읽은 필지가 몇인지 남겨야 한다.
    doc = Report(f"build_regulations_{sgg}", src="연속지적도 ∩ 고도·지구단위·정비·경관·방화·문화재")
    r=shapefile.Reader(LDREG,encoding='cp949')
    pidx=[f[0] for f in r.fields[1:]].index('PNU')
    parcels=[]
    for sr in r.iterShapeRecords():
        pnu=sr.record[pidx]
        if not pnu.startswith(sgg): continue
        doc.read()
        try:
            g=shape(sr.shape.__geo_interface__)
        except Exception:
            doc.drop("필지 도형을 못 읽음", pnu); continue
        parcels.append((pnu, make_valid(g) if not g.is_valid else g))
        doc.write()
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
    for name, _f, _v, _r in LAYERS:
        doc.note(f"{name}: {sum(1 for p in reg if name in reg[p]):,} 필지")
    doc.finish()
    print(f"저장: _regulations_{sgg}.json")

if __name__=='__main__': main()
