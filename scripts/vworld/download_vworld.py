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
# NA 카탈로그(무상공급) = 시군구별 다중 파일. dsId(페이지) → 라벨. 다운로드 ds_id는 행마다 문자열(dsFileId).
NA = {"4": "토지특성(AL_D194, 서울 25구)", "6": "공시지가(AL_D150, 서울)"}
# MISC = LSMD 패턴('_5174_서울.zip')이 아닌 MK 레이어(전국 단일 SHP). 최대 파일(SHP본) 선택.
MISC = {"30115": "지구단위계획(C_UQ161)"}


def _cookie():
    """쿠키 획득 우선순위: ① VW_COOKIE_FILE(수동) → ② VW_ID/VW_PW 자동로그인."""
    p = os.environ.get("VW_COOKIE_FILE")
    if p and os.path.exists(p):
        return open(p, encoding="utf-8").read().strip()
    if os.environ.get("VW_ID") or os.environ.get("VWORLD_ID"):
        from login import get_cookie          # 같은 디렉토리(scripts/vworld)
        return get_cookie(save_to=p)           # p 있으면 캐시 저장
    sys.exit("V-World 쿠키 없음: VW_COOKIE_FILE(수동) 또는 VW_ID/VW_PW(자동로그인) 필요")


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


def find_na_seoul(dsid, cookie):
    """NA 카탈로그 페이지에서 sigunguNm1='서울' 행의 (dsFileId, fileNo) 전부."""
    q = urllib.parse.urlencode({"dsId": dsid, "svcCde": "NA", "searchKeyword2": "서울",
                                "datPageSize": "200", "datPageIndex": "1"})
    html = _get(f"{BASE}/dtmk_ntads_s002.do?{q}", cookie)
    out = []
    for m in re.finditer(r"listFnc\.download\(\s*'([^']+)'\s*,\s*'(\d+)'\s*,\s*'(\d+)'\s*\)", html):
        ds, fno, _ = m.groups()
        ctx = html[max(0, m.start() - 750):m.start()]
        sido = re.search(r"sigunguNm1[^>]*>\s*([^<]+)", ctx)
        if sido and "서울" in sido.group(1):
            out.append((ds, fno))
    return out


def find_largest(dsid, cookie):
    """상세 페이지에서 listFnc.download('dsId','fileNo','sizeKB') 중 최대 크기 fileNo(=SHP본)."""
    html = _get(f"{BASE}/dtmk_ntads_s002.do?dsId={dsid}&svcCde=MK", cookie)
    best = None
    for m in re.finditer(r"listFnc\.download\(\s*'%s'\s*,\s*'(\d+)'\s*,\s*'(\d+)'\s*\)" % dsid, html):
        fno, kb = int(m.group(1)), int(m.group(2))
        if best is None or kb > best[1]:
            best = (fno, kb)
    return (str(best[0]) if best else None)


def _download(ds_id, fno, cookie):
    req = urllib.request.Request(f"{BASE}/downloadResourceFile.do?ds_id={ds_id}&fileNo={fno}",
                                 headers={"Cookie": cookie, "User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=300) as r:
        cd = r.headers.get("Content-Disposition", "")
        fn = re.search(r'filename="?([^";]+)', cd)
        return r.read(), (fn.group(1) if fn else f"{ds_id}_{fno}.zip")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/raw/_vworld_dl")
    ap.add_argument("--only", help="쉼표구분 dsId만")
    ap.add_argument("--na", action="store_true", help="NA 카탈로그(토지특성·공시지가, 시군구 다중파일)")
    ap.add_argument("--misc", action="store_true", help="비LSMD MK 레이어(지구단위계획 등, 최대파일=SHP)")
    args = ap.parse_args()
    cookie = _cookie()
    os.makedirs(args.out, exist_ok=True)
    if args.misc:
        ids = args.only.split(",") if args.only else list(MISC)
        for dsid in ids:
            fno = find_largest(dsid, cookie)
            if not fno:
                print(f"  [{dsid}] {MISC.get(dsid, dsid)}: ✗ 파일 못 찾음(로그인 만료?)")
                continue
            data, name = _download(dsid, fno, cookie)
            ok = data[:2] == b"PK"
            open(os.path.join(args.out, name), "wb").write(data)
            print(f"  [{dsid}] {MISC.get(dsid, dsid)}: {'✓' if ok else '✗'} {name} ({len(data)//1024:,}KB) fileNo={fno}")
        return
    if args.na:
        ids = args.only.split(",") if args.only else list(NA)
        for dsid in ids:
            files = find_na_seoul(dsid, cookie)
            print(f"[{dsid}] {NA.get(dsid, dsid)}: 서울 {len(files)}개 파일")
            for ds, fno in files:
                data, name = _download(ds, fno, cookie)
                ok = data[:2] == b"PK"
                open(os.path.join(args.out, name), "wb").write(data)
                print(f"    {'✓' if ok else '✗'} {name} ({len(data)//1024:,}KB)")
        return
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
