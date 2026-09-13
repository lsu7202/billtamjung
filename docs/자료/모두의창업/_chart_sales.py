# -*- coding: utf-8 -*-
"""그림 | 시점별 매출 계획. 로드맵 위에 매출 추세를 얹는다.
아래 칸 내용과 구간 폭은 로드맵(그림 4)과 같다."""
import io, _roadmap as R

# 매출은 출시 시점부터 발생한다. 베타 구간은 0으로 눕는다
CURVE = [(1.05,     0, "",           ""),
         (1.55,     0, "0원",        "베타 · 무료"),
         (2.02,     0, "",           ""),
         (2.25,    90, "90만원",     "30명"),
         (2.90,   300, "300만원",    "100명"),
         (3.45,  1500, "1,500만원",  "300명"),
         (4.55, 25000, "25,000만원", "5,000명")]

io.open("_chart_sales.svg","w",encoding="utf-8").write(
    R.build(R.DETAILS_FIXED, curve=CURVE, ylabel="월 매출", rise=True))
print("wrote _chart_sales.svg")
