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
import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               "..", "..", "data", "tools"))


def _latest_stat():
    """가장 최근 분기 통계표를 고른다(2026-08-26).

    파일명을 코드에 박아 뒀더니 크롤러가 다음 분기를 받아온 순간 빌더가 죽었다 —
    「2026년 1분기 …」를 찾는데 받은 건 「26년 2분기 …(공표용)」이었다. 분기 표기가
    해마다 바뀌므로(2026년/26년, 공표용 접미사) 이름을 맞히려 하지 말고
    **파일 수정시각이 가장 새 것**을 쓴다. 받은 것을 쓰는 게 이름을 맞히는 것보다 안전하다.
    """
    import glob
    got = glob.glob(os.path.join(BASE, "*임대동향조사*.xlsx"))
    if not got:
        raise FileNotFoundError(
            f"임대동향조사 통계표가 없습니다 — {BASE} 에 받아 두세요"
            " (scripts/crawl_all.py 의 임대동향 항목)")
    return max(got, key=os.path.getmtime)


STAT_FILE = _latest_stat()
EXCL = ['주차', '기계', '전기', '계단', '승강', '피난', '물탱', '발전', '정화', '공용', '옥탑']
M2P = 3.305785
DEPOSIT_MULT = 13.0   # 크롤 실측 보증금/월세 중앙(2026-08-30 재측정 · 25.7만 매물).
                      # 12.5 는 강남 표본으로 잡은 옛 값이다. 전월세전환율≠월세보증금비율.
SHEETS = {'오피스': '107', '중대형상가': '205', '소규모상가': '305'}
CONV_SHEETS = {'오피스': '113', '중대형상가': '207', '소규모상가': '307'}   # (5) 전환율
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


def _load_conv(sheet):
    """서울 상권별 최신분기 전환율(%). {상권: rate} (+ '계'=서울평균)."""
    d = pd.read_excel(STAT_FILE, sheet_name=sheet, header=None, skiprows=3)
    last = d.shape[1] - 1
    out = {}
    for _, r in d.iterrows():
        if str(r[0]) != '서울':
            continue
        sg = str(r[1]).strip()
        if '소계' in sg or '합계' in sg or sg == 'nan':
            continue
        try:
            v = float(r[last])
        except (TypeError, ValueError):
            continue
        if v == v and v > 0:
            out[sg] = v
    return out


CONV = {s: _load_conv(sheet) for s, sheet in CONV_SHEETS.items()}


def deposit_mult(series, sang):
    """보증금 배율(월세의 몇 배) — 상권별(2026-08-26).

    예전엔 하나를 서울 전역·모든 층에 똑같이 썼다. 크롤 실측 중앙값이라 레벨은 맞지만,
    동네마다 보증금 관행이 다른 것을 통째로 뭉갠다.

    통계표의 **전환율**이 그 차이를 실측으로 준다. 전환율은 보증금 1원을 월세로 환산하는
    연이율이라, 낮은 동네일수록 같은 월세를 만드는 데 보증금이 더 든다 —
    명동 9.9% 와 남대문 12.0% 는 보증금 관행이 다른 동네라는 뜻이다.

        배율 = 13.0 × (서울평균 전환율 ÷ 이 상권 전환율)

    전월세전환율과 월세보증금비율은 다른 개념이라 절대값은 못 쓰지만,
    **상권 사이의 비**는 쓸 수 있다. 레벨은 크롤 실측(13.0)이 잡고 결이 전환율을 따른다.

    층별로는 나누지 않는다 — 통계표에 층별 전환율이 없다. 1층 상가와 사무실의 보증금
    관행이 다른 건 알지만, 근거 없이 숫자를 지어내면 그게 틀렸을 때 아무도 못 잡는다.
    """
    t = CONV.get(series) or {}
    base = t.get(SEOUL_AVG)
    r = t.get(sang) if sang else None
    if not base or not r:
        return DEPOSIT_MULT
    # 실측 밖으로 튀지 않게 가둔다 — 전환율이 극단인 상권에서 배율이 두 배가 되면 안 된다
    return max(8.0, min(20.0, DEPOSIT_MULT * base / r))


def rate_for(series, sang):
    """(요율dict, mapped) — 상권 요율 있으면 그것, 없으면 서울 평균('계') 폴백."""
    t = TBL[series]
    if sang and sang in t:
        return t[sang], True
    return t.get(SEOUL_AVG), False


def signed_floor(fl):
    """'15층'→15, '지하3층'→-3, '지3층'→-3, 'B1'→-1. 파싱 불가 시 None.

    파싱은 data/tools/floor_label 하나만 쓴다(2026-08-29). 예전엔 여기서 「지하」 두 글자만
    지하로 봤는데, 대장 원본은 「지1층」(13.9만)·「지1」(13.2만)·「지층」(10.0만)이 훨씬 많다.
    그래서 **지하 32만 층이 지상으로 뒤집혀** 읽혔고, 상가에서 가장 싼 층에 가장 비싼
    1층 요율이 붙었다. 대장 층수와 대조하니 지하층수 일치가 16.9% 였다(정규화 후 99.7%).
    옥탑은 1000+n 이라 지상 층과 안 겹친다 — 층 요율 표에는 옥탑이 없으므로 그대로 흘려보낸다."""
    from floor_label import signed
    v = signed(fl)
    return None if v is None else (v - 1000 if v >= 1000 else v)


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


# 층별 호가 보정: 공공요율(실계약)을 시장 호가에 정렬.
#
# 2026-08-28 재보정 — 네이버 임대 호가 **22.6만 매물**로 「크롤 단가 ÷ 공공요율」을 층별로 다시 쟀다.
# 예전 값은 강남 160동 P75 로 잡은 것이라 표본이 얇은 두 자리가 크게 틀려 있었다:
#     1층   1.11 → 0.77 (44% 과대)      11층+ 1.52 → 1.16 (31% 과대)
# 나머지 다섯 칸은 실측과 0.96~1.00 로 맞아 그대로 둔다(지하 1.12·2층 0.92·3층 1.04·4-5 1.12·6-10 1.11).
FLOOR_ADJ = {'지하': 1.12, '1': 0.77, '2': 0.92, '3': 1.04, '4-5': 1.12, '6-10': 1.11, '11+': 1.16}

# 임대가능면적 ÷ 연면적. 공공요율의 분모는 **계약면적**인데 우리는 대장 층별면적(=연면적)에
# 곱하고 있었다. 층 안의 코어·복도·화장실이 그 층 용도로 등재돼 EXCL 로는 안 걸러진다.
# 0.77 은 세 갈래가 같은 값을 낸다: 실거래 평당가 ÷ 부동산원 소득수익률 역산 = 0.77,
# 크롤로 잰 총액 배율 1.28 의 역수 = 0.78, 크롤 매물의 전용/계약 면적비 중앙 = 0.85(전용 기준이라 더 큼).
EFF_RATIO = 0.77


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



# ══════════════════════════════════════════════════════════════════════════════
# v4 — 공시지가 주축(2026-08-30)
#
# ## 왜 바꿨나
# 부동산원 상권 요율은 서울을 68칸으로만 나눈다. 같은 상권 안에서 어느 자리인지를 못 본다.
# 공시지가는 **필지마다** 다르다. 구를 갈라 학습·검증한 실측:
#     ① 상권 요율만(v3)      절반이 32.9% 안 · ±20% 31.5%
#     ③ 공시지가 주축(v4)     절반이 28.2% 안 · ±20% 36.6%   ← -4.7%p
#
# ## 산식
#     층 단가(원/㎡ 임대면적/월)
#       = K × a[층대] × 공시지가^b[층대]
#         × clamp(상권요율 상대값 ÷ rmed, 0.5, 2.0) ^ KR    상권은 「이 동네 수준」만 빌린다
#         × (1 − KA) ^ min(연식/10, 4)
#         × clamp(역거리 ÷ 400, 0.5, 2.0) ^ (−KS)
#
# a·b·rmed·K 는 fit_rent_v4.py 가 한 번 굽는다(_rent_v4_coef.json).
# **예측 입력은 공시지가·상권요율·연식·역거리뿐이다** — 크롤은 계수를 굽는 자리에만 있고
# 산식의 입력이 아니다(FLOOR_ADJ 상수와 같은 성격).
#
# ## 눈금
# 크롤은 호가고 부동산원 표는 실계약이다. 크롤 중앙에 맞추면 전 서울 임대추정이 한꺼번에
# 19% 올라간다 — 호가를 계약가로 내미는 셈이다. 그래서 K 는 **v3 의 중앙값을 그대로 잇게**
# 잡았다. 흩어짐만 줄이고 레벨은 건드리지 않는다.
#
# 계수 파일이 없으면 V4 는 꺼지고 v3(상권 요율)로 돌아간다 — 조용히 틀린 값을 내지 않는다.
_V4_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_rent_v4_coef.json")
try:
    import json as _json
    with open(_V4_PATH, encoding="utf-8") as _f:
        V4 = _json.load(_f)
except (OSError, ValueError):
    V4 = None


# 지하3 이하 감쇠 — 층대 'B' 는 지하를 한 칸으로 묶는데, 깊이가 더 내려가면 실제로 싸진다.
# 크롤 잣대에 층까지 맞춰 재보니(2026-08-30):
#     지하1  n=10,084  우리÷크롤 0.95      지하2  n=752  0.99      전 층 평균 0.86
#     지하3 이하 n=133  **1.205**  ← 다른 층보다 40% 높게 서 있었다
# 보정 = 0.862 ÷ 1.205 = 0.72. 우연히 v3 의 깊이 감쇠 0.85² = 0.7225 와 거의 같다.
# 지하4·5 는 실측이 더 낮지만(0.54·0.63) 표본이 110·23건뿐이라 더 쪼개지 않는다 —
# 근거 없이 칸을 늘리면 그게 틀렸을 때 아무도 못 잡는다.
DEEP_B = 0.72


def v4_unit(gongsi, floor_label, series, sang, approval_ymd, station_dist):
    """공시지가 주축 층 단가(원/㎡ 임대면적/월). 재료가 모자라면 None → 부르는 쪽이 v3 로 간다."""
    if not V4 or not gongsi or gongsi <= 0:
        return None
    n = signed_floor(floor_label)
    if n is None or n == 0:
        return None
    b = ("B" if n < 0 else str(n) if n <= 3 else "4-5" if n <= 5 else "6-10" if n <= 10 else "11+")
    a, e = V4["co"].get(b) or V4["co"]["_"]
    p = a * gongsi ** e
    if n <= -3:
        p *= DEEP_B      # 지하3 이하 — 층대 'B' 한 칸으로는 깊이를 못 본다(아래 상수 참고)
    r = _rate_rel(series, sang, floor_label)
    if r:
        p *= max(0.5, min(2.0, r / V4["rmed"])) ** V4["KR"]
    y = str(approval_ymd or "")[:4]
    if y.isdigit():
        p *= (1.0 - V4["KA"]) ** min((2026 - int(y)) / 10, 4)
    if station_dist is not None:
        p *= max(0.5, min(2.0, float(station_dist) / 400.0)) ** (-V4["KS"])
    return p * V4["K"]


def _rate_rel(series, sang, floor_label):
    """이 건물의 상권 요율 ÷ 서울평균 요율(같은 층). 상권 수준만 뽑아 쓴다."""
    t = TBL.get(series) or {}
    a, b = t.get(sang or ""), t.get(SEOUL_AVG)
    if not a or not b:
        return None
    ra, rb = pick_rate(series, floor_label, a), pick_rate(series, floor_label, b)
    return (ra / rb) if (ra and rb and rb > 0) else None


# 주야비(낮÷밤) — **임대 추정에는 쓰지 않는다**(2026-08-27 크롤 검증으로 기각).
#
# 실거래 평당가로 재면 좋아 보였다: 상권 요율만 0.4595 → 주야비 0.5739(+11.5p, 스피어만).
# 그래서 넣었는데, 강남 크롤 **임대 호가 160동**에 금액을 직접 대 보니 개선이 없었다:
#
#   요율만            중앙비율 1.13 · MdAPE 24.6% · ±20% 42%
#   주야비 ^0.2       1.15 · 25.2% · 40%
#   주야비 ^0.3       1.14 · 24.8% · 38%
#   주야비 ^0.5       1.15 · 27.7% · 38%   ← 어떤 강도로도 못 줄인다
#   (정규화 없이 날것 곱: 1.54 · 55% — 상권 레벨을 두 번 세서 눈금이 깨진다)
#
# 두 잣대가 어긋난 이유는 **재는 대상이 다르기 때문**이다. 주야비는 「이 자리가 얼마나
# 상업지인가」를 재고, 그건 **매매가**에 실리는 값이다(입지 프리미엄·미래가치).
# 임대료는 지금 받는 돈이라 그만큼 안 실린다. 임대료의 직접 잣대는 호가이므로 호가를 따른다.
#
# 함수는 남긴다 — 매매가 추정(F-17) 쪽에서 재볼 값이다. 임대 빌더는 부르지 않는다.
def pop_adj(day, night):
    """낮/밤 생활인구 → 임대료 보정계수. 값이 없으면 1.0(안 건드린다)."""
    if not day or not night or night <= 0:
        return 1.0
    return min(POP_HI, max(POP_LO, day / night)) ** POP_PW


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
# 임대추정 대상 = 토지이용(상업 SECT) ∪ 건물주용도(근생·판매·업무·숙박·문화·의료·운동·위락).
# land_use 오분류(예: 근생 상가인데 '주거기타')를 main_use로 보완 — build_sale_est COMM_SQL과 동일 정의.
BLDG_FILTER = ("b.bjd_code LIKE '11%' AND (b.land_use IN ('상업용','업무용','상업기타','주상용','주상기타') "
               "OR substr(b.main_use,1,2) IN ('03','04','05','07','09','13','14','15','16'))")
