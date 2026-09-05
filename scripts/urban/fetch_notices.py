#!/usr/bin/env python3
"""서울도시공간포털 도시계획 결정고시 — 제목·본문·고시번호·고시문 PDF(2026-09-05).

## 왜 이게 필요한가
우리는 지구단위계획·정비구역의 **이름·날짜·도형**만 갖고 있었다. 「무엇을 어떻게 바꾼다」는
고시 본문이 없어서, 화면을 열어도 「그런 게 있다」까지였고 AI 도 내용을 몰랐다.

## 무엇이 오나 (2026-09-05 실측)
    총 43,989건 · 본문 빈 것 0 · 본문 중앙 280자 · 최대 2,017자
    고시문 PDF 99% · 지형도면 70%
    title · content · noticeNo · noticeDate · site · charger · phone · noticeCode

## 우리 데이터와 붙는 법 — **1:1 로 붙는다**
`noticeCode` 가 우리 `master.district_plan.ntfc_sn` 과 **같은 체계**다.

    11110NTC202407120002  →  「도시관리계획(율곡로 지구단위계획) 결정(경미한 변경)…」
    11110NTC202308250003  →  「도시관리계획(종로4,5가 지구단위계획) 결정(경미한 변경)…」

정비구역(`redevel_zone`)은 `MNUM` 이 다른 체계(UDT)라 코드로는 못 붙는다.
**이름으로 찾는다** — 「세운4구역」 1건, 「홍실아파트」 5건. 「효제1구역」은 0건이라 다 붙지는 않는다.

## 받는 법의 함정
  · 기본 User-Agent 로도 되지만 **Referer 가 있어야 안전하다**
  · 경로는 `/ntfc/getNtfcList.json` 이다. `/api/ntfc/…` 는 404
  · POST + JSON 본문. `pageSize` 100 까지 한 번에 온다(1.7MB)
  · PDF 는 `UpisArchive/DATA/PM/pdf/{noticeCode}/{파일명}` — 대소문자를 지켜야 한다(`upisArchive` 는 404)

    data/.venv/bin/python scripts/urban/fetch_notices.py --pages 3
"""
import argparse
import json
import os
import urllib.parse
import urllib.request

BASE = "https://urban.seoul.go.kr"
LIST = f"{BASE}/ntfc/getNtfcList.json"
REF = f"{BASE}/view/html/PMNU4030100001"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
KEEP = ("noticeCode", "noticeNo", "noticeDate", "title", "content",
        "siteCode", "site", "charger", "phone", "noticeClassify")


def post(body: dict) -> dict:
    req = urllib.request.Request(
        LIST, data=json.dumps(body).encode(),
        headers={"User-Agent": UA, "Referer": REF, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


def slim(x: dict) -> dict:
    out = {k: x.get(k) for k in KEEP}
    ni = x.get("tnNtfcImage") or {}
    if ni.get("aImagePath") and ni.get("aImageName"):
        out["pdf"] = f'{BASE}/{ni["aImagePath"]}/{urllib.parse.quote(ni["aImageName"])}'
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/raw/_urban_notice")
    ap.add_argument("--pages", type=int, default=0, help="0=전부")
    ap.add_argument("--size", type=int, default=100)
    ap.add_argument("--keyword")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    body = {"pageNo": 1, "pageSize": a.size, "useYn": "Y",
            "keywordList": [a.keyword] if a.keyword else []}
    first = post(body)
    total, pages = first.get("totalElements", 0), first.get("totalPages", 0)
    last = pages if not a.pages else min(a.pages, pages)
    print(f"  총 {total:,}건 · {pages:,}쪽 중 {last:,}쪽을 받는다")
    rows = [slim(x) for x in (first.get("content") or [])]
    for p in range(2, last + 1):
        rows += [slim(x) for x in (post({**body, "pageNo": p}).get("content") or [])]
        if p % 20 == 0:
            print(f"    {p}/{last}쪽 · {len(rows):,}건")
    p = os.path.join(a.out, "notices.json")
    json.dump(rows, open(p, "w", encoding="utf-8"), ensure_ascii=False)
    body_n = sum(1 for r in rows if (r.get("content") or "").strip())
    pdf_n = sum(1 for r in rows if r.get("pdf"))
    print(f"  {p} · {len(rows):,}건 · 본문 {body_n:,} · PDF {pdf_n:,}")


main()
