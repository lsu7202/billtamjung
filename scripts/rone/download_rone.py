"""한국부동산원 R-ONE 자동 다운로드 — 키·로그인 불필요(세션쿠키만).

상업용부동산 임대동향조사 통계표(xlsx)를 게시판(RPT)에서 최신분으로 받는다.
흐름(브라우저 재현):
  1) 목록 POST bbs/rpt/searchBulletin.do (bbsCd=RPT) → bbsTit에 '상업용부동산 임대동향조사' 포함
     & noticeYn=N 중 최상단(=최신 seq) 선택
  2) 상세 POST bbs/rpt/selectBulletin.do (bbsCd=RPT&seq) → files[0].fileSeq
  3) 다운로드 GET bbs/rpt/downloadAttachFile.do?fileSeq={n}&seq={n} → xlsx
실검증(2026-08-02): seq=3950(2026년 2분기) fileSeq=4870, xlsx 13.7MB.

    data/.venv/bin/python scripts/rone/download_rone.py [--out DIR]
근거: specs/07-architecture/04-데이터-출처-크롤링-레지스트리.
"""
import os
import re
import json
import argparse
import urllib.parse
import urllib.request
import http.cookiejar

BASE = "https://www.reb.or.kr/r-one/portal/bbs/rpt"
KEYWORD = "상업용부동산 임대동향조사"

_JAR = http.cookiejar.CookieJar()
_OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_JAR))


def _open(url, data=None):
    body = urllib.parse.urlencode(data, encoding="utf-8").encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers={
        "User-Agent": "Mozilla/5.0", "Referer": BASE + "/searchBulletinPage.do"})
    return _OPENER.open(req, timeout=180)


def latest_seq():
    """게시판에서 임대동향조사 최신(비공지 최상단) seq 탐색."""
    _open(BASE + "/searchBulletinPage.do")           # 세션(JSESSIONID) 프라이밍
    j = json.loads(_open(BASE + "/searchBulletin.do",
                         {"bbsCd": "RPT", "page": "1", "rows": "50",
                          "searchType": "", "searchWord": ""}).read().decode("utf-8", "replace"))
    for r in j.get("data", []):
        if r.get("noticeYn") == "N" and KEYWORD in (r.get("bbsTit") or ""):
            return r["seq"], r["bbsTit"]
    return None, None


def file_of(seq):
    """상세에서 (fileSeq, viewFileNm, ext) 반환."""
    j = json.loads(_open(BASE + "/selectBulletin.do",
                         {"bbsCd": "RPT", "seq": str(seq)}).read().decode("utf-8", "replace"))
    files = (j.get("data") or {}).get("files") or []
    if not files:
        return None
    f = files[0]
    return f["fileSeq"], f.get("viewFileNm", f"rpt_{seq}"), f.get("fileExt", "xlsx")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/raw/_rone_dl")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    seq, title = latest_seq()
    if not seq:
        print("  ✗ 임대동향조사 게시글 못 찾음")
        return
    info = file_of(seq)
    if not info:
        print(f"  ✗ seq={seq}({title}) 첨부 없음")
        return
    file_seq, view_nm, ext = info
    resp = _open(f"{BASE}/downloadAttachFile.do?fileSeq={file_seq}&seq={seq}")
    data = resp.read()
    name = f"{view_nm}.{ext}"
    open(os.path.join(a.out, name), "wb").write(data)
    print(f"  ✓ seq={seq} · {title} → {name} ({len(data)//1024:,}KB)")


if __name__ == "__main__":
    main()
