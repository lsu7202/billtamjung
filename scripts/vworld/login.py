"""V-World 자동 로그인 → 세션 쿠키 획득 (수동 cookie.txt 대체).

로그인 폼(common_login.js)은 비밀번호를 **Base64 인코딩만** 함(암호화·캡차 없음):
  POST https://www.vworld.kr/v4po_usrlogin_a004.do
       usrIdeE=base64(아이디) & usrPwdE=base64(비번) & nextUrl=/
  → JSON {resultMap:{result:'success'|'error'}}, 세션쿠키(JSESSIONID 등) 발급.

자격증명: 환경변수 VW_ID / VW_PW (또는 VWORLD_ID / VWORLD_PW).
사용:
  from scripts.vworld.login import get_cookie
  cookie = get_cookie()                         # 'JSESSIONID=..; ..' 헤더 문자열
  cookie = get_cookie(save_to='scripts/vworld/cookie.txt')   # 파일로도 저장(선택)
근거: specs/07-architecture/04-데이터-출처-크롤링-레지스트리.
"""
import os
import sys
import json
import base64
import urllib.parse
import urllib.request
import http.cookiejar

LOGIN_URL = "https://www.vworld.kr/v4po_usrlogin_a004.do"
HOME = "https://www.vworld.kr/dtmk/dtmk_ntads_s001.do"


def _creds():
    uid = os.environ.get("VW_ID") or os.environ.get("VWORLD_ID")
    pw = os.environ.get("VW_PW") or os.environ.get("VWORLD_PW")
    if not uid or not pw:
        sys.exit("자동로그인: 환경변수 VW_ID / VW_PW (V-World 계정) 필요")
    return uid, pw


def get_cookie(save_to=None):
    """V-World 로그인 후 세션 쿠키 헤더 문자열 반환. 실패 시 SystemExit."""
    uid, pw = _creds()
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    opener.addheaders = [("User-Agent", "Mozilla/5.0"), ("Referer", LOGIN_URL)]

    opener.open(HOME, timeout=60)              # 세션(JSESSIONID) 프라이밍
    body = urllib.parse.urlencode({
        "usrIdeE": base64.b64encode(uid.encode()).decode(),
        "usrPwdE": base64.b64encode(pw.encode()).decode(),
        "nextUrl": "/",
    }).encode()
    req = urllib.request.Request(LOGIN_URL, data=body, headers={
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"})
    raw = opener.open(req, timeout=60).read().decode("utf-8", "replace")
    try:
        result = json.loads(raw).get("resultMap", {}).get("result")
    except json.JSONDecodeError:
        result = "success" if any(c.name == "JSESSIONID" for c in jar) else "error"
    if result != "success":
        sys.exit(f"자동로그인 실패(result={result}). 아이디/비번 확인: {raw[:200]}")

    cookie = "; ".join(f"{c.name}={c.value}" for c in jar)
    if save_to:
        os.makedirs(os.path.dirname(save_to) or ".", exist_ok=True)
        open(save_to, "w", encoding="utf-8").write(cookie)
    return cookie


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else None
    print(get_cookie(save_to=out)[:60] + " ...  ✓ 로그인 성공" + (f" → {out}" if out else ""))
