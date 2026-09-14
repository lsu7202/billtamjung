# -*- coding: utf-8 -*-
"""그림 | 진행 현황. 로드맵에서 기획·베타테스트 두 구간만 떼어 쓴다."""
import io, _roadmap as R
PH  = R.PHASES[:2]
DET = R.DETAILS_FIXED[:2]
W   = R.WEIGHT[:2]
io.open("_chart_status.svg","w",encoding="utf-8").write(
    R.build(DET, phases=PH, weights=W, now=1, off=0))
print("wrote _chart_status.svg")
