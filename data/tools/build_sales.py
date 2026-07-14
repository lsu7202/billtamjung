#!/usr/bin/env python3
"""매각 레이어: 실거래가(상업업무용 F + 단독다가구 C, 매매) → A(동 집계) + A+(통건물 추정 매칭).
A+  : 통건물(지번 마스킹/비공개) → 건물마스터에 대지±2%·연면적±3%·건축년도==사용승인연도±1 매칭.
지번 비공개로 정확검증 불가 → '추정' 고지 전제.
단독다가구 포함 근거: 주상(주택+상가) 통건물 거래는 C로 신고됨 — 역삼동 601-5(2009 40.5억·2019 69억)로 실증.
"""
import csv, glob, sys, collections, statistics, json
sys.path.insert(0,'data/tools')
from dbf_inspect import read_dbf

def rtms_rows():
    """(category, hdr, r) — F=상업업무용, C=단독다가구(스키마 다름)."""
    for path in sorted(glob.glob("data/raw/실거래가/*_매매_서울_*.csv")):
        cat='F' if '상업업무용' in path else 'C'
        with open(path, encoding='cp949', errors='replace') as f:
            rd=csv.reader(f); hdr=None
            for r in rd:
                if hdr is None:
                    if r and r[0].strip()=='NO' and '시군구' in r: hdr={c.strip():i for i,c in enumerate(r)}
                    continue
                if len(r)<len(hdr): continue
                yield cat,hdr,r

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
        yr=(b['사용승인일'] or '')[:4]
        bybjd[pnu[:10]].append((b['PK'], b['대지면적'], b['연면적'],
                                int(yr) if yr.isdigit() else None, b['주소'], b['주용도']))

    A=collections.defaultdict(list)      # 법정동코드 → [거래]
    n_all=n_whole=n_haeje=n_jibun=0
    cat_cnt=collections.Counter()
    cand=[]                               # A+ 매칭 후보(통건물)
    for cat,hdr,r in rtms_rows():
        n_all+=1; cat_cnt[cat]+=1
        g=lambda k: r[hdr[k]] if k in hdr else ''
        if g('해제사유발생일').strip() not in ('','-'): n_haeje+=1; continue   # 해제거래 제외
        sgg=g('시군구').strip(); code=name2code.get(sgg)
        amt=num(g('거래금액(만원)'));
        if amt: amt=int(amt*10000)
        # F: 전용/연면적 · 유형(일반/집합) · 지분구분 | C: 연면적 · 전부 통건물 · 지분열 없음
        yeon=num(g('전용/연면적(㎡)')) or num(g('연면적(㎡)'))
        dae=num(g('대지면적(㎡)'))
        ym=g('계약년월').strip(); byr=g('건축년도').strip()
        typ=g('유형').strip() if cat=='F' else '일반'
        whole = (typ=='일반')                 # 통건물 여부 (C는 항상)
        rec={'금액':amt,'연면적':yeon,'대지':dae,'계약년월':ym,'건축년도':byr,
             '용도지역':g('용도지역').strip(),'주용도':g('건축물주용도').strip() or g('주택유형').strip(),
             '유형':typ,'카테고리':cat}
        if code: A[code].append(rec)
        if whole:
            n_whole+=1
            if cat=='F' and g('지분구분').strip()=='지분': n_jibun+=1; continue
            if code and dae and yeon and byr.isdigit():
                cand.append((code,dae,yeon,int(byr),amt,ym,rec))

    # ── A+ 매칭 (2단계: 정밀 ±0.5% → 완화 ±2%/±3%) ──
    # 근거: 실거래 신고 면적은 건축물대장 복사값이라 진짜 건물은 소수점까지 일치
    # (역삼동 601-5 실증: 완화범위 후보 5동 중 정확일치는 1동뿐)
    matched=[]; unique=multi=none=0; tier_cnt=collections.Counter()
    for code,dae,yeon,byr,amt,ym,rec in cand:
        tight=[]; loose=[]
        for (PK,bdae,byeon,byear,addr,use) in bybjd.get(code,[]):
            if byear is None: continue
            dd=abs(bdae-dae)/dae; dy=abs(byeon-yeon)/yeon
            if dd<=0.02 and dy<=0.03 and abs(byear-byr)<=1:
                h=(PK,addr,use,bdae,byeon,byear)
                loose.append(h)
                if dd<=0.005 and dy<=0.005: tight.append(h)
        if len(tight)==1:
            unique+=1; tier_cnt['정밀']+=1; matched.append((rec,tight[0]))
        elif len(loose)==1:
            unique+=1; tier_cnt['완화']+=1; matched.append((rec,loose[0]))
        elif len(loose)>1: multi+=1
        else: none+=1

    print(f"실거래 총 {n_all:,}건 (상업업무용 {cat_cnt['F']:,} + 단독다가구 {cat_cnt['C']:,} · 해제제외 {n_haeje:,})")
    print(f"  통건물 {n_whole:,} · 그중 지분 {n_jibun:,}")
    tot=unique+multi+none
    print(f"\n추정 매칭 대상(통건물·비지분·대지+연면적+건축년도 완비) {tot:,}건:")
    print(f"  단일확정 {unique:,} ({unique/tot*100:.1f}%) [정밀 {tier_cnt['정밀']:,} + 완화 {tier_cnt['완화']:,}] · 다중후보 {multi:,} ({multi/tot*100:.1f}%) · 무매칭 {none:,} ({none/tot*100:.1f}%)")
    for rec,h in matched[:5]:
        print(f"  {h[1]} {h[2]} | 실거래 {rec['계약년월']} {rec['금액']:,}원 (대지{rec['대지']}·연{rec['연면적']}·{rec['건축년도']}년)")

    # ── 저장: 건물별 추정 매각이력 (PK→이력). 유저 수정 가능. ──
    # 주변 매각시세는 반경 기반(S03에서 조회) — 동 집계(동시세) 폐기.
    est=collections.defaultdict(list)
    for rec,h in matched:
        est[h[0]].append({'계약년월':rec['계약년월'],'금액':rec['금액'],
            '연면적':rec['연면적'],'대지':rec['대지'],'단가_연면적':round(rec['금액']/rec['연면적']) if rec['연면적'] else None})
    for pk in est: est[pk].sort(key=lambda x:x['계약년월'])
    json.dump(est, open("data/tools/_sales_est.json",'w'), ensure_ascii=False)
    print(f"\n저장: _sales_est.json ({len(est):,}동에 추정 매각이력)")

if __name__=='__main__': main()
