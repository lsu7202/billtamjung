"""서울 생활인구(250m 격자) 자동 다운로드 — 키·로그인 불필요.

[내국인] 서울 생활인구(250m) · OA-22784 · 서울특별시 · 공공누리 1유형(출처표시).
브라우저의 '파일 다운로드'가 치는 엔드포인트를 그대로 재현한다:
    POST datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false
         infId=OA-22784 & seq=YYMMDD & infSeq=1
seq 는 **연도 뒤 두 자리**다(2026-08-17 → 260817). 하루치 zip 이 약 14.8MB,
푼 CSV 는 58MB · 25만 행(격자 8,558 × 24시간) · CP949.

데이터는 4일 뒤 공개된다 — 오늘 기준으로 받으면 빈손이라 기본 시작을 5일 전으로 둔다.
요일 편차가 있어 최소 한 주를 받아야 평균이 뜻을 갖는다.

    data/.venv/bin/python scripts/seoul_open/download_living_pop.py [--days 7] [--out DIR]
근거: specs/07-architecture/04-데이터-출처-크롤링-레지스트리.
"""
import os
import sys
import argparse
import datetime as dt
import urllib.request
import urllib.parse

OA = "OA-22784"
DL = "https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false"
LAG = 5           # 공개 지연 4일 + 하루 여유


def fetch(day: dt.date, out: str) -> tuple[str, int] | None:
    seq = day.strftime("%y%m%d")
    name = f"250_LOCAL_RESD_{day:%Y%m%d}.zip"
    path = os.path.join(out, name)
    if os.path.exists(path) and os.path.getsize(path) > 1_000_000:
        return name, os.path.getsize(path)          # 이미 받은 날은 건너뛴다
    body = urllib.parse.urlencode({"infId": OA, "seq": seq, "infSeq": "1"}).encode()
    req = urllib.request.Request(DL, data=body, headers={
        "User-Agent": "Mozilla/5.0",
        "Referer": f"https://data.seoul.go.kr/dataList/{OA}/S/1/datasetView.do",
        "Content-Type": "application/x-www-form-urlencoded",
    })
    raw = urllib.request.urlopen(req, timeout=600).read()
    # 없는 날짜는 HTML 오류쪽을 돌려준다 — zip 머리로 가른다(조용히 틀린 파일을 남기지 않는다)
    if not raw.startswith(b"PK"):
        return None
    open(path, "wb").write(raw)
    return name, len(raw)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7, help="며칠치(기본 한 주)")
    ap.add_argument("--out", default="data/raw/_living_pop")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    end = dt.date.today() - dt.timedelta(days=LAG)
    got = 0
    for i in range(a.days):
        day = end - dt.timedelta(days=i)
        try:
            r = fetch(day, a.out)
        except Exception as e:                        # 한 날 실패가 나머지를 막지 않는다
            print(f"  ✗ {day} — {e}")
            continue
        if r is None:
            print(f"  ⏭  {day} — 아직 공개 안 됨")
            continue
        print(f"  ✓ {r[0]} — {r[1] / 1e6:.1f}MB")
        got += 1
    print(f"생활인구 {got}/{a.days}일 · {a.out}")
    return 0 if got else 1


if __name__ == "__main__":
    sys.exit(main())
