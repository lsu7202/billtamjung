#!/usr/bin/env python3
"""LOCALDATA(지방행정인허가데이터) 업종별 서울 CSV 내려받기 — 키 불필요(2026-09-05).

행정안전부가 245개 지자체 인허가를 매일 취합해 여는 자료다. **이용허락범위 제한 없음.**
소상공인 상가정보보다 이 쪽이 낫다(2026-09-05 실측, 서울 일반음식점 기준):

    층 표기      80.7%  (소상공인 68.0%)
    소재지면적   99.8%  ← 소상공인엔 아예 없는 칸
    좌표         98.6%  (EPSG:5174 — V-World 와 같은 좌표계라 변환 코드가 이미 있다)
    인허가일자·폐업일자 → 시계열. 「이 건물에 최근 몇 곳이 들어오고 나갔나」가 나온다

## 받는 법 — 두 가지 함정

  ① **기본 User-Agent 면 403.** 브라우저 UA 를 줘야 200 이 온다. 헤드리스 크롬도 403 이라
     playwright 로는 못 받는다 — curl 이 오히려 된다.
  ② 다운로드 URL 은 페이지의 `data-download-url` 에 있다:
         /file/download/{업종}/info?orgCode={시도}_ALL      ← 업종 하나
         /file/download-all?orgCode={시도}_ALL              ← 그 시도 전 업종
     `/file/{업종}/download` 는 500 을 낸다(이 길이 아니다).
     시도 코드는 info 페이지의 `<option value="6110000_ALL">` 에서 얻는다. 서울 = 6110000.

파일은 **cp949** 다(utf-8 아님). 칸 39개.

    data/.venv/bin/python scripts/localdata/download_localdata.py --only general_restaurants
"""
import argparse
import os
import urllib.request

BASE = "https://file.localdata.go.kr"
SEOUL = "6110000_ALL"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
# 업종 slug 는 **페이지에서 뽑는다** — 손으로 적어 두면 업종이 늘 때 조용히 빠진다.
# 좌측 메뉴의 href="/file/{slug}/info" 가 전부다(2026-09-05 기준 208종).
# 한글 이름은 CSV 안 `개방서비스명` 칸에 있으니 여기서 안 챙긴다.
import re

ANY = f"{BASE}/file/general_restaurants/info"


def slugs() -> list[str]:
    html = fetch(ANY, BASE + "/").decode("utf-8", "replace")
    out, seen = [], set()
    for s in re.findall(r'href="/file/([a-z0-9_]+)/info"', html):
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out


def fetch(url: str, referer: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": referer})
    with urllib.request.urlopen(req, timeout=900) as r:
        return r.read()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/raw/_localdata")
    ap.add_argument("--only", help="업종 slug 쉼표 구분(비우면 페이지에 있는 전부)")
    ap.add_argument("--org", default=SEOUL, help="시도 코드(기본 서울 6110000_ALL)")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    todo = a.only.split(",") if a.only else slugs()
    print(f"  업종 {len(todo)}종 · 서울({a.org})")
    got = skip = fail = 0
    for i, slug in enumerate(todo, 1):
        p = os.path.join(a.out, f"localdata_{slug}_{a.org.split('_')[0]}.csv")
        # 이미 받은 것은 다시 안 받는다 — 208종을 한 번에 받다 끊기면 처음부터가 된다
        if os.path.exists(p) and os.path.getsize(p) > 100_000:
            skip += 1
            continue
        info = f"{BASE}/file/{slug}/info"
        try:
            fetch(info, BASE + "/")                    # 세션 한 번 태우고
            data = fetch(f"{BASE}/file/download/{slug}/info?orgCode={a.org}", info)
        except Exception as e:                                 # noqa: BLE001
            print(f"  [{i}/{len(todo)}] {slug}: ✗ {e}", flush=True)
            fail += 1
            continue
        # 받은 것이 진짜인지 본다 — 크롤러는 0바이트를 성공으로 넘기면 안 도는 것보다 나쁘다
        # 받은 것이 진짜인지 본다. 작은 업종은 몇 KB 라 크기로만 거르면 멀쩡한 걸 버린다 —
        # 첫 줄에 쉼표가 있는지(=CSV 인지)를 본다
        if b"," not in data[:4000]:
            print(f"  [{i}/{len(todo)}] {slug}: ✗ CSV 가 아니다({len(data):,}B)", flush=True)
            fail += 1
            continue
        open(p, "wb").write(data)
        got += 1
        print(f"  [{i}/{len(todo)}] {slug}: ✓ {len(data)//1024:,}KB", flush=True)


    print(f"\n  받음 {got} · 건너뜀 {skip} · 실패 {fail}")


main()
