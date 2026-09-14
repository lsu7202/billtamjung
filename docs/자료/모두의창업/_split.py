# -*- coding: utf-8 -*-
"""본문.html 을 둘로 나눈다.
  ① 모두의창업_이미지.pdf  — 그림·표만. 한 장에 하나씩
  ② 모두의창업_본문.md     — 글자만. 편집기가 먹는 것만 쓴다(-- 구분선, - 목록)"""
import io, re, html

src = io.open("본문.html", encoding="utf-8").read()
body = src[src.index("<body>")+6:src.index("</body>")] if "<body>" in src else src

# ── 블록 단위로 자르기 ────────────────────────────────
TOK = re.compile(
    r'<h1[^>]*>(?P<h1>.*?)</h1>|<h2[^>]*>(?P<h2>.*?)</h2>|<h3[^>]*>(?P<h3>.*?)</h3>|'
    r'<p class="lead">(?P<lead>.*?)</p>|<p>(?P<p>.*?)</p>|<ul>(?P<ul>.*?)</ul>|'
    r'<div class="quote">(?P<q>.*?)</div>|'
    r'<div class="tw">\s*<div class="cap">(?P<cap>[^<]*)</div>(?P<fig>.*?)(?=<h1|<h2|<h3|<p>|<p class=|<ul>|<div class="tw">\s*<div class="cap">|\Z)',
    re.S)

def text(x):
    x = re.sub(r'<br\s*/?>', ' ', x)
    x = re.sub(r'<[^>]+>', '', x)
    x = html.unescape(x)
    return re.sub(r'\s+', ' ', x).strip()

# 모두의창업은 전 문항 통틀어 이미지 10장. Q 구조는 그대로 두고 이웃한 것끼리 묶는다
GROUPS = [
    ["그림 1"],
    ["그림 2", "표 1"],
    ["그림 3"],
    ["그림 4"],
    ["표 2", "그림 5"],
    ["그림 6", "표 3"],
    ["그림 7"],
    ["그림 8"],
    ["표 4", "그림 9"],
    ["그림 10", "표 5", "표 6"],
]
# Q4-3 의 표 8 은 Q4-1 표 5 와 같은 그림이므로 이미지 9 를 다시 붙인다
REUSE = {}
def gno(cap):
    key = cap.split("|")[0].strip()
    for i,g in enumerate(GROUPS,1):
        if key in g: return i, g
    return None, None

md, figs, seen = [], [], set()
for m in TOK.finditer(body):
    if m.group('h1'):
        md += ["", "--", "", text(m.group('h1')), ""]
    elif m.group('h2'):
        md += ["", text(m.group('h2')), ""]
    elif m.group('h3'):
        md += ["", text(m.group('h3')), ""]
    elif m.group('lead'):
        md += ["", text(m.group('lead')), ""]
    elif m.group('p') is not None:
        md += [text(m.group('p')), ""]
    elif m.group('q'):
        md += [text(m.group('q')), ""]
    elif m.group('ul'):
        for li in re.findall(r'<li>(.*?)</li>', m.group('ul'), re.S):
            md.append("- " + text(li))
        md.append("")
    elif m.group('cap'):
        cap = text(m.group('cap'))
        figs.append((cap, m.group('fig')))
        key = cap.split("|")[0].strip()
        if key in REUSE:
            md += [f"[이미지 {REUSE[key]} 다시 붙이기 — {cap}]", ""]
            for s_ in []: pass
            continue
        n, g = gno(cap)
        if n and n not in seen:
            seen.add(n)
            md += [f"[이미지 {n} 자리 — {' + '.join(g)}]", ""]
        for s in re.findall(r'<div class="src">(.*?)</div>', m.group('fig'), re.S):
            md += [text(s), ""]

out = re.sub(r'\n{3,}', '\n\n', "\n".join(md)).strip() + "\n"
io.open("모두의창업_본문.md", "w", encoding="utf-8").write(out)

# ── 이미지 전용 HTML ──────────────────────────────────
css = io.open("_doc.css", encoding="utf-8").read()
page = ['<meta charset="utf-8"><style>', css,
        '\n@page{size:A4;margin:10mm}',
        'body{padding:0}',
        '.pg{break-after:page;padding:6mm 0}',
        '.pg:last-child{break-after:auto}',
        '.no{font-size:8.5pt;color:#8A94A6;margin-bottom:2mm}',
        # 한 묶음이 두 쪽으로 갈라지면 이미지가 둘이 된다. 높이를 눌러 한 쪽에 담는다
        '.pg img,.pg svg{max-height:96mm;width:auto;max-width:100%;margin:0 auto}',
        '.pg .tw{margin:0 0 4mm}',
        '</style>']
byname = {}
for cap,fig in figs:
    byname[cap.split("|")[0].strip()] = (cap,fig)
for i,g in enumerate(GROUPS,1):
    inner = "".join(f'<div class="tw"><div class="cap">{byname[k][0]}</div>{byname[k][1]}'
                    for k in g if k in byname)
    page.append(f'<div class="pg"><div class="no">이미지 {i} / {len(GROUPS)}</div>{inner}</div>')
io.open("_images.html","w",encoding="utf-8").write("\n".join(page))
print("그림·표", len(figs), "개 →", len(GROUPS), "장 · 본문", len(out), "자")
