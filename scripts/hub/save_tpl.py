#!/usr/bin/env python3
"""capture_tpl.js 가 모은 __caps 를 _tpl/*.xml 로 푼다.

    콘솔에서  copy(JSON.stringify(__caps))  → .caps.json 에 붙여 저장
    python scripts/hub/save_tpl.py [.caps.json]

가로챈 것은 폼 본문 전체라 여기서 inputxml 만 꺼낸다. 파일 이름은 pages.json 의
{계열}_{마트} 를 따르고, download_seoul.py 가 그 이름으로 찾는다.
"""
import json
import os
import re
import sys
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TPL = os.path.join(ROOT, "scripts", "hub", "_tpl")


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, ".caps.json")
    raw = open(src, encoding="utf-8").read()
    caps = json.loads(raw)
    if isinstance(caps, str):                      # 도구가 한 번 더 감싼 경우
        caps = json.loads(caps)
    pages = json.load(open(os.path.join(TPL, "pages.json"), encoding="utf-8"))
    by = {p["rCode"]: p for p in pages}

    n = 0
    for rc, body in caps.items():
        p = by.get(rc)
        if not p:
            print(f"  ? pages.json 에 없는 rCode {rc}")
            continue
        xml = dict(urllib.parse.parse_qsl(body)).get("inputxml")
        if not xml:
            print(f"  ✗ {p['grp']}/{p['name']}: inputxml 없음")
            continue
        # 시군구 파라미터가 있어야 갈아끼울 수 있다 — 없으면 쓸모없는 템플릿이다
        if ':VS_SIGUNGU' not in xml:
            print(f"  ✗ {p['grp']}/{p['name']}: :VS_SIGUNGU 가 없다 — 다시 뜨세요")
            continue
        open(os.path.join(TPL, f"{p['grp']}_{p['name']}.xml"), "w", encoding="utf-8").write(xml)
        n += 1

    have = {f[:-4] for f in os.listdir(TPL) if f.endswith(".xml")}
    miss = [f"{p['grp']}_{p['name']}" for p in pages if f"{p['grp']}_{p['name']}" not in have]
    print(f"저장 {n}장 · 갖춘 것 {len(have)}/{len(pages)}장")
    for m in miss:
        print(f"  남음: {m}")


if __name__ == "__main__":
    main()
