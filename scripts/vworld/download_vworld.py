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
NA = {"4": "토지특성(AL_D194, 서울 25구)", "6": "공시지가(AL_D150, 서울)",
      # 필지별 용도지역·지구 **원장**(토지이음이 보여주는 그 표). 폴리곤 교차로는
      # 못 맞추는 필지가 남아서 원장을 정본으로 쓴다(2026-08-28).
      "14": "토지이용계획정보(KLIP, 서울 25구)"}
# MISC = LSMD 패턴('_5174_서울.zip')이 아닌 MK 레이어(전국 단일 SHP). 최대 파일(SHP본) 선택.
MISC = {"30115": "지구단위계획(C_UQ161)"}
# SIDO = 시도별로 쪼개 올리는 MK 레이어. **파일명으로** 서울을 고른다(2026-08-30).
# 최대 파일(MISC)로는 못 고른다 — 서울(12MB)보다 충남(41MB)이 크다.
# fileNo 는 갱신 때마다 바뀌므로 번호를 박아 두지 않는다.
SIDO = {"30055": ("도로명주소 도로구간", "(도로명주소)도로구간_서울.zip")}


def _alive(cookie):
    """이 쿠키로 **실제로 파일이 받아지는가.** 만료된 세션도 페이지는 정상으로 내주고
    다운로드만 0바이트를 준다 — 그래서 페이지 조회로는 못 가린다(2026-08-30 실측)."""
    try:
        req = urllib.request.Request(
            f"{BASE}/downloadResourceFile.do?ds_id=30305&fileNo=33",
            headers={"Cookie": cookie, "User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read(2) == b"PK"
    except Exception:
        return False


def _cookie():
    """쿠키 획득: ① VW_COOKIE_FILE 이 **살아 있으면** 그것 → ② VW_ID/VW_PW 자동로그인.

    예전엔 파일이 있기만 하면 무조건 썼다. 그래서 8/28 자 쿠키가 만료된 뒤로 모든 다운로드가
    **0바이트를 받고도 성공처럼 지나갔다.** 자동로그인 자격증명이 멀쩡히 있는데도 그랬다.
    이제 한 번 받아 보고 죽었으면 다시 로그인한다."""
    p = os.environ.get("VW_COOKIE_FILE")
    has_creds = os.environ.get("VW_ID") or os.environ.get("VWORLD_ID")
    if p and os.path.exists(p):
        ck = open(p, encoding="utf-8").read().strip()
        if _alive(ck):
            return ck
        print("  ℹ️ 저장된 쿠키가 만료됐습니다 — 다시 로그인합니다")
        if not has_creds:
            sys.exit("쿠키 만료 · VW_ID/VW_PW 가 없어 갱신할 수 없습니다")
    if has_creds:
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


def find_sido(dsid, want, cookie):
    """시도별 목록에서 **파일명이 want 인 행**의 fileNo. 페이지가 2쪽이면 둘 다 본다."""
    for page in ("1", "2"):
        q = urllib.parse.urlencode({"dsId": dsid, "svcCde": "MK",
                                    "datPageSize": "200", "datPageIndex": page})
        html = _get(f"{BASE}/dtmk_ntads_s002.do?{q}", cookie)
        for m in re.finditer(r"listFnc\.download\(\s*'%s'\s*,\s*'(\d+)'\s*,\s*'(\d+)'\s*\)" % dsid, html):
            fno = m.group(1)
            # 파일명은 버튼 **앞쪽** 표 칸에 있다 — 태그를 걷어내고 이름을 찾는다
            seg = re.sub(r"<[^>]+>", " ", html[max(0, m.start() - 1200):m.start()])
            if want in " ".join(seg.split()):
                return fno
    return None


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
        name = fn.group(1) if fn else f"{ds_id}_{fno}.zip"
        # 헤더는 latin-1 로 읽힌다(HTTP 규격) — 한글 파일명이 깨져 나온다.
        # 되돌려 UTF-8 로 읽는다. 실패하면 원문 그대로 둔다(영문 파일명은 그대로 맞다).
        try:
            name = name.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
        return r.read(), name


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/raw/_vworld_dl")
    ap.add_argument("--only", help="쉼표구분 dsId만")
    ap.add_argument("--na", action="store_true", help="NA 카탈로그(토지특성·공시지가, 시군구 다중파일)")
    ap.add_argument("--misc", action="store_true", help="비LSMD MK 레이어(지구단위계획 등, 최대파일=SHP)")
    ap.add_argument("--sido", action="store_true", help="시도별로 쪼갠 MK 레이어(도로구간 등, 파일명=서울)")
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
    if args.sido:
        ids = args.only.split(",") if args.only else list(SIDO)
        for dsid in ids:
            label, want = SIDO[dsid]
            fno = find_sido(dsid, want, cookie)
            if not fno:
                print(f"  [{dsid}] {label}: ✗ '{want}' 못 찾음(로그인 만료? 파일명 변경?)")
                continue
            data, name = _download(dsid, fno, cookie)
            ok = data[:2] == b"PK"
            open(os.path.join(args.out, name), "wb").write(data)
            print(f"  [{dsid}] {label}: {'✓' if ok else '✗'} {name} ({len(data)//1024:,}KB) fileNo={fno}")
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
