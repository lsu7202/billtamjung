#!/usr/bin/env python3
"""건축HUB 컬럼 정의서 받기 — 마트 레이아웃의 **정본**(2026-08-31).

## 왜
지금까지 마트 칸 뜻을 사람이 표본으로 짐작해 specs/04-data/mart-layout.md 에 적어 왔다.
총괄표제부(djy_02)는 아예 「⬜ 미문서」였고, 그래서 표제부 동 합계와 대조해 실측으로 밝혀야 했다.
그런데 **HUB 가 컬럼 정의를 API 로 준다.** 짐작할 일이 아니었다.

    목록  /portal/opn/lps/idx-lgcpt-pvsn-srvc-list.do?opnLgcptTaskSeCd={업무}
          → fnLgcptPop('업무','서비스코드','서비스명 (YYYY년 MM월)','부서') 로 서비스 목록
    정의  /portal/opn/lps/idx-lgcpt-pvsn-srvc-popup.do  (POST · XML)
          → <colLogicNm> 이 칸 이름, 순서가 파일의 칸 순서

업무: 03=건축물대장(10종) · 01=건축인허가.

    data/.venv/bin/python scripts/hub/fetch_layout.py [--task 03] [--out data/raw/_hub_layout]
"""
import argparse
import http.cookiejar
import json
import os
import re
import urllib.parse
import urllib.request

BASE = "https://www.hub.go.kr"
LIST = BASE + "/portal/opn/lps/idx-lgcpt-pvsn-srvc-list.do"
POP = BASE + "/portal/opn/lps/idx-lgcpt-pvsn-srvc-popup.do"
UA = {"User-Agent": "Mozilla/5.0", "Referer": BASE + "/"}

_JAR = http.cookiejar.CookieJar()
_OP = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_JAR))


def services(task):
    """[(서비스코드, 서비스명)] — 최신월 것만, 코드 오름차순."""
    html = _OP.open(urllib.request.Request(
        f"{LIST}?opnLgcptTaskSeCd={task}&pageCountPerPage=100", headers=UA), timeout=120
    ).read().decode("utf-8", "replace")
    c = re.search(r'name="_csrf"[^>]*value="([^"]+)"', html)
    seen = {}
    for m in re.finditer(r"fnLgcptPop\('%s','(\d+)','([^']*)','([^']*)'\)" % task, html):
        seen.setdefault(m.group(1), m.group(2))      # 첫 매치 = 최신월
    return sorted(seen.items()), (c.group(1) if c else "")


def columns(task, code, name, csrf):
    body = urllib.parse.urlencode({"opnLgcptTaskSeCd": task, "opnTaskCd": code,
                                   "srvcNm": name, "pvsnInstDeptNm": "", "_csrf": csrf}).encode()
    raw = _OP.open(urllib.request.Request(
        POP, data=body, headers={**UA, "Referer": LIST, "X-Requested-With": "XMLHttpRequest",
                                 "Content-Type": "application/x-www-form-urlencoded"}), timeout=60
    ).read().decode("utf-8", "replace")
    names = re.findall(r"<colLogicNm>(.*?)</colLogicNm>", raw)
    types = re.findall(r"<dataType>(.*?)</dataType>", raw)
    return [{"idx": i, "name": n, "type": t} for i, (n, t) in enumerate(zip(names, types))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", default="03", help="03=건축물대장 · 01=건축인허가")
    ap.add_argument("--out", default="data/raw/_hub_layout")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    svcs, csrf = services(a.task)
    print(f"업무 {a.task} · 서비스 {len(svcs)}종")
    out = {}
    for code, name in svcs:
        cols = columns(a.task, code, name, csrf)
        out[code] = {"name": name, "columns": cols}
        print(f"  {code}  {name.split(' (')[0]:14} {len(cols):3d}칸")
    p = os.path.join(a.out, f"task{a.task}.json")
    json.dump(out, open(p, "w"), ensure_ascii=False, indent=1)
    print(f"→ {p}")


if __name__ == "__main__":
    main()
