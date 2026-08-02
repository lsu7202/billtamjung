"""V-World 서울 SHP 자동 다운로드 (로그인 세션 쿠키 필요).

V-World 대량 다운로드는 로그인 세션이 필요하다. 자동화 방식:
  1) 브라우저에서 V-World 로그인 → 아무 파일이나 다운로드하며 F12 Network → 요청 'Copy as cURL'
  2) 그 cURL의 -b '쿠키문자열'만 파일로 저장 (예: scripts/vworld/cookie.txt, .gitignore)
  3) 실행:
       VW_COOKIE_FILE=scripts/vworld/cookie.txt \
       data/.venv/bin/python scripts/vworld/download_vworld.py --out data/raw/_vworld_dl [--only 30300,30305]

각 데이터셋 파일목록 페이지(서울 검색)에서 '*_5174_서울.zip' 행의 fileNo를 자동 탐색해
downloadResourceFile.do 로 받는다(fileNo는 재발행 때 바뀌므로 하드코딩 안 함).
쿠키는 세션이라 만료되면 재발급. 근거: specs/07-architecture/04-데이터-출처-크롤링-레지스트리.
⚠️ 이 레이어들은 CC BY-NC-ND(비영리) — 상업 이용 가능 여부 확인 후 사용.
"""
import os
import re
import sys
import argparse
import urllib.parse
import urllib.request

BASE = "https://www.vworld.kr/dtmk"
# dsId: 라벨 (전부 LSMD_CONT_*_5174_서울 패턴)
DATASETS = {
    "30300": "용도지역(UQ111)",
    "30261": "개발제한(UD801)",
    "30287": "경관지구(UQ121)",
    "30288": "고도지구(UQ123)",
    "30305": "방화지구(UQ124)",
    "30335": "정비구역(UD602)",
    "30337": "재정비촉진(UD603)",
    "30342": "문화재보존(UO301)",
    "30564": "연속지적도(LDREG)",
}
PICK = "_5174_서울.zip"   # 정확히 전체 '서울' 5174 파일(예: LSMD_CONT_LDREG_5174_서울_중랑구.zip 같은 구단위 제외)


def _cookie():
    p = os.environ.get("VW_COOKIE_FILE")
    if not p or not os.path.exists(p):
        sys.exit("VW_COOKIE_FILE 환경변수에 쿠키파일 경로 필요 (브라우저 로그인 세션 쿠키)")
    return open(p, encoding="utf-8").read().strip()


def _get(url, cookie, binary=False):
    req = urllib.request.Request(url, headers={
        "Cookie": cookie, "User-Agent": "Mozilla/5.0", "Referer": BASE + "/dtmk_ntads_s001.do"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read() if binary else r.read().decode("utf-8", "replace")


def find_fileno(dsid, cookie):
    """데이터셋 서울 검색 페이지에서 '*_5174_서울.zip' 행의 fileNo 반환."""
    q = urllib.parse.urlencode({"dsId": dsid, "svcCde": "MK",
                                "searchKeyword2": "서울", "datPageSize": "100", "datPageIndex": "1"})
    html = _get(f"{BASE}/dtmk_ntads_s002.do?{q}", cookie)
    # 각 다운로드 버튼: listFnc.download('dsId','fileNo','sizeKB') + 앞쪽에 zip 파일명
    for m in re.finditer(r"listFnc\.download\(\s*'\d+'\s*,\s*'(\d+)'\s*,\s*'(\d+)'\s*\)", html):
        fno = m.group(1)
        ctx = html[max(0, m.start() - 600):m.start()]
        zips = re.findall(r"[가-힣A-Za-z0-9_\.\-]+\.zip", ctx)
        if zips and zips[-1].endswith(PICK):
            return fno, zips[-1]
    return None, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/raw/_vworld_dl")
    ap.add_argument("--only", help="쉼표구분 dsId만")
    args = ap.parse_args()
    cookie = _cookie()
    os.makedirs(args.out, exist_ok=True)
    ids = args.only.split(",") if args.only else list(DATASETS)
    for dsid in ids:
        label = DATASETS.get(dsid, dsid)
        fno, zipname = find_fileno(dsid, cookie)
        if not fno:
            print(f"  [{dsid}] {label}: ✗ 5174_서울 파일 못 찾음(로그인 만료?)")
            continue
        data = _get(f"{BASE}/downloadResourceFile.do?ds_id={dsid}&fileNo={fno}", cookie, binary=True)
        if data[:2] != b"PK":   # zip 시그니처
            print(f"  [{dsid}] {label}: ✗ zip 아님({len(data)}B, 로그인 만료 가능)")
            continue
        dest = os.path.join(args.out, zipname)
        open(dest, "wb").write(data)
        print(f"  [{dsid}] {label}: ✓ {zipname} ({len(data)//1024:,}KB) fileNo={fno}")


if __name__ == "__main__":
    main()
