#!/usr/bin/env python3
"""매각 레이어: 실거래가(상업업무용 매매) → A(동 집계) + A+(통건물 추정 매칭).
A+  : 일반(통건물, 지번 마스킹) → 건물마스터에 대지±2%·연면적±3%·건축년도==사용승인연도±1 매칭.
지번 마스킹으로 정확검증 불가 → '추정' 고지 전제.
"""
import csv, glob, sys, collections, statistics, json
sys.path.insert(0,'data/tools')
from dbf_inspect import read_dbf

def rtms_rows():
    for path in sorted(glob.glob("data/raw/실거래가/상업업무용_매매_서울_*.csv")):
        with open(path, encoding='cp949', errors='replace') as f:
            rd=csv.reader(f); hdr=None
            for r in rd:
                if hdr is None:
                    if r and r[0].strip()=='NO' and '시군구' in r: hdr={c.strip():i for i,c in enumerate(r)}
                    continue
                if len(r)<len(hdr): continue
                yield hdr,r

def num(s):
    s=(s or '').replace(',','').strip()
    try: return float(s)
    except: return None

def main():
    # 법정동명→코드 (토지특성 A3=동명, A2=법정동코드10)
    name2code={}
    for dbf in sorted(glob.glob("data/raw/토지특성/AL_D194_*/AL_D194_*.dbf")):
        n,f,rows=read_dbf(dbf,('cp949',))
        for r in rows(): name2code.setdefault(r['A3'].strip(), r['A2'])
    # 건물마스터 법정동코드→[건물]
    bybjd=collections.defaultdict(list)
    for line in open("data/tools/_building_master.jsonl"):
        b=json.loads(line)
        if b['대장구분']!='일반': continue          # 통건물 후보만
        pnu=b['PNU']
        if not pnu or b['대지면적']<=0 or b['연면적']<=0: continue
        yr=b['사용승인일'][:4]
        bybjd[pnu[:10]].append((b['PK'], b['대지면적'], b['연면적'],
                                int(yr) if yr.isdigit() else None, b['주소'], b['주용도']))

    A=collections.defaultdict(list)      # 법정동코드 → [거래]
    n_all=n_ilban=n_haeje=n_jibun=0
    cand=[]                               # A+ 매칭 후보(일반)
    for hdr,r in rtms_rows():
        n_all+=1
        g=lambda k: r[hdr[k]] if k in hdr else ''
        if g('해제사유발생일') not in ('','-'): n_haeje+=1; continue   # 해제거래 제외
        sgg=g('시군구').strip(); code=name2code.get(sgg)
        amt=num(g('거래금액(만원)'));
        if amt: amt=int(amt*10000)
        yeon=num(g('전용/연면적(㎡)')); dae=num(g('대지면적(㎡)'))
        ym=g('계약년월').strip(); byr=g('건축년도').strip()
        typ=g('유형').strip()
        rec={'금액':amt,'연면적':yeon,'대지':dae,'계약년월':ym,'건축년도':byr,
             '용도지역':g('용도지역').strip(),'주용도':g('건축물주용도').strip(),'유형':typ}
        if code: A[code].append(rec)
        if typ=='일반':
            n_ilban+=1
            if g('지분구분').strip()=='지분': n_jibun+=1; continue
            if code and dae and yeon and byr.isdigit():
                cand.append((code,dae,yeon,int(byr),amt,ym,rec))

    # ── A+ 매칭 ──
    matched=[]; unique=multi=none=0
    for code,dae,yeon,byr,amt,ym,rec in cand:
        hits=[]
        for (PK,bdae,byeon,byear,addr,use) in bybjd.get(code,[]):
            if byear is None: continue
            if abs(bdae-dae)/dae<=0.02 and abs(byeon-yeon)/yeon<=0.03 and abs(byear-byr)<=1:
                hits.append((PK,addr,use,bdae,byeon,byear))
        if len(hits)==1: unique+=1; matched.append((rec,hits[0]))
        elif len(hits)>1: multi+=1
        else: none+=1

    print(f"실거래 총 {n_all:,}건 (해제제외 {n_haeje:,})")
    print(f"  유형 일반(통건물) {n_ilban:,} · 그중 지분 {n_jibun:,}")
    print(f"  A(동집계): {len(A):,}개 법정동에 거래 분포")
    tot=unique+multi+none
    print(f"\nA+ 매칭 대상(일반·비지분·대지+연면적+건축년도 완비) {tot:,}건:")
    print(f"  단일확정 {unique:,} ({unique/tot*100:.1f}%) · 다중후보 {multi:,} ({multi/tot*100:.1f}%) · 무매칭 {none:,} ({none/tot*100:.1f}%)")
    print("\n[A+ 단일확정 예시 5]")
    for rec,h in matched[:5]:
        print(f"  {h[1]} {h[2]} | 실거래 {rec['계약년월']} {rec['금액']:,}원 (대지{rec['대지']}·연{rec['연면적']}·{rec['건축년도']}년)")
        print(f"      ↔ 건물 대지{h[3]:.0f}·연{h[4]:.0f}·승인{h[5]}")

    # ── 저장: A+(PK→추정 매각이력), A(법정동→시세집계) ──
    aplus=collections.defaultdict(list)
    for rec,h in matched:
        aplus[h[0]].append({'계약년월':rec['계약년월'],'금액':rec['금액'],
            '연면적':rec['연면적'],'대지':rec['대지'],'단가_연면적':round(rec['금액']/rec['연면적']) if rec['연면적'] else None})
    for pk in aplus: aplus[pk].sort(key=lambda x:x['계약년월'])
    json.dump(aplus, open("data/tools/_sales_aplus.json",'w'), ensure_ascii=False)

    area={}
    for code,recs in A.items():
        ilban=[x for x in recs if x['유형']=='일반' and x['금액'] and x['연면적']]
        if not ilban: continue
        amts=[x['금액'] for x in ilban]; units=[x['금액']/x['연면적'] for x in ilban]
        area[code]={'건수':len(ilban),'거래금액_중앙':int(statistics.median(amts)),
                    '단가연면적_중앙':int(statistics.median(units))}
    json.dump(area, open("data/tools/_sales_area.json",'w'), ensure_ascii=False)
    print(f"\n저장: _sales_aplus.json ({len(aplus):,}동에 추정이력) · _sales_area.json ({len(area):,}법정동 시세)")

if __name__=='__main__': main()
