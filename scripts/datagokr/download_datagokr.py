"""공공데이터포털(data.go.kr) 파일데이터 자동 다운로드 — 키·로그인 불필요.

흐름(브라우저 재현): 데이터셋 페이지에서 fn_fileDataDown(publicDataPk, publicDataDetailPk) 추출
→ selectFileDataDownload.do(ajax)로 atchFileId·fileDetailSn 획득 → cmm/cmm/fileDownload.do 다운로드.
    data/.venv/bin/python scripts/datagokr/download_datagokr.py [--out DIR] [--only 15112638,...]
근거: specs/07-architecture/04-데이터-출처-크롤링-레지스트리.
"""
import os
import re
import sys
import json
import argparse
import urllib.parse
import urllib.request
import http.cookiejar

BASE = "https://www.data.go.kr"
# 세션 공유: ajax가 세션에 다운로드를 예약하므로 페이지→ajax→다운로드가 같은 쿠키를 써야 함
_OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
DATASETS = {
    "15112638": "승강기 설치현황",
    # 소상공인시장진흥공단 상가(상권)정보 — 분기. 전국 zip 안에 시도별 CSV. activate 가 서울만 _sbiz 로 옮긴다(2026-09-07)
    "15083033": "소상공인 상가(상권)정보",
    # 부동산원 상권 구획도 — 임대추정의 건물↔상권 매칭(72칸). 원본 폴더가 유실돼 백업이 원천이던 것을
    # 되돌린다(2026-09-07). 페이지가 폼 필드 꼴이라 resolve() 를 양쪽 다 읽게 고쳤다
    "15086933": "상권 구획도(부동산원)",
    "15103145": "상업용부동산 임대동향조사 통계표",
    "15086933": "상권 구획도(전국 17개시도)",
}


def _open(url, data=None):
    body = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers={"User-Agent": "Mozilla/5.0", "Referer": BASE + "/"})
    return _OPENER.open(req, timeout=180)


def resolve(pk):
    """페이지 → publicDataPk/DetailPk → ajax → (atchFileId, fileDetailSn)."""
    html = _open(f"{BASE}/data/{pk}/fileData.do").read().decode("utf-8", "replace")
    # 두 가지 꼴이 있다: 함수 호출 fn_fileDataDown('15112638','uddi:…') 과
    # 폼 필드 <input name="publicDataPk" value="15086933"> (상권 구획도 15086933 이 후자다 · 2026-09-07)
    m = re.search(r"fn_fileDataDown\('(\d+)',\s*'([^']+)'", html)
    if m:
        dpk, ddpk = m.groups()
    else:
        a = re.search(r'name="publicDataPk"\s+value="([^"]+)"', html)
        b = re.search(r'name="publicDataDetailPk"\s+value="([^"]+)"', html)
        if not (a and b):
            return None
        dpk, ddpk = a.group(1), b.group(1)
    j = json.loads(_open(f"{BASE}/tcs/dss/selectFileDataDownload.do?recommendDataYn=Y",
                         {"publicDataPk": dpk, "publicDataDetailPk": ddpk}).read().decode("utf-8", "replace"))
    if not j.get("atchFileId"):
        return None
    return j["atchFileId"], str(j.get("fileDetailSn", "1"))


def _fname(resp, pk):
    cd = resp.headers.get("Content-Disposition", "")
    m = re.search(r'filename="?([^"]+)"?', cd)
    if not m:
        return f"{pk}.bin"
    name = m.group(1)
    try:                       # 헤더가 latin1로 읽힌 UTF-8 파일명 복원
        name = name.encode("latin1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    return name


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/raw/_datagokr_dl")
    ap.add_argument("--only")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    ids = a.only.split(",") if a.only else list(DATASETS)
    for pk in ids:
        r = resolve(pk)
        if not r:
            print(f"  [{pk}] {DATASETS.get(pk, '')}: ✗ atchFileId 못 찾음")
            continue
        fid, sn = r
        resp = _open(f"{BASE}/cmm/cmm/fileDownload.do?atchFileId={fid}&fileDetailSn={sn}")
        data = resp.read()
        name = _fname(resp, pk)
        open(os.path.join(a.out, name), "wb").write(data)
        print(f"  [{pk}] {DATASETS.get(pk, '')}: ✓ {name} ({len(data)//1024:,}KB)")


if __name__ == "__main__":
    main()
