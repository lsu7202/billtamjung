#!/usr/bin/env python3
r"""서울 열린데이터광장 공간정보(SHP) 내려받기 — 도시계획시설 4종(2026-09-05).

주변 동향의 **기반시설** 갈래 도형이다. 도로·공원·철도·주차장 결정 고시는
`master.urban_notice` 안에 15,084건 이미 있었는데 도형이 없어 자리를 못 잡았다.

공공누리 1유형(출처표시 · 상업 이용 가능) · 수시(월간) · EPSG:5174.

## **헤드리스 크롬으로 받는다** — curl 로는 안 된다
POST 본문(`infId=OA-21129&seqNo=&seq=5&infSeq=1`)과 헤더(Referer 루트 · Origin)를
브라우저와 똑같이 맞춰도 서버가 「잘못된 접근입니다」 HTML(183B)을 준다.
쿠키를 브라우저에서 떠 와도 안 된다. 서버가 세션에 뭘 더 물고 있다.
**브라우저로는 한 번에 된다** — 그래서 크롬을 띄워 `downloadFile()` 을 부르고
내려받기가 끝날 때까지 기다린다(topdf.py 와 같은 CDP 방식).

## 페이지가 말해 주는 것
- 파일 목록은 `dataList/fileView.do` 를 따로 불러야 온다(데이터셋 페이지엔 없다)
- `downloadFile('N')` 의 **N 이 큰 것이 최신판**이다. 화면 1번 줄이 최신인데 N 은 거꾸로 매겨져 있다

    data/.venv/bin/python scripts/seoul_gis/download_gis.py
"""
import glob
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

import websocket  # websocket-client

VIEW = "https://data.seoul.go.kr/dataList/{oa}/F/1/datasetView.do"
OUT = "data/raw/_seoul_gis"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT = 9444
DL = "/tmp/seoul_gis_dl"

SETS = {
    "OA-21134": "도시계획시설_도로",
    "OA-21129": "도시계획시설_공간시설",
    "OA-21130": "도시계획시설_교통시설_도로외",
    "OA-21141": "도시계획시설_보건위생시설",
    # 규제 — **바뀌는 것만**(2026-09-06). 용도지역·용도지구·개발제한구역은 안 받는다:
    # 그건 「지금 상태」라 이미 필지 원장(KLIP)에 있고 건물 상세의 규제 칸이 보여 준다.
    # 개발행위허가제한지역은 한시적이고 걸리면 「지금 못 짓는다」라서 **동향**이다.
    "OA-21125": "규제_개발행위허가제한지역",
}
# 최신판 하나가 이 크기보다 작으면 받다 만 것이다(보건위생시설이 36KB 로 제일 작다)
MIN_BYTES = 20_000


class Cdp:
    def __init__(self, port):
        self.n = 0
        for _ in range(80):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=2)
                break
            except Exception:                                 # noqa: BLE001, PERF203
                time.sleep(0.5)
        tabs = [t for t in json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
                if t.get("type") == "page"]
        self.ws = websocket.create_connection(tabs[0]["webSocketDebuggerUrl"], timeout=1800)

    def send(self, method, params=None):
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "method": method, "params": params or {}}))
        while True:
            r = json.loads(self.ws.recv())
            if r.get("id") == self.n:
                return r

    def js(self, expr, wait=0.0):
        r = self.send("Runtime.evaluate",
                      {"expression": expr, "awaitPromise": True, "returnByValue": True})
        if wait:
            time.sleep(wait)
        return (r.get("result", {}).get("result", {}) or {}).get("value")


def settled(before: set, timeout: int = 900):
    """새 파일이 생기고 **크기가 멈출 때까지** 기다린다. `.crdownload` 는 아직 받는 중이다."""
    t0, last, still = time.time(), -1, 0
    while time.time() - t0 < timeout:
        now = set(glob.glob(os.path.join(DL, "*")))
        new = [f for f in now - before if not f.endswith(".crdownload")]
        if new:
            sz = os.path.getsize(new[0])
            still = still + 1 if sz == last else 0
            last = sz
            if still >= 3 and sz > MIN_BYTES:
                return new[0]
        time.sleep(1)
    return None


def main() -> int:
    if not os.path.exists(CHROME):
        print(f"✗ 크롬이 없다: {CHROME}")
        return 2
    os.makedirs(OUT, exist_ok=True)
    shutil.rmtree(DL, ignore_errors=True)
    os.makedirs(DL, exist_ok=True)
    shutil.rmtree(f"/tmp/cdp{PORT}", ignore_errors=True)
    p = subprocess.Popen(
        [CHROME, "--headless=new", f"--remote-debugging-port={PORT}", "--disable-gpu",
         "--no-first-run", "--remote-allow-origins=*", f"--user-data-dir=/tmp/cdp{PORT}",
         "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    got = bad = 0
    try:
        c = Cdp(PORT)
        c.send("Page.enable")
        c.send("Browser.setDownloadBehavior",
               {"behavior": "allow", "downloadPath": os.path.abspath(DL)})
        for oa, label in SETS.items():
            dst = os.path.join(OUT, f"{label}.zip")
            if os.path.exists(dst) and os.path.getsize(dst) > MIN_BYTES:
                print(f"  [{label}] 이미 있음 {os.path.getsize(dst)//1024:,}KB", flush=True)
                got += 1
                continue
            c.send("Page.navigate", {"url": VIEW.format(oa=oa)})
            time.sleep(6)
            seq = c.js("(function(){var a=[].slice.call("
                       "document.querySelectorAll(\"a[href*='downloadFile']\"))"
                       ".map(function(e){return +e.getAttribute('href').match(/\\d+/)[0]});"
                       "return a.length?Math.max.apply(null,a):0})()")
            if not seq:
                print(f"  [{label}] ✗ 파일 목록이 비었다", flush=True)
                bad += 1
                continue
            before = set(glob.glob(os.path.join(DL, "*")))
            c.js(f"downloadFile('{seq}')")
            f = settled(before)
            if not f:
                print(f"  [{label}] ✗ 내려받기가 안 끝났다(seq {seq})", flush=True)
                bad += 1
                continue
            if open(f, "rb").read(2) != b"PK":
                print(f"  [{label}] ✗ zip 이 아니다", flush=True)
                os.unlink(f)
                bad += 1
                continue
            shutil.move(f, dst)
            got += 1
            print(f"  [{label}] ✓ seq {seq} · {os.path.getsize(dst)//1024:,}KB", flush=True)
    finally:
        p.terminate()
        shutil.rmtree(DL, ignore_errors=True)
    print(f"\n  받음 {got} · 실패 {bad}")
    return 0 if not bad else 1


sys.exit(main())
