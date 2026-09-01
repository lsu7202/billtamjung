#!/usr/bin/env python3
"""건물 마스터 조립: 표제부 기준 1동=1행, PK 키.

대지면적·건폐율·용적률 = 총괄표제부(PNU) 우선 → 표제부 자체 → (대지면적만)토지특성.
FK: PNU(조립) → 토지 마스터. 층별 임대정보 프리필용 층별개요는 별도.
출력: _building_master.jsonl + 커버리지 리포트.

## 2026-08-31 — 자리 번호에서 이름으로 옮겼다

옛 판은 파이프 구분 전국본을 `p[35]` 식으로 읽었다. 그러다 두 번 다쳤다:
총괄표제부는 머리 블록이 표제부보다 두 칸 밀려 있는데 표제부 감각으로 읽어 엉뚱한 칸을
실었고, 옛 CSV 재적재로 지하 32만 층이 지상이 됐다.

새 서울본은 머리가 있는 CSV 라 **이름으로 읽는다.** 이름이 없으면 조용히 빈칸이 되는 게
아니라 hub_csv 가 그 자리에서 멈춘다. 25구가 다 있어야 돌고, 한 구라도 비면 멈춘다.

**이름은 손으로 적는다.** 자동 매칭을 쓰지 않는 이유는 원본 이름이 규칙 없이 다르기
때문이다 — 「률↔율」, 「코드명↔명」, 「용도」 접두 유무가 마트마다 제각각이고,
부속지번에는 `새주소법정도코드` 같은 HUB 오타도 있다. 자동으로 붙이면 안 붙는 것을
못 알아채거나 **엉뚱한 칸에 붙는다**(세대_수·가구_수·호_수가 셋 다 「수」로 붙을 뻔했다).
"""
import sys, json, glob, collections, re, csv
sys.path.insert(0,'data/tools')
from dbf_inspect import read_dbf
from hub_csv import rows as hub_rows
from build_report import Report

# ── 표제부에서 읽는 칸 (이름은 원본 그대로) ──────────────────────────
TTL = {
    "PK": "관리건축물대장PK", "대장구분": "대장구분코드명",
    "주소": "대지위치", "도로명주소": "도로명대지위치",
    "시군구": "시군구코드", "법정동": "법정동코드", "대지구분": "대지구분코드",
    "번": "번", "지": "지",
    "대지면적": "대지면적(㎡)", "건축면적": "건축면적(㎡)", "건폐율": "건폐율(%)",
    "연면적": "연면적(㎡)", "용적산정": "용적률산정연면적(㎡)", "용적률": "용적률(%)",
    "구조": "구조코드명", "주용도코드": "주용도코드", "주용도": "주용도코드명",
    "기타용도": "기타용도", "높이": "높이(m)",
    "지상층수": "지상층수", "지하층수": "지하층수",
    "승용승강기": "승용승강기수",
    "옥내기계": "옥내기계식대수(대)", "옥외기계": "옥외기계식대수(대)",
    "옥내자주": "옥내자주식대수(대)", "옥외자주": "옥외자주식대수(대)",
    "사용승인일": "사용승인일",
    # 새로 싣는 것 — 옛 판은 안 읽었다
    "허가일": "허가일", "착공일": "착공일",
    "대장종류": "대장종류코드명", "주부속구분": "주부속구분코드명",
    "건물명": "건물명", "동명": "동명칭",
    "기타구조": "기타구조", "지붕": "지붕코드명",
    "세대수": "세대수(세대)", "가구수": "가구수(가구)", "호수": "호수(호)",
    "총동연면적": "총동연면적(㎡)",
    "부속건축물수": "부속건축물수", "비상용승강기": "비상용승강기수",
    "외필지수": "외필지수", "생성일자": "생성일자",
    "내진적용": "내진설계적용여부", "내진능력": "내진능력",
}

# ── 총괄표제부에서 읽는 칸 ──────────────────────────────────────
CHG = {
    "시군구": "시군구코드", "법정동": "법정동코드", "대지구분": "대지구분코드",
    "번": "번", "지": "지",
    "대지면적": "대지면적(㎡)", "건폐율": "건폐율(%)", "용적률": "용적률(%)",
}

# ── 엘리베이터 보정: 한국승강기안전공단 설치현황(대장보다 정확) ──
# 대장(p[45])이 없음(0/빈값)인 건물을 승강기공단 데이터로 채움. 승강기고유번호=행=1대(대수 정확).
# 도로명 매칭 — 한 도로명에 복수 건물이면 대수 배분 불가 → '있음'(1)만(과다계상 방지).
_EL_FILES=["data/raw/한국승강기안전공단_승강기 설치 현황_2016년 이후.csv",
           "data/raw/한국승강기안전공단_승강기 설치 현황_2015년 이전.csv"]
_EL_EXCLUDE=("에스컬레이터","자동차용")   # 사람 승강기 아님
_EL_STATUS=("운행중","휴지")             # 폐지 제외
_paren=re.compile(r"\(.*?\)"); _ws=re.compile(r"\s+")
def norm_road(a):
    if not a: return None
    return _ws.sub("", _paren.sub("", a)) or None
def load_kelisa():
    cnt=collections.Counter()
    for fn in _EL_FILES:
        with open(fn, encoding='utf-8-sig') as f:
            for row in csv.DictReader(f):
                if row.get('시도')!='서울': continue
                if any(t in (row.get('승강기종류') or '') for t in _EL_EXCLUDE): continue
                if (row.get('승강기상태') or '') not in _EL_STATUS: continue
                k=norm_road(row.get('건물주소'))
                if k: cnt[k]+=1
    return cnt
def _elev(r, kel, multi):
    """대장 승용승강기 우선. 없음(0)이면 승강기공단 보정(도로명 단일=대수, 복수=있음)."""
    v=int(fnum(r[TTL['승용승강기']])) or None
    if v: return v
    k=norm_road(r[TTL['도로명주소']]); cnt=kel.get(k) if k else None
    if not cnt: return None
    return cnt if multi.get(k,0)<=1 else 1

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
    """총괄표제부 PNU→{대지,건폐,용적}."""
    d={}
    for r in hub_rows("대장", "총괄표제부", need=list(CHG.values())):
        pnu=mkpnu(r[CHG['시군구']], r[CHG['법정동']], r[CHG['대지구분']],
                  r[CHG['번']], r[CHG['지']])
        if not pnu: continue
        d[pnu]={'대지면적':fnum(r[CHG['대지면적']]),
                '건폐율':fnum(r[CHG['건폐율']]),
                '용적률':fnum(r[CHG['용적률']])}
    return d

def load_daesuseon():
    """build_daesuseon.py 결과를 읽는다 — PNU→{구분별 최근일·건수}.

    **구조가 바뀌었다.** 옛 판은 여기서 인허가 마트를 직접 훑어 날짜 하나만 남겼다.
    지금은 구분(증축·개축·재축·대수선·이전)마다 최근 날짜를 따로 두고, 대표값을 `_최근`에 둔다.
    한 필지에서 최신 건과 구분이 다를 수 있기 때문이다(강남 삼성동 159번지는 26건).
    """
    f="data/tools/_daesuseon_seoul.json"
    if not glob.os.path.exists(f):
        sys.exit(f"✗ {f} 없음 — data/tools/build_daesuseon.py 를 먼저 돌리세요")
    return json.load(open(f, encoding='utf-8'))

def _height(r):
    """표제부 높이(m). 실제 높이라 층고 가정(층수×3.5m)보다 정확하다.
    다만 56%만 채워져 있고 원본 오류가 섞여 있다(실측: 0.1m·13438m).
    층수와 대조해 층당 2~8m 밖이면 버린다 — 없는 것이 틀린 것보다 낫다."""
    h = fnum(r[TTL['높이']]); fl = int(fnum(r[TTL['지상층수']]) or 0)
    if not h or h <= 1 or h > 600: return None
    if fl > 0 and not (fl * 2 <= h <= fl * 8): return None
    return round(h, 1)


def _ymd(s):
    """YYYYMMDD 여덟 자리이고 그럴듯한 범위일 때만 남긴다. 아니면 None."""
    s = (s or '').strip()
    return s if (len(s) == 8 and s.isdigit() and '19000101' <= s <= '20301231') else None


def _ymd_loose(s):
    """(값, 정밀도) — 연·월만 알아도 버리지 않는다.

    실측(서울 표제부 55.4만): 형식이 어긋난 564건 중 **463건(82%)은 연도나 연월을 안다.**
        길이4 `1959` 279건 · 길이6 `199901` 184건 · 길이7 `1959080` 10건
    옛 판은 이걸 전부 버려 「사용승인일을 모르는 건물」로 만들었다. 1959년 준공이라는
    사실은 아는데 버릴 이유가 없다. **어디까지 아는지를 함께 싣는다.**

        20240115 → ('20240115', '일')
        199901   → ('199901',   '월')
        1959     → ('1959',     '연')
        00000000 → (None,       None)
    """
    s = (s or '').strip()
    if not s or not s.isdigit():
        return None, None
    if len(s) == 7:
        # 7자리는 두 가지다. **월이 한 자리인 쪽을 먼저 본다**(2026-09-01).
        #   1990327 → 1990-03-27  (YYYY M DD — 월에 0 을 안 붙임)
        #   1959080 → 1959-08-0?  (뒤가 잘림 — 연월까지만)
        # 앞 6자리만 취하면 1990327 이 「32월」이 되어 통째로 버려진다.
        mdd = s[:4] + "0" + s[4:]
        s = mdd if ("01" <= mdd[4:6] <= "12" and "01" <= mdd[6:] <= "31") else s[:6]
    if len(s) == 8:
        return (s, '일') if '19000101' <= s <= '20301231' else (None, None)
    if len(s) == 6:
        return (s, '월') if ('190001' <= s <= '203012' and '01' <= s[4:] <= '12') else (None, None)
    if len(s) == 4:
        return (s, '연') if '1900' <= s <= '2030' else (None, None)
    return None, None

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
    print("승강기공단 로드…"); kel=load_kelisa()
    print(f"  정규화 주소 {len(kel):,}건 · 총 {sum(kel.values()):,}대")

    NEED=list(TTL.values())
    print("도로명 다중도 프리패스…")      # 엘리베이터 배분에 쓴다
    elmulti=collections.Counter()
    for r in hub_rows("대장", "표제부", need=NEED):
        k=norm_road(r[TTL['도로명주소']])
        if k: elmulti[k]+=1

    print("표제부 조립…")
    rep=Report("build_building_master", src=("대장","표제부"), used=TTL.values())
    out=open("data/tools/_building_master.jsonl","w")
    N=0; src=collections.Counter(); clean_cnt=collections.Counter(); bcr_src_cnt=collections.Counter()
    has_pnu=has_land=has_area=has_far=0
    for r in hub_rows("대장", "표제부", need=NEED):
        g_ = lambda k: (r[TTL[k]] or '').strip()
        N+=1; rep.read()
        if not (r[TTL['PK']] or '').strip():
            rep.drop("PK 없음"); continue
        pnu=mkpnu(g_('시군구'), g_('법정동'), g_('대지구분'), g_('번'), g_('지'))

        # 대지·건폐·용적: 총괄 우선 → 표제부 → (대지)토지
        pyo_dae=fnum(g_('대지면적')); 건축면적=fnum(g_('건축면적')); 용적산정=fnum(g_('용적산정'))
        area=bcr=far=0.0; s_='표제부'
        g=chg.get(pnu) if pnu else None
        if g and g['대지면적']>0:
            area,bcr,far,s_=g['대지면적'],g['건폐율'],g['용적률'],'총괄'
        if area==0 and pyo_dae>0:
            area,bcr,far,s_=pyo_dae,fnum(g_('건폐율')),fnum(g_('용적률')),'표제부'
        if area==0 and pnu in larea and larea[pnu]>0:
            area,s_=larea[pnu],'토지특성'

        # ── 클린징을 하지 않는다(2026-08-31) ──
        # 옛 판은 건폐율>100%·용적률>2000% 를 건축면적÷대지면적으로 **다시 계산해 넣었다.**
        # 그건 대장이 준 값이 아니라 우리가 만든 값이고, 그 값이 화면·계약서·확인설명서로
        # 그대로 나간다. 0144 에서 「건폐율은 대장이 준 것만 싣는다」로 이미 정한 원칙과도
        # 어긋난다. 원본이 이상하면 이상한 채로 싣고, 이상하다는 사실만 기록한다.
        # 계산분이 필요하면 검색 전용 master.building_calc 에서 따로 만든다.
        _pk=g_('PK')
        clean='원본'
        if bcr and bcr>100:
            rep.note_odd("건폐율 100% 초과 — 원본 그대로 실음", _pk, bcr)
        if far and far>2000:
            rep.note_odd("용적률 2000% 초과 — 원본 그대로 실음", _pk, far)
        # 건폐율은 **대장이 준 것만** 싣는다. 건축면적÷대지면적으로 채울 수 있어도
        # 채우지 않는다 — 이 값이 계약서·확인설명서·브리핑으로 그대로 넘어가고,
        # 거기서 대장과 어긋나면 우리 잘못이 된다(0144).
        bcr_src = '대장' if bcr else None

        if not pnu: rep.null("PNU 조립 불가", _pk, g_('주소'))
        sd, sd_prec = _ymd_loose(g_('사용승인일'))
        if g_('사용승인일') and not sd:
            rep.null("사용승인일 못 읽음", _pk, g_('사용승인일'))
        dsr = (ds.get(pnu) or {}) if pnu else {}
        top = dsr.get('_최근') or {}
        rec={
            'PK':g_('PK'), '대장구분':g_('대장구분'),
            '주소':g_('주소'), '도로명주소':g_('도로명주소'),
            'PNU':pnu,
            '대지면적':round(area,2),'건폐율':bcr,'용적률':far,'건폐율출처':bcr_src,
            '건축면적':round(건축면적,2) if 건축면적>0 else None,
            '대지건폐용적_출처':s_,'건폐용적_클린':clean,
            '연면적':fnum(g_('연면적')),
            '주용도코드':g_('주용도코드'),'주용도':g_('주용도'),'기타용도':g_('기타용도'),
            '구조':g_('구조'), '기타구조':g_('기타구조') or None, '지붕':g_('지붕') or None,
            '지상층수':int(fnum(g_('지상층수'))),'지하층수':int(fnum(g_('지하층수'))),
            '높이':_height(r),
            '엘리베이터':_elev(r, kel, elmulti),
            '비상용승강기':int(fnum(g_('비상용승강기'))) or None,
            '주차':int(fnum(g_('옥내기계'))+fnum(g_('옥외기계'))
                     +fnum(g_('옥내자주'))+fnum(g_('옥외자주'))) or None,
            '용적률산정연면적':round(용적산정,2) if 용적산정>0 else None,
            '총동연면적':fnum(g_('총동연면적')) or None,
            '사용승인일':sd, '사용승인일_정밀도':sd_prec,
            '허가일':_ymd_loose(g_('허가일'))[0], '착공일':_ymd_loose(g_('착공일'))[0],
            '대장종류':g_('대장종류') or None, '주부속구분':g_('주부속구분') or None,
            '건물명':g_('건물명') or None, '동명':g_('동명') or None,
            '세대수':int(fnum(g_('세대수'))) or None,
            '가구수':int(fnum(g_('가구수'))) or None,
            '호수':int(fnum(g_('호수'))) or None,
            '부속건축물수':int(fnum(g_('부속건축물수'))) or None,
            '외필지수':int(fnum(g_('외필지수'))) or None,
            '내진적용':g_('내진적용') or None, '내진능력':g_('내진능력') or None,
            '생성일자':_ymd(g_('생성일자')),
            # 대수선 — 구분별 최근일을 그대로 싣는다
            '최근대수선일': top.get('일자'),
            '최근대수선구분': top.get('구분'),
            '대수선건수': dsr.get('_건수', 0),
            '대수선이력': {k:v for k,v in dsr.items() if not k.startswith('_')} or None,
        }
        out.write(json.dumps(rec,ensure_ascii=False)+"\n"); rep.write()
        src[s_]+=1; clean_cnt[clean]+=1; bcr_src_cnt[bcr_src or '없음']+=1
        if pnu: has_pnu+=1
        if pnu in landset: has_land+=1
        if area>0: has_area+=1
        if far and far>0: has_far+=1
    out.close()
    rep.note(f"대지/건폐/용적 출처: {dict(src)}")
    rep.note(f"건폐율 출처: {dict(bcr_src_cnt)}")
    rep.finish()
    print(f"\n건물 마스터 {N:,}동 → _building_master.jsonl")
    print(f"  PNU 조립 {has_pnu:,} ({has_pnu/N*100:.1f}%) · 토지 매칭 {has_land:,} ({has_land/N*100:.1f}%)")
    print(f"  대지면적 확보 {has_area:,} ({has_area/N*100:.1f}%) · 용적률 확보 {has_far:,} ({has_far/N*100:.1f}%)")
    print(f"  대지/건폐/용적 출처: {dict(src)}")
    print(f"  건폐용적 클린징: {dict(clean_cnt)}")
    print(f"  건폐율 출처: {dict(bcr_src_cnt)}")

if __name__=='__main__': main()
