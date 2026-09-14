#!/usr/bin/env python3
"""브리핑 자료 목업/템플릿 생성 (python-pptx). 601-5 데이터, 빌탐정 스타일.
실제 보고서 생성(R 구현)의 템플릿 골격으로 재사용."""
from pptx import Presentation
from pptx.util import Inches as I, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

AC=RGBColor(0x1E,0x5A,0xF0); INK=RGBColor(0x0F,0x1A,0x2E); SUB=RGBColor(0x3A,0x46,0x57)  # 디자인토큰 정렬 2026-07-21
LINE=RGBColor(0xE3,0xE8,0xF0); PH=RGBColor(0xE9,0xEE,0xF3); CARD=RGBColor(0xF5,0xF8,0xFC)
WHITE=RGBColor(0xFF,0xFF,0xFF); GREEN=RGBColor(0x12,0x80,0x5C); RED=RGBColor(0xDC,0x2F,0x30)

p=Presentation(); p.slide_width=I(13.333); p.slide_height=I(7.5)
BLANK=p.slide_layouts[6]
W=13.333

def slide(): return p.slides.add_slide(BLANK)
def rect(s,l,t,w,h,fill,ln=None,lw=0.75):
    sh=s.shapes.add_shape(1,I(l),I(t),I(w),I(h))
    sh.fill.solid(); sh.fill.fore_color.rgb=fill
    if ln is None: sh.line.fill.background()
    else: sh.line.color.rgb=ln; sh.line.width=Pt(lw)
    sh.shadow.inherit=False; return sh
def txt(s,l,t,w,h,runs,size=13,bold=False,color=INK,align=PP_ALIGN.LEFT,anchor=MSO_ANCHOR.TOP):
    tb=s.shapes.add_textbox(I(l),I(t),I(w),I(h)); tf=tb.text_frame; tf.word_wrap=True
    tf.vertical_anchor=anchor; tf.margin_left=0; tf.margin_right=0; tf.margin_top=0; tf.margin_bottom=0
    if isinstance(runs,str): runs=[(runs,size,bold,color)]
    para=tf.paragraphs[0]; para.alignment=align
    for i,(t_,sz,bd,cl) in enumerate(runs):
        r=para.add_run(); r.text=t_; r.font.size=Pt(sz); r.font.bold=bd; r.font.color.rgb=cl
        r.font.name='Malgun Gothic'
    return tb
def band(s,no,label):
    rect(s,0,0,W,0.62,WHITE)
    txt(s,0.55,0.16,6,0.3,[("빌탐정 ",13,True,INK),("· 신뢰할 수 있는 부동산 파트너",9.5,False,SUB)])
    txt(s,W-4.55,0.18,4,0.3,f"{no} · {label}",9.5,False,SUB,PP_ALIGN.RIGHT)
    rect(s,0,0.62,W,0.012,LINE)
def foot(s):
    rect(s,0,7.06,W,0.012,LINE)
    txt(s,0.55,7.14,5,0.25,"빌탐정 · BILLTAMJUNG",9,False,RGBColor(0x9A,0xA3,0xAD))
    txt(s,W-6.55,7.14,6,0.25,"본 자료의 무단복제·유포·변경을 금합니다.",9,False,RGBColor(0xB3,0xBA,0xC2),PP_ALIGN.RIGHT)
def head(s,no,title):
    txt(s,0.55,0.95,8,0.3,no,12,True,AC)
    txt(s,0.55,1.28,10,0.5,title,22,True,INK)
def phbox(s,l,t,w,h,label):
    rect(s,l,t,w,h,PH,LINE); txt(s,l,t+h/2-0.15,w,0.3,label,12,False,RGBColor(0xA6,0xB0,0xBB),PP_ALIGN.CENTER)

# ── 1 표지 ──
s=slide(); rect(s,0,0,W,7.5,WHITE)
rect(s,0.85,2.05,2.0,0.44,RGBColor(0xEA,0xF0,0xFC))
txt(s,0.95,2.14,2,0.3,"빌탐정 브리핑 자료",11,True,AC)
txt(s,0.82,2.65,10,1.1,"역삼동 601-5",40,True,INK)
txt(s,0.85,3.75,10,0.4,"신논현역 도보 1분 · 근린생활시설 빌딩",16,False,SUB)
txt(s,0.85,4.7,10,0.9,[("탐정공인중개사사무소 · 담당 ",13,False,RGBColor(0x42,0x50,0x5F)),("이승욱\n",13,True,INK),("010-****-1234 · coms1768@gmail.com",13,False,RGBColor(0x42,0x50,0x5F))])
foot(s); txt(s,W-6.55,7.14,6,0.25,"Report No. BT-2026-000118 · 2026.07.18",9,False,RGBColor(0xB3,0xBA,0xC2),PP_ALIGN.RIGHT)

# ── 2 매물 기본정보 ──
s=slide(); band(s,"01","매물 기본정보"); head(s,"01 매물 기본정보","매물 기본정보")
rows=[("매매가","100억 원"),("대지면적","71.9평 (237.8㎡)"),("연면적","143평 · 건축 37.8평"),
("용도지역","제3종일반주거"),("건축물용도","제2종근린생활시설"),("규모","지하 1층 / 지상 3층"),
("사용승인","1995.11.13"),("건폐율 / 용적률","52.5% / 149%"),("주차 / 승강기","4대 / 0대"),("총보증금 / 총월세","7억 / 2,250만")]
tb=s.shapes.add_table(len(rows),2,I(0.55),I(1.95),I(6.0),I(4.6)).table
tb.columns[0].width=I(2.3); tb.columns[1].width=I(3.7)
for i,(k,v) in enumerate(rows):
    tb.rows[i].height=I(0.46)
    for j,val in enumerate((k,v)):
        c=tb.cell(i,j); c.margin_left=I(0.1); c.margin_top=I(0.03); c.margin_bottom=I(0.03)
        c.fill.solid(); c.fill.fore_color.rgb=RGBColor(0xFA,0xFB,0xFC) if j==0 else WHITE
        pr=c.text_frame.paragraphs[0]; pr.alignment=PP_ALIGN.LEFT if j==0 else PP_ALIGN.RIGHT
        r=pr.add_run(); r.text=val; r.font.size=Pt(12); r.font.bold=(j==1); r.font.name='Malgun Gothic'
        r.font.color.rgb=SUB if j==0 else INK
phbox(s,6.85,1.95,5.9,3.0,"건물 사진")
cards=[("초역세권","신논현역 1분"),("수익률","3.2% / 2.1%"),("평단가(대지)","1.39억"),("유동인구","높음")]
for i,(k,v) in enumerate(cards):
    l=6.85+(i%2)*3.05; t=5.1+(i//2)*0.78
    rect(s,l,t,2.85,0.66,CARD,RGBColor(0xEE,0xF1,0xF6))
    txt(s,l+0.18,t+0.1,2.5,0.25,k,10.5,False,SUB); txt(s,l+0.18,t+0.33,2.5,0.3,v,13,True,INK)
foot(s)

# ── 3 위치·교통 ──
s=slide(); band(s,"02","위치 · 교통"); head(s,"02 위치 · 교통","위치 및 교통")
phbox(s,0.55,1.95,6.8,4.6,"네이버 지도 — 본매물 위치")
trans=[("신분당",RGBColor(0xD3,0x11,0x45),"신논현역","77m · 1분"),("9호선",RGBColor(0xBF,0x8B,0x30),"신논현역","77m · 1분"),
("2호선",RGBColor(0x22,0xB1,0x4C),"강남역","738m · 9분"),("버스",SUB,"신논현역4번출구","27m · 1분"),("버스",SUB,"교보타워앞","159m · 2분")]
for i,(ln,cl,nm,dist) in enumerate(trans):
    t=2.1+i*0.62; rect(s,7.6,t,0.72,0.34,cl); txt(s,7.6,t+0.05,0.72,0.25,ln,9,True,WHITE,PP_ALIGN.CENTER)
    txt(s,8.45,t+0.03,2.6,0.3,nm,12.5,False,INK); txt(s,10.6,t+0.03,2.1,0.3,dist,12,True,INK,PP_ALIGN.RIGHT)
    rect(s,7.6,t+0.44,5.1,0.008,LINE)
foot(s)

# ── 4 로드뷰 ──
s=slide(); band(s,"03","전경"); head(s,"03 전경","로드뷰 · 건물 전경")
phbox(s,0.55,1.95,12.2,4.6,"네이버 로드뷰(거리뷰)")
foot(s)

# ── 5 임대 내역 ──
s=slide(); band(s,"04","임대 내역"); head(s,"04 임대 내역","층별 임대 내역")
hdr=["층","호실","계약면적","보증금","월임대료","월관리비","상태"]
data=[["3층","301호","62평","2억","600만","80만","임대중"],["2층","201호","67평","2억","650만","85만","임대중"],
["1층","101호","65평","3억","1,000만","100만","임대중"],["지하1층","B101호","65평","0","0","0","공실"],
["합계","","","7억","2,250만","265만",""]]
tb=s.shapes.add_table(len(data)+1,len(hdr),I(0.55),I(1.95),I(12.2),I(3.4)).table
for j,h in enumerate(hdr):
    c=tb.cell(0,j); c.fill.solid(); c.fill.fore_color.rgb=RGBColor(0xFA,0xFB,0xFC)
    pr=c.text_frame.paragraphs[0]; pr.alignment=PP_ALIGN.CENTER; r=pr.add_run(); r.text=h; r.font.size=Pt(12); r.font.bold=True; r.font.color.rgb=SUB; r.font.name='Malgun Gothic'
for i,row in enumerate(data,1):
    tot=(row[0]=="합계")
    for j,val in enumerate(row):
        c=tb.cell(i,j); c.fill.solid(); c.fill.fore_color.rgb=CARD if tot else WHITE
        pr=c.text_frame.paragraphs[0]; pr.alignment=PP_ALIGN.CENTER
        r=pr.add_run(); r.text=val; r.font.size=Pt(12); r.font.bold=(tot or j==0); r.font.name='Malgun Gothic'
        r.font.color.rgb=(GREEN if val=="임대중" else RED if val=="공실" else INK)
txt(s,0.55,5.5,10,0.3,"※ 임대 내역은 임대인 진술 기준 · 월임대료 부가세 별도",11,False,SUB); foot(s)

# ── 6 사진 ──
s=slide(); band(s,"05","사진"); head(s,"05 사진","건물 · 내부 사진")
for i,lab in enumerate(["외관","1층 상가","내부"]):
    phbox(s,0.55+i*4.12,1.95,3.9,4.4,lab)
foot(s)

# ── 7 마무리 ──
s=slide(); rect(s,0,0,W,7.5,WHITE)
txt(s,0,2.9,W,0.7,[("성공적인 투자, ",30,True,INK),("빌탐정",30,True,AC),("이 함께합니다",30,True,INK)],align=PP_ALIGN.CENTER)
txt(s,0,3.9,W,0.8,[("탐정공인중개사사무소 · 담당 ",13,False,RGBColor(0x42,0x50,0x5F)),("이승욱\n",13,True,INK),("010-****-1234 · coms1768@gmail.com",13,False,RGBColor(0x42,0x50,0x5F))],align=PP_ALIGN.CENTER)
foot(s); txt(s,W-6.55,7.14,6,0.25,"Report No. BT-2026-000118",9,False,RGBColor(0xB3,0xBA,0xC2),PP_ALIGN.RIGHT)

p.save("specs/02-screens/_mockups/브리핑.pptx")
print("saved 브리핑.pptx ·", len(p.slides.__iter__.__self__._sldIdLst), "slides")
