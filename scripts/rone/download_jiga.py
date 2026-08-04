"""R-ONE 지역별 지가변동률(연) 자동 다운로드 → build_land_adjust 입력 JSON 생성.

R-ONE 통계표 A_2024_00902((연) 지역별 지가변동률)의 미리보기 데이터 엔드포인트를 호출:
  GET  easyStatPage/A_2024_00902.do            (세션 프라이밍)
  POST stat/sttsDataPreviewList.do  dtacycleCd=YY&wrttimeLastestVal=N ...
       → {DATA:[{CATE1:시도, CATE2:구, COL_YYYY..:값}]}  (키·세션만, API키 불필요)
빌더(build_land_adjust)가 읽는 레거시 그리드 포맷 `{sheet:{"1":{data:{row:{col:val}}}}}`으로 변환해
  data/raw/(연) 지역별 지가변동률.json  로 저장(그대로 대체 → 빌더 무수정).

    data/.venv/bin/python scripts/rone/download_jiga.py [--out DIR] [--years 12]
근거: specs/07-architecture/05-raw-사용-원장(B절) · 04-레지스트리.
"""
import os
import re
import json
import argparse
import urllib.parse
import urllib.request
import http.cookiejar

STATBL = "A_2024_00902"
PAGE = f"https://www.reb.or.kr/r-one/portal/stat/easyStatPage/{STATBL}.do"
PREVIEW = "https://www.reb.or.kr/r-one/portal/stat/sttsDataPreviewList.do"
OUT_NAME = "(연) 지역별 지가변동률.json"

_JAR = http.cookiejar.CookieJar()
_OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_JAR))


def fetch(years):
    _OPENER.open(urllib.request.Request(PAGE, headers={"User-Agent": "Mozilla/5.0"}), timeout=60)  # 세션
    body = urllib.parse.urlencode({
        "statblId": STATBL, "viewLocOpt": "B", "wrttimeType": "L", "dtadvsVal": "OD",
        "wrttimeLastestVal": str(years), "wrttimeOrder": "A", "dtacycleCd": "YY",
        "wrttimeMinYear": "1975", "wrttimeMaxYear": "2100",
        "wrttimeStartQt": "00", "wrttimeEndQt": "00", "wrttimeMinQt": "00", "wrttimeMaxQt": "00",
        "optDivVal": "00", "isRegionData": "Y", "statblNm": "(연) 지역별 지가변동률", "searchType": "S",
    }).encode()
    req = urllib.request.Request(PREVIEW, data=body, headers={
        "User-Agent": "Mozilla/5.0", "X-Requested-With": "XMLHttpRequest", "Referer": PAGE})
    return json.loads(_OPENER.open(req, timeout=120).read().decode("utf-8", "replace"))["DATA"]


def to_grid(rows):
    """미리보기 DATA[] → 빌더가 읽는 {sheet:{"1":{data:{...}}}} 그리드."""
    yrs = sorted({re.search(r"COL_(\d{4})", k).group(1)
                  for r in rows for k in r if k.startswith("COL_")})
    ycol = {y: next(k for k in rows[0] if k.startswith(f"COL_{y}")) for y in yrs}
    hdr = {"0": "No", "1": "지역", "2": "지역", "3": "지역"}
    for i, y in enumerate(yrs):
        hdr[str(4 + i)] = f"{y}년"
    data = {"0": hdr}
    for j, r in enumerate(rows, 1):
        g = {"0": str(j), "1": r.get("CATE1", ""), "2": r.get("CATE2", ""), "3": r.get("CATE3", "")}
        for i, y in enumerate(yrs):
            g[str(4 + i)] = r.get(ycol[y], "")
        data[str(j)] = g
    return {"sheet": {"1": {"dataRows": str(len(rows)), "sheetName": None, "data": data}}}, yrs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/raw/_rone_dl")
    ap.add_argument("--years", type=int, default=12, help="최근 N개년(기본 12)")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    rows = fetch(a.years)
    grid, yrs = to_grid(rows)
    dst = os.path.join(a.out, OUT_NAME)
    json.dump(grid, open(dst, "w", encoding="utf-8"), ensure_ascii=False)
    seoul = sum(1 for r in rows if r.get("CATE1") == "서울" and r.get("CATE2") != "서울")
    print(f"  ✓ 지역별 지가변동률 {len(rows)}행(서울 {seoul}구) · {yrs[0]}~{yrs[-1]} → {OUT_NAME}")


if __name__ == "__main__":
    main()
