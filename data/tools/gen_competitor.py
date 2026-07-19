#!/usr/bin/env python3
"""경쟁사 심층 분석 PPT (부기사·디스코·건물닷컴) — 실행화면 캡처 임베드.
객관적 분석(빌탐정 우위 프레이밍 배제)."""
from pptx import Presentation
from pptx.util import Inches as I, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from PIL import Image

SHOTS="/private/tmp/claude-501/-Users-iseung-ug-Desktop---------/ddcd61b1-bac0-48e0-b3bb-bca11bf8983c/scratchpad/shots/"
AC=RGBColor(0x1A,0x4F,0xC0); INK=RGBColor(0x1C,0x24,0x30); SUB=RGBColor(0x5A,0x65,0x72)
LINE=RGBColor(0xE6,0xEA,0xEF); CARD=RGBColor(0xF5,0xF8,0xFC); WHITE=RGBColor(0xFF,0xFF,0xFF)
GREEN=RGBColor(0x2A,0x7D,0x46); AMBER=RGBColor(0xC8,0x78,0x1A)
p=Presentation(); p.slide_width=I(13.333); p.slide_height=I(7.5); W=13.333
BLANK=p.slide_layouts[6]
def slide(): return p.slides.add_slide(BLANK)
def rect(s,l,t,w,h,fill,ln=None):
    sh=s.shapes.add_shape(1,I(l),I(t),I(w),I(h)); sh.fill.solid(); sh.fill.fore_color.rgb=fill
    sh.line.color.rgb=ln if ln else fill; sh.line.width=Pt(0.75 if ln else 0); sh.shadow.inherit=False
    if not ln: sh.line.fill.background()
    return sh
def txt(s,l,t,w,h,runs,size=13,bold=False,color=INK,align=PP_ALIGN.LEFT,anchor=MSO_ANCHOR.TOP,sp=None):
    tb=s.shapes.add_textbox(I(l),I(t),I(w),I(h)); tf=tb.text_frame; tf.word_wrap=True
    tf.vertical_anchor=anchor
    for m in ('margin_left','margin_right','margin_top','margin_bottom'): setattr(tf,m,0)
    if isinstance(runs,str): runs=[[(runs,size,bold,color)]]
    if runs and isinstance(runs[0],tuple): runs=[runs]
    for i,para in enumerate(runs):
        pa=tf.paragraphs[0] if i==0 else tf.add_paragraph(); pa.alignment=align
        if sp: pa.space_after=Pt(sp)
        for (t_,sz,bd,cl) in para:
            r=pa.add_run(); r.text=t_; r.font.size=Pt(sz); r.font.bold=bd; r.font.color.rgb=cl; r.font.name='Malgun Gothic'
    return tb
def pic(s,path,l,t,boxw,boxh):
    im=Image.open(path); iw,ih=im.size; ar=iw/ih
    w,h=boxw,boxw/ar
    if h>boxh: h=boxh; w=boxh*ar
    x=l+(boxw-w)/2
    pc=s.shapes.add_picture(path,I(x),I(t),I(w),I(h))
    pc.line.color.rgb=LINE; pc.line.width=Pt(0.75)   # 이미지 자체에 테두리
def band(s,no,label):
    rect(s,0,0,W,0.6,RGBColor(0x12,0x2A,0x5C)); txt(s,0.5,0.15,8,0.3,[("빌탐정 · 경쟁사 분석",12,True,WHITE)])
    txt(s,W-4.5,0.17,4,0.3,f"{no} · {label}",10,False,RGBColor(0xB8,0xC4,0xDE),PP_ALIGN.RIGHT)
def foot(s,n): txt(s,W-2.0,7.12,1.6,0.25,f"{n}",9,False,RGBColor(0xAA,0xB2,0xBC),PP_ALIGN.RIGHT)
def bullets(s,l,t,w,items,size=12,gap=5):
    runs=[[("• ",size,True,AC),(a,size,b,INK)]+([(" — "+c,size-1,False,SUB)] if c else []) for (a,b,c) in items]
    txt(s,l,t,w,5,runs,size,sp=gap)

# ── 1 표지 ──
s=slide(); rect(s,0,0,W,7.5,RGBColor(0x12,0x2A,0x5C))
txt(s,0.9,2.5,11,0.5,"경쟁사 심층 분석",34,True,WHITE)
txt(s,0.92,3.4,11,0.5,[("부기사",22,True,RGBColor(0x8F,0xB0,0xFF)),("  ·  ",22,True,WHITE),("디스코",22,True,RGBColor(0x8F,0xB0,0xFF)),("  ·  ",22,True,WHITE),("건물닷컴",22,True,RGBColor(0x8F,0xB0,0xFF))])
txt(s,0.92,4.3,11,0.4,"핵심 기능 · 실제 동작 · 실행화면 기준 객관 분석",14,False,RGBColor(0xC8,0xD4,0xEE))
txt(s,0.92,6.6,11,0.3,"빌탐정 사업계획 자료 · 2026.07",11,False,RGBColor(0x9A,0xA8,0xC8))

# ── 2 분석 개요 ──
s=slide(); band(s,"00","분석 개요"); txt(s,0.5,0.85,10,0.3,"00 분석 개요",12,True,AC); txt(s,0.5,1.18,11,0.5,"세 서비스는 서로 다른 축에 서 있다",22,True,INK)
cols=[("부기사","중개 운영관리","매물·고객·직원·수수료 CRM + 마케팅 발송. 상업 빌딩 특화(부기맨).",RGBColor(0x2E,0x6F,0xED)),
      ("디스코","데이터 조회","지도 기반 실거래가·대장·공시·등기·경매 조회 + 경량 매물등록.",RGBColor(0x2A,0x7D,0x46)),
      ("건물닷컴","가치평가 + 실매물","3기준 자동 가격평가 + 컨설팅형 클리닉 + 수익형 실매물.",RGBColor(0xC8,0x78,0x1A))]
for i,(nm,pos,desc,cl) in enumerate(cols):
    l=0.5+i*4.15; rect(s,l,2.0,3.9,3.6,CARD,LINE); rect(s,l,2.0,3.9,0.12,cl)
    txt(s,l+0.28,2.35,3.4,0.4,nm,18,True,INK); txt(s,l+0.28,2.85,3.4,0.3,pos,13,True,cl)
    txt(s,l+0.28,3.35,3.35,2,desc,12,False,SUB)
txt(s,0.5,5.9,12.3,0.9,[[("관점: ",12,True,INK),("각 서비스를 '더 좋다/나쁘다'가 아니라 하나의 주체로 — 어떤 기능을 제공하고, 그 기능이 실제로 어떻게 동작하는지를 실행화면으로 확인.",12,False,SUB)]]); foot(s,2)

# ── 3 부기사 ──
s=slide(); band(s,"01","부기사"); txt(s,0.5,0.8,8,0.3,"01 부기사 (Bugisa / 부기맨)",12,True,AC); txt(s,0.5,1.13,7,0.4,"중개 운영 올인원 — CRM 중심",20,True,INK)
bullets(s,0.5,1.85,6.6,[
 ("매물 자동입력",True,"주소→건축물·토지대장·실거래가 자동"),
 ("고객 CRM",True,"조건 저장→매칭 매물 자동 알림·TM관리"),
 ("직원 관리",True,"활동 추적·수수료 배분"),
 ("관리자",True,"종류·상태·지도·급여 관리(운영 전반)"),
 ("마케팅 발송",True,"1클릭 네이버 부동산·블로그·SNS"),
 ("AI 전화응대(제로콜)",True,"통화요약·매물추천·그룹공유"),
],size=12.5,gap=7)
rect(s,0.5,5.35,6.6,1.4,CARD,LINE)
txt(s,0.72,5.5,6.2,1.2,[
 [("가격  ",11,True,AC),("상업 빌딩 초기 400만 + 연 100만 / 일반 연 100만",11,False,INK)],
 [("강점  ",11,True,GREEN),("성숙한 CRM·직원·운영 관리, 네이버 연동, 시장 침투",11,False,INK)],
 [("약점  ",11,True,RGBColor(0xC0,0x39,0x2B)),("가치분석·매수자 설득 보고서 없음(운영관리 중심)·상위 고가",11,False,INK)],
],11,sp=4)
pic(s,SHOTS+"bugisa_crop_A.png",7.35,1.5,5.6,4.4); txt(s,7.35,6.0,5.6,0.3,"▲ 실행화면: 매물 그리드 + 고객별 TM관리·매물매칭",9.5,False,SUB); foot(s,3)

# ── 4 디스코 ──
s=slide(); band(s,"02","디스코"); txt(s,0.5,0.8,8,0.3,"02 디스코 (Disco)",12,True,AC); txt(s,0.5,1.13,7,0.4,"무료 부동산 데이터 조회",20,True,INK)
bullets(s,0.5,1.85,6.3,[
 ("지도 검색",True,"지번/건물명→일대 실거래가(매매/전월세) 지도 라벨(평당가·거래일)"),
 ("도구",True,"필터·매물만보기·로드뷰·거리/면적/반경 측정·지적/위성"),
 ("건물 데이터",True,"대장(대지·건축·연면적·준공)·공시지가·등기부 열람"),
 ("전문가 회원",True,"매물 등록/관리·경매중개·관심목록·AI 기획설계·포스트"),
],size=12.5,gap=8)
rect(s,0.5,5.0,6.3,1.75,CARD,LINE)
txt(s,0.72,5.15,5.9,1.5,[
 [("가격  ",11,True,AC),("전문가 서비스 전부 무료, 등기 열람권만 유료",11,False,INK)],
 [("강점  ",11,True,GREEN),("데이터 폭·무료·UX, 중개인 사이 실사용 많음",11,False,INK)],
 [("약점  ",11,True,RGBColor(0xC0,0x39,0x2B)),("조회·경량 매물등록 중심 → 본격 CRM(고객·직원·수수료)·설득 보고서로 안 이어짐",11,False,INK)],
],11,sp=5)
pic(s,SHOTS+"disco.png",7.05,1.5,5.9,4.55); txt(s,7.05,6.08,5.9,0.3,"▲ 실행화면: 지도 실거래가 라벨 + 좌측 동별 실거래가·전문가",9.5,False,SUB); foot(s,4)

# ── 5 건물닷컴 개요 ──
s=slide(); band(s,"03","건물닷컴"); txt(s,0.5,0.8,8,0.3,"03 건물닷컴 (Gunmul.com)",12,True,AC); txt(s,0.5,1.13,7,0.4,"상업 가치평가 + 실매물",20,True,INK)
bullets(s,0.5,1.85,6.3,[
 ("부동산 클리닉 6종",True,"가치평가·매입예정 평가·수익률 진단·경매 권리분석·감정평가·세금 원클릭"),
 ("자동 가격평가",True,"3기준 병렬 원클릭(다음 장 상세)"),
 ("가치평가 클리닉",True,"사람 개입 컨설팅, 의뢰~완료 10일, 매각=무료·보유=유료"),
 ("실매물",True,"수익형/투자/사옥 100% 실매물 + 금융 제휴 거래사례"),
],size=12.5,gap=8)
rect(s,0.5,5.0,6.3,1.75,CARD,LINE)
txt(s,0.72,5.15,5.9,1.5,[
 [("특징  ",11,True,AMBER),("\"법적 효력 없음·참고용\" · 10억↑ 정확 · 서울·경기 · 페이지 문구 노후(2017/2021)",11,False,INK)],
 [("강점  ",11,True,GREEN),("상업 가치평가 특화·3기준 병렬·실매물+금융제휴",11,False,INK)],
 [("약점  ",11,True,RGBColor(0xC0,0x39,0x2B)),("자동평가 정성적·정확도 불명·클리닉 느림·CRM 없음·UI 노후",11,False,INK)],
],11,sp=5)
pic(s,SHOTS+"gunmul_main.png",7.05,1.5,5.9,4.55); txt(s,7.05,6.08,5.9,0.3,"▲ 실행화면: 부동산 클리닉 6메뉴 + 실매물 그리드",9.5,False,SUB); foot(s,5)

# ── 6 건물닷컴 가치평가 방식 ──
s=slide(); band(s,"03","건물닷컴 · 가치평가 방식"); txt(s,0.5,0.8,10,0.3,"03 건물닷컴 — 자동 가격평가 3기준",12,True,AC); txt(s,0.5,1.13,8,0.4,"원클릭 자동 가격평가는 어떻게 동작하나",19,True,INK)
rows=[("① 부동산원가 기준","토지 개별공시지가 + 표준지 공시지가 + 건물 시가표준액 + 역세권·개발호재·용도지역"),
      ("② 수익률 기준","지역별 매매가 대비 평균 임대수익률 + 임차업종"),
      ("③ 실거래 비교 기준","반경 1m~500m 매매사례(최근·월/분기/연도 평균) + 평가 부동산 기본정보")]
for i,(k,v) in enumerate(rows):
    t=1.95+i*0.95; rect(s,0.5,t,6.5,0.82,CARD,LINE); txt(s,0.72,t+0.1,6.1,0.3,k,13,True,AC); txt(s,0.72,t+0.42,6.1,0.35,v,10.5,False,SUB)
txt(s,0.5,4.95,6.6,1.7,[
 [("대상  ",11,True,INK),("건물·모텔·상가주택·원룸 = 3기준 / 토지·주택·주유소 = 2기준",11,False,SUB)],
 [("관찰  ",11,True,AMBER),("정성적 요인(경기·금리·환금성) 검토라 표준 자동산식 아님 · 정확도 수치 미공개 · '참고용' 명시",11,False,SUB)],
],11,sp=6)
pic(s,SHOTS+"gunmul_appraisal.png",7.2,1.5,5.7,4.7); txt(s,7.2,6.25,5.7,0.3,"▲ 실행화면: 3기준 추출방식 · 제공지역",9.5,False,SUB); foot(s,6)

# ── 7 종합 비교 ──
s=slide(); band(s,"04","종합"); txt(s,0.5,0.8,10,0.3,"04 종합 비교",12,True,AC); txt(s,0.5,1.13,10,0.4,"세 축이 분리되어 있다",20,True,INK)
hdr=["","부기사","디스코","건물닷컴"]
data=[["초점","중개 운영관리","데이터 조회","가치평가+실매물"],
["매물 CRM","●●● 고객·직원·수수료","● 경량 등록","○"],
["가치평가/보고서","○ 계산기","○","●● 3기준+컨설팅"],
["데이터 조회","●●","●●●","●●"],
["가격","연 100만~400만+","무료(등기만 유료)","매각평가 무료"],
["타겟","개업중개사·법인","중개인·투자자","상업 투자·중개"]]
tb=s.shapes.add_table(len(data)+1,4,I(0.5),I(1.9),I(7.3),I(3.7)).table
tb.columns[0].width=I(1.7)
for j,h in enumerate(hdr):
    c=tb.cell(0,j); c.fill.solid(); c.fill.fore_color.rgb=RGBColor(0x12,0x2A,0x5C)
    pr=c.text_frame.paragraphs[0]; pr.alignment=PP_ALIGN.CENTER; r=pr.add_run(); r.text=h; r.font.size=Pt(11.5); r.font.bold=True; r.font.color.rgb=WHITE; r.font.name='Malgun Gothic'
for i,row in enumerate(data,1):
    for j,val in enumerate(row):
        c=tb.cell(i,j); c.fill.solid(); c.fill.fore_color.rgb=CARD if j==0 else WHITE
        pr=c.text_frame.paragraphs[0]; pr.alignment=PP_ALIGN.LEFT if j==0 else PP_ALIGN.CENTER
        r=pr.add_run(); r.text=val; r.font.size=Pt(10); r.font.bold=(j==0); r.font.color.rgb=INK; r.font.name='Malgun Gothic'
txt(s,8.1,1.9,4.8,0.35,"시사점 (객관)",14,True,INK)
bullets(s,8.1,2.4,4.8,[
 ("운영관리·조회·평가 세 축이 분리",True,"통합 사업자 부재"),
 ("가치평가는 자동(정성)·컨설팅(수기)로 갈림",True,"즉석·투명·중개워크플로 결합은 빈 자리"),
 ("공개 유저 리뷰 희소",True,"입소문·영업 중심 시장"),
],size=11.5,gap=10)
foot(s,7)

p.save("specs/05-business/경쟁사분석.pptx")
print("saved 경쟁사분석.pptx ·", len(p.slides._sldIdLst), "slides")
