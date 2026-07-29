"""임대추정 공용 로직 — floor/building 빌더 공유. 요율 매핑은 여기 한 곳에서만.

한국부동산원 상업용부동산 임대동향조사 통계표(단일 파일, 78시트) → master.floor_rent_est / building_rent_est.
서울 전 상권(오피스 34·중대형 73·소규모 64) 커버. 상권명 = master.sanggwon.nm 와 68개 완전 매칭.

시트: 107 오피스 층별임대료 · 205 중대형 · 305 소규모 (하위시장별=상권별, 롱포맷: 지역/상권/층=행, 분기=열).

수정 이력(2026-07):
 #1 파싱 — 파일별 실제 층 라벨. #2 상권 최근접 폴백(1.5km). #4 깊은지하 감쇠. #5 소규모 3층+ 감쇠.
 #6 보증금 = 월세×12.5(크롤 실측 중앙; 전월세전환율과 별개 개념).
 층별 호가보정(FLOOR_ADJ) — 강남 크롤 P75에 정렬(레벨만).
 서울확장(2026-07-27): 강남 3파일 → 통계표 단일파일, BLDG_FILTER 서울 전체.
"""
import os
import re
import warnings
import pandas as pd
warnings.filterwarnings('ignore')

BASE = os.path.join(os.path.dirname(__file__), "..", "..", "data", "raw")
STAT_FILE = os.path.join(BASE, "2026년 1분기 상업용부동산 임대동향조사 통계표.xlsx")
EXCL = ['주차', '기계', '전기', '계단', '승강', '피난', '물탱', '발전', '정화', '공용', '옥탑']
M2P = 3.305785
DEPOSIT_MULT = 12.5   # #6 크롤 실측 보증금/월세 중앙(전월세전환율≠월세보증금비율)
SHEETS = {'오피스': '107', '중대형상가': '205', '소규모상가': '305'}
_FLOOR_NORM = {'6~10층': '6-10층', '11층 이상': '11층이상', '6층 이상': '6층이상'}   # 파일 라벨 → 표준
SEOUL_AVG = '계'      # 지역2='계' = 서울 전체 평균(상권 미매칭 폴백)


def _load(sheet):
    """서울 상권별 최신분기 층별 임대료(천원/㎡). {상권: {층라벨: rate}} (+ '계'=서울평균)."""
    d = pd.read_excel(STAT_FILE, sheet_name=sheet, header=None, skiprows=3)
    last = d.shape[1] - 1   # 마지막 열 = 최신분기(2026.1Q)
    out = {}
    for _, r in d.iterrows():
        if str(r[0]) != '서울' or '임대료' not in str(r[3]):
            continue
        sg = str(r[1]).strip()
        if '소계' in sg or '합계' in sg or sg == 'nan':
            continue
        fl = _FLOOR_NORM.get(str(r[2]).strip(), str(r[2]).strip())
        try:
            v = float(r[last])
        except (TypeError, ValueError):
            continue
        if v == v and v > 0:
            out.setdefault(sg, {})[fl] = v
    return out


TBL = {s: _load(sheet) for s, sheet in SHEETS.items()}


def rate_for(series, sang):
    """(요율dict, mapped) — 상권 요율 있으면 그것, 없으면 서울 평균('계') 폴백."""
    t = TBL[series]
    if sang and sang in t:
        return t[sang], True
    return t.get(SEOUL_AVG), False


def signed_floor(fl):
    """'15층'→15, '지하3층'→-3, 'B1'→-1. 파싱 불가 시 None."""
    fl = str(fl)
    if '지하' in fl or fl.strip().upper().startswith('B'):
        n = re.sub(r'\D', '', fl)
        return -int(n) if n else -1
    n = re.sub(r'\D', '', fl)
    return int(n) if n else None


def pick_rate(series, fl, rate):
    """서명층수 → 요율(천원/㎡). 파일별 버킷 + 깊은지하(#4)·소규모3층+(#5) 감쇠."""
    n = signed_floor(fl)
    if n is None:
        return None
    if n < 0:  # 지하: 공공은 지하1층만 → 지하2 이하 감쇠
        base_r = rate.get('지하1층')
        if base_r and n <= -2:
            base_r = base_r * (0.85 ** (abs(n) - 1))  # ponytail: 감쇠 휴리스틱
        return base_r
    if series == '오피스':
        if n == 1:
            return rate.get('1층')
        if 2 <= n <= 5:
            return rate.get(f'{n}층')
        if 6 <= n <= 10:
            return rate.get('6-10층')
        return rate.get('11층이상') or rate.get('6-10층')
    if series == '중대형상가':
        return rate.get(f'{n}층') if 1 <= n <= 5 else rate.get('6층이상')
    # 소규모상가: 지하1/1/2층만
    if n == 1:
        return rate.get('1층')
    if n == 2:
        return rate.get('2층')
    r2 = rate.get('2층')
    return r2 * (0.9 ** (n - 2)) if r2 else None  # ponytail: 3층+ 감쇠


# 층별 호가 보정: 공공요율(실계약)을 시장 호가(빌딩샵/네이버)에 정렬. 강남 크롤 P75 기준(레벨만 이동).
# ⚠ 강남 크롤로 보정 → 서울 전역 적용은 근사. 서울 각지 크롤/실측 확보 시 재보정. 11F+·지하 표본 얇음.
FLOOR_ADJ = {'지하': 1.15, '1': 1.11, '2': 0.94, '3': 1.04, '4-5': 1.16, '6-10': 1.15, '11+': 1.52}


def market_adj(fl):
    """층 → 호가 보정계수."""
    n = signed_floor(fl)
    if n is None or n == 0:
        return 1.0
    if n < 0:
        return FLOOR_ADJ['지하']
    if n <= 3:
        return FLOOR_ADJ[str(n)]
    if n <= 5:
        return FLOOR_ADJ['4-5']
    if n <= 10:
        return FLOOR_ADJ['6-10']
    return FLOOR_ADJ['11+']


def pick_series(total_area, land_use, off_area, tot_area):
    if total_area and total_area < 330:
        return '소규모상가'
    if land_use == '업무용' or (tot_area > 0 and off_area > tot_area * 0.4):
        return '오피스'
    return '중대형상가'


# #2 상권 최근접 폴백: ST_Contains 실패 시 1.5km내 최근접 상권 상속
SANG_SQL = """COALESCE(
  (SELECT nm FROM master.sanggwon sg WHERE ST_Contains(sg.geom, b.geom) LIMIT 1),
  (SELECT nm FROM master.sanggwon sg
     WHERE ST_DWithin(sg.geom::geography, b.geom::geography, 1500)
     ORDER BY sg.geom::geography <-> b.geom::geography LIMIT 1))"""
# 서울 전체(sido 11). 상업/업무/주상 계열만.
BLDG_FILTER = "b.bjd_code LIKE '11%' AND b.land_use IN ('상업용','업무용','상업기타','주상용','주상기타')"
