# -*- coding: utf-8 -*-
"""그림 | 수익 구조의 차별점 (대조도). 위=지금, 아래=빌탐정."""
import io
W=960
LX, CX, RM = 3, 96, 5               # 라벨 칸, 카드 칸, 오른쪽 여백
CW = W-CX-RM
s=[f'<svg width="{W}" height="352" viewBox="0 0 {W} 352" xmlns="http://www.w3.org/2000/svg" '
   'font-family="Apple SD Gothic Neo, sans-serif">',
   f'<rect width="{W}" height="352" fill="#ffffff"/>']

def pill(x,y,w,h,fill,txt,tc):
    s.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{h/2}" fill="{fill}"/>')
    s.append(f'<text x="{x+w/2}" y="{y+h/2+6}" font-size="15" fill="{tc}" text-anchor="middle" font-weight="700">{txt}</text>')

# ── 위: 지금 ──────────────────────────────────────────
pill(LX,44,84,30,"#8A94A6","지금","#ffffff")
names=["업무 관리 프로그램","데이터 조회","ChatGPT"]
cw=(CW-60)/3
for i,n in enumerate(names):
    x=CX+i*(cw+30)
    s.append(f'<rect x="{x:.1f}" y="30" width="{cw:.1f}" height="98" rx="8" fill="#F2F4F7" stroke="#C6CCD6" stroke-width="1.4"/>')
    s.append(f'<text x="{x+cw/2:.1f}" y="66" font-size="16" fill="#49546B" text-anchor="middle" font-weight="700">{n}</text>')
    s.append(f'<rect x="{x+cw/2-56:.1f}" y="82" width="112" height="28" rx="14" fill="#E1E5EB"/>')
    s.append(f'<text x="{x+cw/2:.1f}" y="101" font-size="13.5" fill="#6B7688" text-anchor="middle" font-weight="700">별도 결제</text>')
s.append(f'<text x="{CX}" y="156" font-size="14.5" fill="#6B7688">기능마다 따로 결제함. AI 구독은 그 위에 또 붙음.</text>')

s.append('<line x1="0" y1="180" x2="960" y2="180" stroke="#DCE4F0" stroke-width="1.4"/>')

# ── 아래: 빌탐정 ──────────────────────────────────────
pill(LX,222,84,30,"#243B5E","빌탐정","#ffffff")
s.append(f'<rect x="{CX}" y="208" width="{CW}" height="98" rx="8" fill="#EEF2F8" stroke="#243B5E" stroke-width="2.2"/>')
chips=["업무 관리","데이터 조회","AI"]
chw, gap = 168, 38
sx = CX+34
for i,c in enumerate(chips):
    x=sx+i*(chw+gap)
    s.append(f'<rect x="{x}" y="240" width="{chw}" height="36" rx="6" fill="#243B5E"/>')
    s.append(f'<text x="{x+chw/2}" y="264" font-size="15.5" fill="#ffffff" text-anchor="middle" font-weight="700">{c}</text>')
    if i<2:
        s.append(f'<text x="{x+chw+gap/2}" y="266" font-size="20" fill="#2C4A78" text-anchor="middle" font-weight="700">+</text>')
bx=sx+3*(chw+gap)+6
s.append(f'<rect x="{bx}" y="238" width="152" height="40" rx="20" fill="#E8873A"/>')
s.append(f'<text x="{bx+76}" y="264" font-size="15.5" fill="#ffffff" text-anchor="middle" font-weight="700">구독 하나</text>')
s.append(f'<text x="{CX}" y="334" font-size="14.5" fill="#1F3864" font-weight="700">AI를 따로 결제하지 않음. 구독 하나로 통합하므로 단일 기능 서비스보다 높은 가격을 받을 근거가 됨.</text>')
s.append('</svg>')
io.open("_chart_rev.svg","w",encoding="utf-8").write("\n".join(s))
print("wrote _chart_rev.svg")
