#!/usr/bin/env python3
"""나라장터 공사 입찰공고 — 「기존 시설 개선」을 잡는 유일한 원천(2026-09-05).

정비구역·지구단위계획은 고시로 남지만, **역 출입구 개선·보행환경 개선·문화재 보수는
도시관리계획을 다시 결정하지 않아 어떤 고시에도 안 남는다.** 공사 발주로만 잡힌다.

    엔드포인트  https://apis.data.go.kr/1230000/ad/BidPublicInfoService
    오퍼레이션  getBidPblancListInfoCnstwk (공사)
    이용허락    제한 없음 · 무료 · 개발계정 1,000건/일
    키          scripts/.env.pipeline 의 G2B_KEY (URL 인코딩된 그대로 쓴다)

## 함정
  · `inqryBgnDt`~`inqryEndDt` 를 넓게 잡으면 **「입력범위값 초과 에러」(resultCode 07)**.
    16일까지는 됐다. **15일씩 끊어서** 부른다.
  · 날짜는 `YYYYMMDDHHMM` 12자리. `type=json` 을 줘야 JSON 이 온다.
  · 응답 칸이 143개인데 값이 있는 것은 60개쯤이다.

## 쓸 칸
    bidNtceNm       공고명 ← 지명이 여기에만 있다
    ntceInsttNm     공고기관 · dminsttNm 수요기관
    bidNtceDt       공고일 · opengDt 개찰일
    presmptPrce     추정가격
    bidNtceDtlUrl   원문 링크(g2b.go.kr)
    ntceInsttOfclNm · ntceInsttOfclTelNo   담당자·전화

## 결합률 실측 (2026-03~09 · 공사공고 12,987건)
    서울 발주 909건
      공고명에 우리 도로명이 있는 것   21 ( 2%)
      공고명에 우리 역명이 있는 것     48 ( 5%)
**대부분은 지명이 공고명에 없다.** 「골목길 개선사업」·「하수관로 개량공사」처럼 권역·구 단위다.
붙는 것만 붙이고 나머지는 버린다 — 동 단위로 억지로 붙이지 않는다.

    data/.venv/bin/python scripts/g2b/fetch_bids.py --days 30
"""
import argparse
import datetime as dt
import json
import os
import time
import urllib.request

BASE = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoCnstwk"
STEP = 15          # 이보다 넓으면 resultCode 07
KEEP = ("bidNtceNo", "bidNtceNm", "ntceInsttNm", "dminsttNm", "bidNtceDt", "opengDt",
        "presmptPrce", "cntrctCnclsMthdNm", "bidNtceDtlUrl",
        "ntceInsttOfclNm", "ntceInsttOfclTelNo")


def page(key: str, bgn: str, end: str, rows: int = 999) -> list:
    u = (f"{BASE}?serviceKey={key}&pageNo=1&numOfRows={rows}&type=json"
         f"&inqryDiv=1&inqryBgnDt={bgn}&inqryEndDt={end}")
    with urllib.request.urlopen(u, timeout=240) as f:
        d = json.load(f)
    if "response" not in d:                      # 에러 봉투는 모양이 다르다
        raise RuntimeError(list(d.values())[0].get("header", {}).get("resultMsg"))
    it = d["response"]["body"].get("items") or []
    return it.get("item", []) if isinstance(it, dict) else it


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/raw/_g2b")
    ap.add_argument("--days", type=int, default=180)
    ap.add_argument("--seoul", action="store_true", help="서울 발주만 남긴다")
    a = ap.parse_args()
    key = os.environ.get("G2B_KEY", "").strip()
    if not key:
        raise SystemExit("G2B_KEY 가 없다 — scripts/.env.pipeline 을 source 하라")
    os.makedirs(a.out, exist_ok=True)
    end = dt.datetime.now()
    cur = end - dt.timedelta(days=a.days)
    rows, n = [], 0
    while cur < end:
        nxt = min(cur + dt.timedelta(days=STEP), end)
        try:
            items = page(key, cur.strftime("%Y%m%d0000"), nxt.strftime("%Y%m%d0000"))
        except Exception as e:
            print(f"  ✗ {cur:%Y-%m-%d}: {e}")
            cur = nxt
            continue
        n += len(items)
        for x in items:
            inst = (x.get("ntceInsttNm") or "") + (x.get("dminsttNm") or "")
            if a.seoul and "서울" not in inst:
                continue
            rows.append({k: x.get(k) for k in KEEP})
        cur = nxt
        time.sleep(0.15)
    p = os.path.join(a.out, "bids_cnstwk.json")
    # **있던 것과 합쳐 쓴다**(2026-09-06 증분 전환). 주간엔 --days 30 만 받는데, 그대로 덮어쓰면
    #   적재(load_g2b 는 파일 통째로 다시 만든다)가 표를 30일치로 줄인다. 공고번호가 열쇠다.
    old_rows = []
    if os.path.exists(p):
        try:
            old_rows = json.load(open(p, encoding="utf-8"))
        except ValueError:
            old_rows = []
    merged = {x.get("bidNtceNo"): x for x in old_rows if x.get("bidNtceNo")}
    new = sum(1 for x in rows if x.get("bidNtceNo") not in merged)
    for x in rows:
        if x.get("bidNtceNo"):
            merged[x["bidNtceNo"]] = x
    json.dump(list(merged.values()), open(p, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"  {p} · 훑은 것 {n:,} · 이번에 담은 것 {len(rows):,} · 새로 {new:,} · 파일 {len(merged):,}")


main()
