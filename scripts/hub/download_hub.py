"""건축HUB 대용량 데이터 자동 다운로드 — 키 불필요(세션쿠키+CSRF만).

흐름(브라우저 재현):
  1) 목록 GET idx-lgcpt-pvsn-srvc-list.do?opnLgcptTaskSeCd={업무}&pageCountPerPage=100
     → 각 행 onclick="fnDownloadPop('{업무}','{서비스코드}','{srvrFileNm}')" 파싱(월별 다건 → 최신 선택)
  2) 다운로드 POST /cmm/fms/fileOpnDown.do  srvrFileNm={OPN..}&_csrf={t}  → zip(안에 mart_*.txt)
     (사이트는 다운 전 idx-srvc-hstry-insert.do 활용목적 로그를 남기지만 다운로드엔 불필요)

매핑(실검증 2026-08-02): mart_djy_NN ↔ 업무 03(건축물대장) 서비스 03NN · mart_kcy_NN ↔ 업무 01(건축인허가) 서비스 01NN.
  예) djy_02=총괄표제부(0302)·djy_03=표제부·djy_04=층별개요·djy_05=부속지번 / kcy_05=대수선(0105)·kcy_12=전유공용면적(0112).
  zip 파일명·내부 txt명 모두 HUB가 mart_{kcy|djy}_NN.txt 로 제공(전국 단위 → 서울 필터는 별도 빌드).

    data/.venv/bin/python scripts/hub/download_hub.py [--out DIR] [--only djy_02,djy_03,kcy_05]
근거: specs/07-architecture/04-데이터-출처-크롤링-레지스트리.
"""
import os
import re
import sys
import argparse
import urllib.parse
import urllib.request
import http.cookiejar

BASE = "https://www.hub.go.kr"
LIST = BASE + "/portal/opn/lps/idx-lgcpt-pvsn-srvc-list.do"
DOWN = BASE + "/cmm/fms/fileOpnDown.do"
# 접두어별 업무코드 (djy=건축물대장, kcy=건축인허가) — 서비스코드 = {업무}{두자리}
TASK = {"djy": "03", "kcy": "01"}
# 기본 수집 대상 = 파이프라인이 실제 소비하는 것만(감사 확정):
#   djy_02 총괄표제부·djy_03 표제부·djy_04 층별개요·djy_05 부속지번 → seoul 추출본 사용
#   kcy_01 건축인허가 기본개요 → 전국본 그대로 사용(build_daesuseon이 건축구분으로 대수선 재구성)
# (kcy_05 대수선 원본은 프로젝트에서 폐기: build_daesuseon 주석 'idx15 kcy_05 폐기')
DEFAULT = ["djy_02", "djy_03", "djy_04", "djy_05", "kcy_01"]

_JAR = http.cookiejar.CookieJar()
_OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_JAR))


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": BASE + "/"})
    return _OPENER.open(req, timeout=300)


def _post(url, data):
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, headers={"User-Agent": "Mozilla/5.0", "Referer": LIST})
    return _OPENER.open(req, timeout=600)


def _csrf(html):
    m = re.search(r'name="_csrf"[^>]*value="([^"]+)"', html)
    return m.group(1) if m else None


def latest_srvr(task, svc):
    """업무 목록에서 서비스코드(svc)의 최신 srvrFileNm(OPN..) 반환. 목록은 최신월이 먼저."""
    html = _get(f"{LIST}?opnLgcptTaskSeCd={task}&pageCountPerPage=100").read().decode("utf-8", "replace")
    for m in re.finditer(r"fnDownloadPop\('%s','(%s\d\d)','(OPN\d+)'\)" % (task, task), html):
        if m.group(1) == svc:
            return m.group(2), _csrf(html)   # 첫 매치 = 최신월
    return None, _csrf(html)


def _fname(resp, fallback):
    cd = resp.headers.get("Content-Disposition", "")
    m = re.search(r"filename=([^;]+)", cd)
    if not m:
        return fallback
    return urllib.parse.unquote(m.group(1).strip().strip('"'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/raw/_hub_dl")
    ap.add_argument("--only", help="쉼표목록 예: djy_02,kcy_05 (기본=레지스트리 대상)")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    targets = a.only.split(",") if a.only else DEFAULT
    for key in targets:
        pre, num = key.split("_")
        task, svc = TASK[pre], TASK[pre] + num
        srvr, csrf = latest_srvr(task, svc)
        if not srvr:
            print(f"  [{key}] ✗ 서비스 {svc} 목록에서 못 찾음")
            continue
        resp = _post(DOWN, {"srvrFileNm": srvr, "_csrf": csrf})
        data = resp.read()
        name = _fname(resp, f"{key}.zip")
        open(os.path.join(a.out, name), "wb").write(data)
        print(f"  [{key}] ✓ {srvr} → {name} ({len(data)//1024:,}KB)")


if __name__ == "__main__":
    main()
