# -*- coding: utf-8 -*-
"""그림 | 팀 구성. 대표 카드와 협력 기관 카드를 나란히 둔다."""
import io
W = 960
NAVY, SOFT, LINE, GREY = "#243B5E", "#EEF2F8", "#C3CEE0", "#5B6B84"
GAP, CW = 64, 448
HB = 46                                     # 머리띠 높이

LEFT = ("이승욱", "대표 · 개발", True, [
    ("학력", ["경기대학교 수원캠퍼스 컴퓨터공학전공 4학년 재학"]),
    ("수상", ["교내 기초 캡스톤디자인 경진대회 우수상",
              "교내 심화 캡스톤디자인 경진대회 우수상"]),
])
RIGHT = ("The 두꺼비부동산중개사무소", "협력 기관", False, [
    ("담당", ["이사 김정돈"]),
    ("협력 내용", ["도메인 지식 및 데이터 제공", "마케팅 담당"]),
])

def body_h(rows):
    return sum(len(l)*22 + 8 for _,l in rows) + 14

H = HB + max(body_h(LEFT[3]), body_h(RIGHT[3])) + 16
s=[f'<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" '
   'font-family="Apple SD Gothic Neo, sans-serif">',
   f'<rect width="{W}" height="{H}" fill="#ffffff"/>']

def card(x, title, sub, dark, rows):
    ch = H-16
    s.append(f'<rect x="{x}" y="8" width="{CW}" height="{ch}" rx="8" fill="{SOFT}" '
             f'stroke="{NAVY if dark else LINE}" stroke-width="{2.2 if dark else 1.6}"/>')
    s.append(f'<path d="M{x+1},16 a7,7 0 0 1 7,-7 h{CW-16} a7,7 0 0 1 7,7 v{HB-8} H{x+1} z" '
             f'fill="{NAVY if dark else "#7E93B5"}"/>')
    s.append(f'<text x="{x+20}" y="38" font-size="17" fill="#ffffff" font-weight="700">{title}</text>')
    s.append(f'<text x="{x+CW-20}" y="38" font-size="14" fill="#DCE4F0" text-anchor="end">{sub}</text>')
    y = HB + 34
    for label, lines in rows:
        s.append(f'<text x="{x+20}" y="{y}" font-size="14" fill="{GREY}" font-weight="700">{label}</text>')
        for ln in lines:
            s.append(f'<rect x="{x+108}" y="{y-9}" width="4" height="4" fill="#7E93B5"/>')
            s.append(f'<text x="{x+118}" y="{y}" font-size="14.5" fill="#1a1a1a">{ln}</text>')
            y += 22
        y += 8

card(0, *LEFT)
card(CW+GAP, *RIGHT)
cy = H/2
s.append(f'<line x1="{CW}" y1="{cy}" x2="{CW+GAP}" y2="{cy}" stroke="{NAVY}" stroke-width="2.4"/>')
s.append(f'<rect x="{CW+14}" y="{cy-13}" width="36" height="26" rx="13" fill="#ffffff" stroke="{NAVY}" stroke-width="1.6"/>')
s.append(f'<text x="{CW+GAP/2}" y="{cy+5}" font-size="13.5" fill="{NAVY}" text-anchor="middle" font-weight="700">협력</text>')
s.append('</svg>')
io.open("_chart_team.svg","w",encoding="utf-8").write("\n".join(s))
print("wrote _chart_team.svg")
