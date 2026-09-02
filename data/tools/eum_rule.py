#!/usr/bin/env python3
"""토지이음 법정 건폐율·용적률 산식 (2026-09-02 · eum.go.kr 원본 그대로 옮김).

## 왜 옮겨 적나

법정 건폐/용적은 **토지이음 화면과 한 글자도 다르면 안 된다.** 중개인이 확인설명서를
쓸 때 토지이음을 열어 놓고 대조하기 때문이다. 값이 다르면 우리가 틀린 것으로 보인다.

그래서 **산식을 새로 만들지 않고 그쪽 것을 그대로 옮긴다.** 출처는 그쪽이 브라우저에
내려보내는 계산 스크립트다:

    https://www.eum.go.kr/web/js/ar/lu/luLandDetUse.js   (첫 줄: "건폐율 + 용적률 계산 js")

값은 서버가 안 준다. 서버는 빈 틀(0㎡)만 보내고 브라우저가 채운다. 면적은 별도 요청
`eum.ne.kr:9003/MapPlan?req=analysis&pnus=…` 이 주는 **필지 ∩ 용도지역 교차면적**이다.
우리는 같은 폴리곤(연속지적도 · UQ111)을 갖고 있어 그 면적을 직접 낸다. 크롤은 안 한다.

## 산식 (fn_subCalArea)

    건폐 = round( Σ(조례건폐 × 교차면적) / 지적면적 )
    용적 = round( Σ(조례용적 × 교차면적) / 지적면적 )

**세 가지가 상식과 다르다. 일부러 그대로 둔다.**

① **정규화하지 않는다.** 교차면적을 지적면적으로 나눌 뿐, 합이 1이 되게 맞추지 않는다.
   예정 용도지역「(안)」처럼 같은 땅을 겹쳐 덮는 지역이 있으면 합이 2가 되고, 그러면
   조례 최대치(서울 건폐 60%)를 넘는 값이 나온다.

       강남구 삼성동 35-29 · 11.4㎡ · 제2종(60/200) + 제3종(안)(50/250) 둘 다 필지 전체
       → 건폐 (60×11.4 + 50×11.4)/11.4 = 110%  ·  용적 450%

   건폐율 110% 는 대지보다 바닥이 넓다는 뜻이라 있을 수 없는 값이다. 그래도 토지이음
   화면에 그렇게 뜨고, 우리는 **그 화면과 같아야 한다**(2026-09-02 결정).

② **면적을 소수 한 자리로 자른 뒤 곱한다**(JS `.toFixed(1)`). 반올림이 뒤집히는 자리가
   생긴다. 자르지 않으면 구로동 443-126 이 58%/204% 가 아니라 59%/205% 가 된다.

③ **분모는 지적면적**이지 교차면적의 합이 아니다. 둘은 대개 조금 다르다.

## 갈래 (fn_calArea)

    용도지역 1개                                    → 조례값 그대로
    용도지역 2개 이상
      최소 교차면적 > 330㎡
          녹지(UQA410·420·430)가 하나라도 있으면      → 병기
          최소인 것이 상업(UQA210·220·230·240)이고
              면적 ≤ 660㎡ → 용도지구 있으면 병기 / 없으면 계산
              면적 > 660㎡ → 병기
          그 밖                                     → 병기
      최소 교차면적 ≤ 330㎡
          녹지가 있는데 최소인 것이 녹지가 아니면      → 병기
          그 밖                                     → 계산

용도지구는 고도지구(UQH100·110·120)와 방화지구(UQI100) 넷뿐이다.
「병기」는 용도지역마다 제 조례값을 따로 적는 것이다(국토계획법 제84조).
"""

# 종별 용도지역 코드 (luLandDetUse.js 의 targetLocal 그대로)
TARGET_LOCAL = (
    "UQA111", "UQA112", "UQA121", "UQA122", "UQA123", "UQA130",
    "UQA210", "UQA220", "UQA230", "UQA240",
    "UQA310", "UQA320", "UQA330",
    "UQA410", "UQA420", "UQA430",
    "UQB100", "UQB200", "UQB300", "UQC001", "UQD001",
)
# 용도지구 (targetDistrict)
TARGET_DISTRICT = ("UQH100", "UQH110", "UQH120", "UQI100")
GREEN = ("UQA410", "UQA420", "UQA430")            # 녹지
COMMERCIAL = ("UQA210", "UQA220", "UQA230", "UQA240")   # 상업

# 코드 → (건폐율, 용적률) 서울시 도시계획 조례.
# 토지이음은 이 값을 서버가 그린 숨은 칸(gun_basic_·yong_basic_)에서 읽는다.
SEOUL = {
    "UQA111": (50, 100), "UQA112": (40, 120),
    "UQA121": (60, 150), "UQA122": (60, 200), "UQA123": (50, 250),
    "UQA130": (60, 400),
    "UQA210": (60, 1000), "UQA220": (60, 800), "UQA230": (60, 600), "UQA240": (60, 600),
    "UQA310": (60, 300), "UQA320": (60, 350), "UQA330": (60, 400),
    "UQA410": (20, 50), "UQA420": (20, 50), "UQA430": (20, 50),
}


def to_uqa(code):
    """공간조인이 쓰는 4자리 코드('1230') → 토지이음 코드('UQA123'). 이미 UQA 면 그대로."""
    if not code:
        return None
    c = str(code)
    if c.startswith("UQ"):
        return c
    return "UQA" + c[:3] if len(c) == 4 else None


def fixed1(x):
    """JS `(x).toFixed(1)` — 소수 한 자리 사사오입. 파이썬 round() 는 오사오입이라 못 쓴다."""
    import decimal
    return float(decimal.Decimal(repr(float(x))).quantize(
        decimal.Decimal("0.1"), rounding=decimal.ROUND_HALF_UP))


def js_round(x):
    """JS `Math.round(x)` — 양수에서 .5 는 위로. 파이썬 round() 와 다르다."""
    import math
    return math.floor(x + 0.5)


def calc(zone_codes, areas, land_area, district_codes=()):
    """토지이음 산출정보를 그대로 낸다.

    zone_codes    이 필지에 지정된 용도지역 코드들(원장 기준). 종별만.
    areas         {코드: 필지 ∩ 용도지역 교차면적(㎡)}. 없는 코드는 0 으로 본다.
    land_area     지적면적(㎡).
    district_codes 이 필지의 용도지구 코드들.

    → (건폐 문자열, 용적 문자열, 방식) · 못 내면 (None, None, 사유)
      방식: '단일' · '계산' · '병기'
    """
    # 원장은 같은 코드를 「포함」과 「저촉」 두 줄로 주기도 한다. 그대로 세면 그 지역을
    # 두 번 곱하게 된다(실측: 강북구 미아동 65-238 이 59% 대신 119%). 토지이음은 코드마다
    # 칸을 하나만 그리므로 **중복을 없앤다.** 순서는 원장 순서를 지킨다.
    zs = list(dict.fromkeys(c for c in zone_codes if c in TARGET_LOCAL))
    if not zs:
        return None, None, "용도지역없음"
    if any(c not in SEOUL for c in zs):
        return None, None, "조례값없음"          # 서울 밖 코드(관리·농림 등)

    if len(zs) == 1:
        # 한 지역이면 조례값 그대로다. 면적이 필요 없다(토지이음도 안 본다).
        b, f = SEOUL[zs[0]]
        return f"{b}%", f"{f}%", "단일"

    if not land_area or land_area <= 0:
        return None, None, "면적없음"            # 걸침은 분모가 있어야 한다

    ds = [c for c in district_codes if c in TARGET_DISTRICT]
    a = {c: fixed1(areas.get(c, 0.0)) for c in zs}
    # 최소면적은 **교차면적이 있는 지역들 중에서만** 고른다. 원장에 적혀 있어도 폴리곤이
    # 없으면 토지이음의 fn_getMinAreaData 는 그 지역을 아예 안 본다(MapPlan 응답만 훑는다).
    have = [c for c in zs if c in areas]
    if not have:
        return None, None, "교차면적없음"
    min_code = min(have, key=lambda c: (a[c], c))
    min_area = a[min_code]

    def both():
        """병기 — 용도지역마다 제 조례값을 따로 적는다."""
        bs, fs = [], []
        for c in zs:
            b, f = SEOUL[c]
            if b not in bs:
                bs.append(b)
            if f not in fs:
                fs.append(f)
        return (", ".join(f"{x}%" for x in sorted(bs)),
                ", ".join(f"{x}%" for x in sorted(fs)), "병기")

    def weighted():
        gun = sum(SEOUL[c][0] * a[c] for c in zs)
        yong = sum(SEOUL[c][1] * a[c] for c in zs)
        if gun <= 0 and yong <= 0:
            return None, None, "교차면적없음"   # 토지이음도 이때 "-" 를 낸다
        return f"{js_round(gun / land_area)}%", f"{js_round(yong / land_area)}%", "계산"

    has_green = any(c in GREEN for c in zs)
    if min_area > 330:
        if has_green:
            return both()                                    # 로직3·4
        if min_code in COMMERCIAL and min_area <= 660:
            return both() if ds else weighted()              # 로직5 · 로직6
        return both()                                        # 로직3·4
    # 330㎡ 이하
    if has_green and min_code not in GREEN:
        return both()                                        # 로직3·4
    return weighted()                                        # 로직7·8
