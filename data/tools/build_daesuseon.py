#!/usr/bin/env python3
"""대수선 재구성: mart_kcy_01(인허가) → PNU→{최근대수선일, 건수}.
- 건축구분(idx20) ∈ {증축·개축·재축·대수선·이전} (신축·용도변경·발코니·행정변경·가설 제외)
- 날짜 = 사용승인일(idx37) 우선, 없으면 허가일(idx38) 폴백. (idx40=20220813 오염 회피, idx15 kcy_05 폐기)
- 서울만(시군구 11xxx). PNU cols 3~7."""
import collections, json
MP={'0':'1','1':'2','2':'1'}
TARGET={'증축','개축','재축','대수선','이전'}
def mkpnu(sgg,emd,dg,bon,bu):
    if not(sgg.isdigit() and emd.isdigit() and bon.isdigit() and bu.isdigit()): return None
    p=f"{sgg}{emd}{MP.get(dg,dg)}{int(bon):04d}{int(bu):04d}"
    return p if len(p)==19 else None
def dig(s):
    s=''.join(ch for ch in (s or '') if ch.isdigit()); return s if len(s)==8 else None

latest={}; cnt=collections.Counter(); n=0
with open("data/raw/mart_kcy_01.txt", encoding='utf-8', errors='replace') as f:
    for line in f:
        c=line.rstrip('\n').split('|')
        if len(c)<41 or not c[3].startswith('11'): continue
        if c[20].strip() not in TARGET: continue
        pnu=mkpnu(c[3],c[4],c[5],c[6],c[7])
        if not pnu: continue
        d=dig(c[37]) or dig(c[38])       # 사용승인일 우선, 허가일 폴백
        if not d: continue
        n+=1; cnt[pnu]+=1
        if pnu not in latest or d>latest[pnu]: latest[pnu]=d
out={pnu:{'최근대수선일':latest[pnu],'대수선건수':cnt[pnu]} for pnu in latest}
json.dump(out, open("data/tools/_daesuseon_seoul.json",'w'), ensure_ascii=False)

# 검증
yr=collections.Counter(v['최근대수선일'][:4] for v in out.values())
spike=collections.Counter(v['최근대수선일'] for v in out.values())
print(f"대상 인허가 {n:,}건 → PNU {len(out):,}개")
print(f"최빈 날짜: {spike.most_common(3)}")
print(f"연도분포(최근): "+" ".join(f"{y}:{yr[y]:,}" for y in sorted(yr,reverse=True)[:8]))
