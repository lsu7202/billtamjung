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
# 기본 수집 대상 = **건축물대장 10종 전부**(2026-08-31).
#
# 예전엔 「파이프라인이 실제 소비하는 것만」 4종을 받았다. 그 판단이 틀렸다 —
# 우리가 지금 안 쓴다는 건 우리 사정이지 대장의 사정이 아니고, 안 받아 두면
# 나중에 필요할 때 그 시점의 대장을 못 구한다(마트는 최신월만 내려준다).
# 실제로 전유부(0309)를 안 받아서, 부속지번이 가리키는 전유부 PK 488개가
# 갈 곳 없는 미아로 떠 있었다.
#
#   djy_01 기본개요 · 02 총괄표제부 · 03 표제부 · 04 층별개요 · 05 부속지번
#   djy_06 전유공용면적 · 07 오수정화시설 · 08 공동주택가격 · 09 전유부 · 10 지역지구구역
#   kcy_01 건축인허가 기본개요 → build_daesuseon 이 건축구분으로 대수선 재구성
#
# 칸 뜻은 짐작하지 않는다 — scripts/hub/fetch_layout.py 가 HUB 에서 정의서를 받아
# data/raw/_hub_layout/task{03,01}.json 에 둔다. 그게 정본이다.
DEFAULT = ["djy_01", "djy_02", "djy_03", "djy_04", "djy_05",
           "djy_06", "djy_07", "djy_08", "djy_09", "djy_10", "kcy_01"]

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
