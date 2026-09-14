"""서울시 상권분석서비스(영역-상권) SHP 자동 다운로드 — 키·로그인 불필요.

**무엇에 쓰나.** 지금 쓰는 부동산원 상권(`master.sanggwon`)은 서울을 72칸으로만 나눠서,
같은 칸 안 건물이 전부 같은 값을 받는다. 이 데이터는 1,650칸이고 **유형을 구분한다**
(전통시장 305 · 발달상권 249 · 골목상권 1,090 · 관광특구 6).
전통시장이 폴리곤이라 「이 건물이 시장 안인가」를 직접 판정할 수 있다.

**받는 법.** 데이터셋 페이지가 치는 파일 다운로드를 그대로 재현한다:
  ① `dataList/{OA}/S/1/datasetView.do` 에서 `downloadFile(seq)` 의 seq 와
     `frmFile` 의 히든값(infId·infSeq)을 긁는다.
  ② `datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do` 로 POST.
seq·infSeq 는 갱신 때 바뀔 수 있어 **박아 두지 않고 페이지에서 읽는다.**
교통 데이터(`download_transit.py`)와 다른 엔드포인트다 — 그쪽은 JSON 시트, 이쪽은 첨부파일이다.

    data/.venv/bin/python scripts/seoul_open/download_trade_area.py [--out DIR]
근거: specs/07-architecture/04-데이터-출처-크롤링-레지스트리 · 공공누리 1유형(출처표시).
"""
import argparse
import os
import re
import urllib.parse
import urllib.request

OA = "OA-15560"
VIEW = f"https://data.seoul.go.kr/dataList/{OA}/S/1/datasetView.do"
DL = "https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false"
UA = {"User-Agent": "Mozilla/5.0"}


def find_file(html):
    """(seq, infId, infSeq, 파일명) — 페이지에서 읽는다. 번호를 박으면 갱신 때 조용히 깨진다."""
    m = re.search(r"downloadFile\(\s*'?(\d+)'?\s*\)", html)
    seq = m.group(1) if m else None
    f = re.search(r'<form[^>]*name="frmFile".*?</form>', html, re.S)
    hid = dict(re.findall(r'name="(\w+)"[^>]*value="([^"]*)"', f.group(0))) if f else {}
    nm = re.search(r"([^\s>]+\.zip)", re.sub(r"<[^>]+>", " ", html))
    return seq, hid.get("infId", OA), hid.get("infSeq", ""), (nm.group(1) if nm else f"{OA}.zip")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/raw/_trade_area_dl")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    html = urllib.request.urlopen(urllib.request.Request(VIEW, headers=UA), timeout=120).read().decode("utf-8", "ignore")
    seq, inf_id, inf_seq, name = find_file(html)
    if not seq:
        print("✗ 다운로드 링크를 못 찾았습니다(페이지 구조 변경?)")
        raise SystemExit(1)

    body = urllib.parse.urlencode({"seq": seq, "infId": inf_id, "infSeq": inf_seq}).encode()
    req = urllib.request.Request(DL, data=body, headers={**UA, "Referer": VIEW})
    data = urllib.request.urlopen(req, timeout=600).read()
    ok = data[:2] == b"PK"          # zip 인가 — 로그인 페이지가 돌아오면 HTML 이다
    path = os.path.join(a.out, name)
    open(path, "wb").write(data)
    print(f"  {'✓' if ok else '✗'} {name} ({len(data)//1024:,}KB) seq={seq} infSeq={inf_seq}")
    if not ok:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
