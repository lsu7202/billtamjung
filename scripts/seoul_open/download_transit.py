"""서울 열린데이터광장 대중교통 데이터 자동 다운로드 — 키·로그인 불필요.

역사마스터(OA-21232)·버스정류소 위치정보(OA-15067)를 전체 JSON(DESCRIPTION+DATA)으로 받는다.
브라우저의 '데이터 미리보기 → 전체 다운로드'가 치는 bigfile 엔드포인트를 재현:
  GET datafile.seoul.go.kr/bigfile/iot/sheet/json/download.do
      ?srvType=S&serviceKind=1&infId={OA}&gridTotalCnt={넉넉히}&ssUserId=SAMPLE_VIEW
gridTotalCnt은 실제 행수 이상이면 됨(초과해도 실제치로 반환). 실검증: 역사 784행·버스 11,248행.

    data/.venv/bin/python scripts/seoul_open/download_transit.py [--out DIR]
근거: specs/07-architecture/04-데이터-출처-크롤링-레지스트리.
"""
import os
import json
import argparse
import urllib.request

DL = "https://datafile.seoul.go.kr/bigfile/iot/sheet/json/download.do"
DATASETS = {
    "OA-21232": "서울시 역사마스터 정보",
    "OA-15067": "서울시 버스정류소 위치정보",
}


def download(oa, out):
    url = (f"{DL}?srvType=S&serviceKind=1&infId={oa}"
           f"&gridTotalCnt=1000000&ssUserId=SAMPLE_VIEW")
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0",
        "Referer": f"https://data.seoul.go.kr/dataList/{oa}/S/1/datasetView.do",
    })
    raw = urllib.request.urlopen(req, timeout=300).read()
    rows = len(json.loads(raw).get("DATA", []))
    name = DATASETS[oa] + ".json"
    open(os.path.join(out, name), "wb").write(raw)
    return name, rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/raw/_transit_dl")
    ap.add_argument("--only", help="쉼표목록 예: OA-21232")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    ids = a.only.split(",") if a.only else list(DATASETS)
    for oa in ids:
        name, rows = download(oa, a.out)
        print(f"  [{oa}] {DATASETS.get(oa,'')}: ✓ {name} ({rows:,}행)")


if __name__ == "__main__":
    main()
