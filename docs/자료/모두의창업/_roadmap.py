# -*- coding: utf-8 -*-
"""로드맵 그림 생성기. 날짜·명칭은 고정, 내용만 바꿔 여러 판을 찍는다.

    python3 _roadmap.py 출력.svg "내용//내용" x5                   # 내용만
    python3 _roadmap.py 출력.svg "내용" x5 --series "라벨:값,..." [축이름]
      → 추세선이 띠 위에 얹히고, 구간 경계 점선을 x축으로 공유한다.
"""
import sys, io

PHASES = [("기획 및 개발","2026.07~08"),
          ("베타테스트","2026.08~11"),
          ("출시","2026.12~2027.05"),
          ("확장 준비","2027.02~08"),
          ("확장","2027.09~")]
NOW  = 1
WEIGHT = [0.75, 1.50, 0.78, 1.00, 0.97]      # 구간 폭. 베타테스트를 가장 길게 본다
FILL = ["#DCE4F0","#C3CEE0","#7E93B5","#3C5C8C","#243B5E"]
TXT  = ["#1F3864","#1F3864","#FFFFFF","#FFFFFF","#FFFFFF"]
W, BH, TIP = 960, 64, 22
# 세 그림(로드맵·매출·자금)이 함께 쓰는 고정 내용. 여기만 고치면 전부 따라온다.
DETAILS_FIXED = [
    ["서울 빌딩 60만 채 DB 기반 검색 엔진","가치 추정 시스템","매물·일정 관리 시스템"],
    ["*1차 2026.08 · 중개사 7명","UI/UX 적응 어려움, 실제 매물 없음",
     "분석을 한 화면에서 확인하고 싶음","!구매 의향서 확보 완료","*개선 진행 및 2차 테스트 준비",
     "유저가 이미 익숙한 UI/UX로 개선","상위 기능을 전부 통제하는 AI 에이전트 개발",
     "조회·분석·자료 생성 등 전문 스킬 탑재","DB를 근거로 답하는 구조로 설계"],
    ["*유료 구독으로 출시","고객 DB 기반 유저 확보","매물 호가 데이터 확보"],
    ["*시제품 제작","일반인용 빌탐정 시스템","호가 기반 광고 시스템",
     "해외 고객용 시스템","경험과학 기반 진단 시스템"],
    ["*기대 효과","잠재고객 증가, 매출액 상승 기대","광고 수익 발생",
     "호가 데이터 축적으로 플랫폼 가치 상승 기대"],
]

def geom(weights=None):
    """구간 폭을 다시 잡는다. 그림마다 다른 비율을 쓸 수 있다."""
    global WID, EDGE
    ws = weights or WEIGHT
    u = (W - TIP) / sum(ws)
    WID = [w*u for w in ws]
    EDGE = [sum(WID[:i]) for i in range(len(WID)+1)]

geom()

def cx(i): return EDGE[i] + WID[i]/2 + TIP/2

def xpos(pos):
    """pos = 구간 번호 + 그 안의 비율. 예: 2.5 = 세 번째 구간 가운데."""
    i = max(0, min(int(pos), len(WID)-1)); f = max(0.0, min(1.0, pos - int(pos)))
    return EDGE[i] + f*WID[i] + TIP/2

FS = 14.5                                  # 내용 글자 크기
def _w(ch): return FS*(0.56 if ord(ch)<0x2500 else 1.0)

def wrap(txt, lim):
    """칸 폭에 맞춰 낱말 단위로 접는다."""
    out=[]; cur=""
    for word in txt.split(" "):
        cand = (cur+" "+word).strip()
        if sum(_w(c) for c in cand) > lim and cur:
            out.append(cur); cur=word
        else:
            cur=cand
    if cur: out.append(cur)
    return out

def lay(details):
    """구간별 내용을 접어 [(줄, 들여쓰기여부)] 로 바꾼다."""
    res=[]
    for i,ds in enumerate(details):
        lim = WID[i] - 26
        rows=[]
        for d in ds:
            head = d.startswith("*")
            emph = d.startswith("!")                 # 진하게 강조할 줄
            d = d[1:] if (head or emph) else d
            for k,ln in enumerate(wrap(d, lim)):
                rows.append((ln, k>0, head, emph))
        res.append(rows)
    return res

def build(details, series=None, ylabel="월 매출(만원)", curve=None, weights=None, rise=False, vrange=(60.0,40000.0), ccolor="#E8873A", bars=None, blabel="라운드별 지원금", bfill="#E9EEF6", bstroke="#7E93B5", btext="#5B6B84", notes=None, nlabel=None,
          curve2=None, c2color="#E8873A", y2label=None,
          phases=None, now=None, off=0):
    geom(weights)
    PH  = phases if phases is not None else PHASES
    NW  = NOW if now is None else now
    sh   = 206 if curve else (150 if series else 0)   # 위에 얹는 추세 영역
    # 주석은 접은 뒤의 줄 수로 자리를 잡는다 (안 그러면 띠에 가려진다)
    laid_notes = None; nrow = 0
    if notes:
        laid_notes = []
        for i,ls in enumerate(notes):
            lim = WID[i] - 24; rows=[]
            for d in ls:
                for k,ln in enumerate(wrap(d, lim)): rows.append((ln, k>0))
            laid_notes.append(rows)
        nrow = max((len(r) for r in laid_notes), default=0)
    nl   = 20 if (notes and nlabel) else 0   # 주석 제목이 한 줄 차지한다
    top  = sh + max(46, 16 + nl + nrow*18)   # 띠 시작. 위에 「현재」 알약과 주석 자리
    band_b = top + BH
    laid = lay(details)
    rows = max((len(r) for r in laid), default=0)
    H = band_b + (26 + rows*21 if rows else 10) + 12

    s = [f'<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" '
         'font-family="Apple SD Gothic Neo, sans-serif">',
         f'<rect width="{W}" height="{H}" fill="#ffffff"/>']

    # 구간 경계 점선 (그림 전체를 관통, 추세선의 x축 구실도 한다)
    for i in range(1, len(PH)):
        x = EDGE[i] + TIP/2
        s.append(f'<line x1="{x:.1f}" y1="6" x2="{x:.1f}" y2="{H-6}" '
                 'stroke="#8A94A6" stroke-width="1.8" stroke-dasharray="5 4"/>')

    # 띠 위에 얹는 추세선
    if series:
        vals=[v for _,v in series]; mx=max(vals)*1.3 or 1
        base=sh+6; tp=34
        def Y(v): return base-(base-tp)*(v/mx)
        s.append(f'<text x="2" y="24" font-size="13" fill="#C9762E" font-weight="700">{ylabel}</text>')
        pts=[(cx(i),Y(v)) for i,(_,v) in enumerate(series)]
        s.append('<polyline points="'+" ".join(f"{x:.1f},{y:.1f}" for x,y in pts)+
                 '" fill="none" stroke="#E8873A" stroke-width="2.6"/>')
        for (x,y),(lb,v) in zip(pts,series):
            s.append(f'<line x1="{x:.1f}" y1="{y:.1f}" x2="{x:.1f}" y2="{base}" stroke="#F0C89E" stroke-width="1.2"/>')
            s.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4.5" fill="#E8873A"/>')
            s.append(f'<text x="{x:.1f}" y="{y-11:.1f}" font-size="13.5" fill="#C9762E" text-anchor="middle" font-weight="700">{lb}</text>')

    # 로그 눈금 매출 곡선 (구간 안 임의 위치)
    if curve:
        import math
        VMIN, VMAX = vrange
        base, tp = sh-16, 54
        def Y(v):
            if v<=0: return base
            r=(math.log10(v)-math.log10(VMIN))/(math.log10(VMAX)-math.log10(VMIN))
            return base-(base-tp)*max(0.0,min(1.0,r))
        s.append(f'<line x1="0" y1="{base}" x2="{W}" y2="{base}" stroke="#B8C4D9" stroke-width="1.2"/>')
        if bars:                               # 같은 축에 겹쳐 그리는 지원금
            for p0,p1,v,lb in bars:
                x0,x1=xpos(p0),xpos(p1); yy=Y(v)
                s.append(f'<rect x="{x0:.1f}" y="{yy:.1f}" width="{x1-x0:.1f}" height="{base-yy:.1f}" fill="{bfill}" stroke="{bstroke}" stroke-width="1.4" stroke-dasharray="5 3"/>')
                s.append(f'<text x="{x0+11:.1f}" y="{yy-9:.1f}" font-size="15" fill="{btext}" font-weight="700">{lb}</text>')
            s.append(f'<text x="{W-3}" y="26" font-size="12.5" fill="{btext}" text-anchor="end" font-weight="700">{blabel}</text>')
        CTX, CSOFT = ccolor, ccolor+"66"
        def name_at(x, y, txt, col):
            tw = sum(13.5*(0.56 if ord(c)<0x2500 else 1.0) for c in txt)
            if x + 12 + tw > W - 4:
                s.append(f'<text x="{x-12:.1f}" y="{y+5:.1f}" font-size="13.5" fill="{col}" text-anchor="end" font-weight="700">{txt}</text>')
            else:
                s.append(f'<text x="{x+12:.1f}" y="{y+5:.1f}" font-size="13.5" fill="{col}" font-weight="700">{txt}</text>')
        pts=[(xpos(p),Y(v)) for p,v,_,_ in curve]
        s.append('<polyline points="'+" ".join(f"{x:.1f},{y:.1f}" for x,y in pts)+
                 f'" fill="none" stroke="{CTX}" stroke-width="2.8"/>')
        if curve2:
            p2=[(xpos(p),Y(v)) for p,v,_,_ in curve2]
            s.append('<polyline points="'+" ".join(f"{x:.1f},{y:.1f}" for x,y in p2)+
                     f'" fill="none" stroke="{c2color}" stroke-width="2.8"/>')
            for (x,y),(p,v,lb,sub) in zip(p2,curve2):
                s.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5" fill="{c2color}"/>')
                if lb:
                    s.append(f'<text x="{x:.1f}" y="{y-10:.1f}" font-size="15" fill="{c2color}" text-anchor="middle" font-weight="700">{lb}</text>')
            if y2label:
                name_at(p2[-1][0], p2[-1][1], y2label, c2color)
        for k,((x,y),(p,v,lb,sub)) in enumerate(zip(pts,curve)):
            last = (k==len(pts)-1)
            s.append(f'<line x1="{x:.1f}" y1="{y:.1f}" x2="{x:.1f}" y2="{base}" stroke="{CSOFT}" stroke-width="1.2" stroke-dasharray="3 3"/>')
            s.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5" fill="{CTX}"/>')
            if last and rise:                      # 마지막 시점 뒤는 수직 상승
                s.append(f'<line x1="{x:.1f}" y1="{y:.1f}" x2="{x:.1f}" y2="34" stroke="{CTX}" stroke-width="2.8"/>')
                s.append(f'<path d="M{x-8:.1f},34 h16 l-8,-14 z" fill="{CTX}"/>')
                s.append(f'<text x="{x-14:.1f}" y="{y-24:.1f}" font-size="12.5" fill="#6B7688" text-anchor="end">{sub}</text>')
                s.append(f'<text x="{x-14:.1f}" y="{y-6:.1f}" font-size="15" fill="{CTX}" text-anchor="end" font-weight="700">{lb}</text>')
                continue
            if curve2:
                if lb:
                    s.append(f'<text x="{x:.1f}" y="{y+20:.1f}" font-size="15" fill="{CTX}" text-anchor="middle" font-weight="700">{lb}</text>')
            else:
                s.append(f'<text x="{x:.1f}" y="{y-26:.1f}" font-size="12.5" fill="#6B7688" text-anchor="middle">{sub}</text>')
                s.append(f'<text x="{x:.1f}" y="{y-10:.1f}" font-size="15" fill="{CTX}" text-anchor="middle" font-weight="700">{lb}</text>')

    if curve and ylabel:
        px,py = pts[-1]
        name_at(px, py, ylabel, ccolor)

    # 곡선과 띠 사이에 적는 주석 (운영비 구성·매출 사용처 등)
    if laid_notes:
        ny = sh + 20 + nl
        if nlabel:
            s.append(f'<text x="3" y="{sh+16}" font-size="12.5" fill="{ccolor}" font-weight="700">{nlabel}</text>')
        for i,rows in enumerate(laid_notes):
            tx = EDGE[i] + TIP/2 + 12
            for k,(ln,cont) in enumerate(rows):
                y = ny + k*18
                if not cont:
                    s.append(f'<rect x="{tx:.1f}" y="{y-8:.1f}" width="4" height="4" fill="{ccolor}"/>')
                s.append(f'<text x="{tx+9:.1f}" y="{y}" font-size="12.5" fill="{ccolor}">{ln}</text>')

    # 구간 띠
    for i,(name,when) in enumerate(PH):
        x=EDGE[i]; bw=WID[i]
        s.append(f'<path d="M{x},{top} h{bw} l{TIP},{BH/2} l-{TIP},{BH/2} H{x} l{TIP},-{BH/2} z" fill="{FILL[i+off]}"/>')
        s.append(f'<text x="{cx(i):.0f}" y="{top+27}" font-size="15.5" fill="{TXT[i+off]}" text-anchor="middle" font-weight="700">{name}</text>')
        s.append(f'<text x="{cx(i):.0f}" y="{top+47}" font-size="12.5" fill="{TXT[i+off]}" text-anchor="middle" opacity="0.85">{when}</text>')
        if i==NW:
            s.append(f'<path d="M{x},{top} h{bw} l{TIP},{BH/2} l-{TIP},{BH/2} H{x} l{TIP},-{BH/2} z" '
                     'fill="none" stroke="#C0392B" stroke-width="3"/>')
            pw, ph = 76, 26
            px = cx(i)-pw/2; py = top-ph-12
            s.append(f'<rect x="{px:.1f}" y="{py}" width="{pw}" height="{ph}" rx="{ph/2}" fill="#C0392B"/>')
            s.append(f'<text x="{cx(i):.0f}" y="{py+18}" font-size="14.5" fill="#ffffff" text-anchor="middle" font-weight="700">현재</text>')
            s.append(f'<path d="M{cx(i)-7:.1f},{py+ph} h14 l-7,10 z" fill="#C0392B"/>')
        tx = EDGE[i] + TIP/2 + 13
        for k,(ln,cont,head,emph) in enumerate(laid[i]):
            y = band_b+26+k*21
            if head:
                s.append(f'<text x="{tx:.1f}" y="{y}" font-size="{FS}" fill="#1F3864" font-weight="700">{ln}</text>')
                continue
            if not cont:
                s.append(f'<rect x="{tx:.1f}" y="{y-9:.1f}" width="5" height="5" fill="{FILL[min(i+off+2,4)]}"/>')
            col = "#1F3864" if emph else "#3E4A5E"
            wt  = ' font-weight="700"' if emph else ''
            s.append(f'<text x="{tx+11:.1f}" y="{y}" font-size="{FS}" fill="{col}"{wt}>{ln}</text>')

    s.append('</svg>')
    return "\n".join(s)

if __name__=="__main__":
    a=sys.argv[1:]; out=a[0]; a=a[1:]
    series=None; ylabel="월 매출(만원)"
    if "--series" in a:
        k=a.index("--series"); spec=a[k+1]
        if len(a)>k+2: ylabel=a[k+2]
        a=a[:k]
        series=[(p.split(":")[0], float(p.split(":")[1])) for p in spec.split(",")]
    details=[(x.split("//") if x else []) for x in (a+[""]*5)[:5]]
    io.open(out,"w",encoding="utf-8").write(build(details,series,ylabel))
    print("wrote",out)
