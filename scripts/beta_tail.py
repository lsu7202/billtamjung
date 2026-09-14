"""`gcloud beta logging tail` 의 기본 출력(YAML 스트림)을 사람이 읽는 한 줄로 바꾼다.

--format 을 주면 gcloud 가 출력을 모았다가 스트림이 끝날 때 한 번에 뱉는다(= 실시간이 아니다).
그래서 기본 출력을 그대로 받아 여기서 파싱한다. 레코드 구분자는 '---'.
"""
import datetime
import sys
import urllib.parse

# 화면 하나 열면 같이 딸려오는 것들 — 사람이 누른 게 아니라 안 보여준다
NOISE = {"/api/credits", "/api/enums", "/api/listings/members", "/api/auth/me",
         "/api/saved-searches", "/api/auth/public-config", "/api/auth/refresh",
         "/api/health"}

FIELDS = ("request_url", "user_agent", "status", "timestamp")


def who(ua: str) -> str:
    """사용자 IP는 로그에 없다 — Firebase Hosting egress(66.249.x)로 찍힌다. UA로 구분한다."""
    if "Edg/" in ua: return "윈도우Edge"
    if "Windows" in ua: return "윈도우Chrome"
    if "iPhone" in ua: return "아이폰"
    if "iPad" in ua: return "아이패드"
    if "Android" in ua: return "안드로이드(인앱)" if "wv" in ua else "안드로이드"
    if "Macintosh" in ua: return "맥Safari" if "Version/" in ua else "맥Chrome"
    if "curl" in ua: return "curl"
    return "?"


def what(path: str, query: str) -> tuple[str, str]:
    if path.endswith("/suggest"):                return "자동완성", urllib.parse.unquote_plus(query)[2:]
    if path == "/api/search":                    return "검색", ""
    if path.startswith("/api/search/parcel-at"): return "지도 필지 클릭", ""
    if "/floor-rents" in path:                   return "층별임대 봄", ""
    if "/floor-outline" in path:                 return "층별개요 봄", ""
    if "/series" in path:                        return "공시지가 봄", ""
    if "nearby-sales" in path:                   return "주변실거래 봄", ""
    if path == "/api/reports":                   return "★ 리포트 목록", ""
    if path.startswith("/api/reports"):          return "★ 리포트", ""
    if "briefing" in path:                       return "★ 브리핑", ""
    if path == "/api/auth/signup":               return "★★ 가입", ""
    if "listings/claim" in path:                 return "★ 내 매물 등록", ""
    if "listings/biz" in path:                   return "업무정보 입력", ""
    if "photos" in path:                         return "사진", ""
    if path.startswith("/api/buildings/"):       return "매물 상세", path.split("/")[3]
    return path.replace("/api/", ""), ""


def emit(rec: dict) -> None:
    url = rec.get("request_url")
    if not url:
        return
    p = urllib.parse.urlparse(url)
    if p.path in NOISE:
        return
    try:
        t = datetime.datetime.fromisoformat(rec.get("timestamp", "").replace("Z", "+00:00"))
        clock = f"{t + datetime.timedelta(hours=9):%H:%M:%S}"
    except ValueError:
        clock = "--:--:--"
    status = rec.get("status", "")
    act, detail = what(p.path, p.query)
    bad = f"  ⚠{status}" if status[:1] in ("4", "5") else ""
    print(f"{clock}  {who(rec.get('user_agent', '')):16} {act:15} {detail[:42]}{bad}")


def main() -> None:
    rec: dict = {}
    for line in sys.stdin:
        if line.startswith("---"):
            emit(rec)
            rec = {}
            continue
        s = line.strip()
        for key in FIELDS:
            if s.startswith(key + ":"):
                rec[key] = s[len(key) + 1:].strip().strip("'\"")
                break
    emit(rec)


if __name__ == "__main__":
    main()
