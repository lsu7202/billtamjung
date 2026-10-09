"""매매시세 · 임대시세 수집 — 네이버 부동산(fin.land.naver.com) 지도 목록(2026-10-03 대표 지시).
스키마: db/migrations/0210_market_sale_rent.sql · 적재: scripts/market/load_market.py

옛 크롤러(budongsan/naverAd_rent.py)와 같은 결: 브라우저로 화면을 연 뒤, **화면이 부르는 데이터 주소를 페이지 안에서**
부른다. 셀레니움 · undetected-chromedriver 대신 **설치된 크롬을 그냥 띄우고 Playwright 로 붙는다(CDP)** —
자동 조종 표시가 안 붙고, 크롬 이름만 일반 크롬으로 바꾸면 된다(헤드리스 이름이면 전부 429). 프로필은 따로 만든 빈 것.

  매매  A1 × 빌딩 D03 · 상가건물 D04 · 상가주택 D05 · 숙박 E01 · 공장창고 E02 · 토지 E03 ·
             단독/다가구 C03 · 전원주택 C04 · 한옥주택 C06   (통매가 있는 것만, 10-08. 코드 = 네이버 화면 REAL_ESTATE_TYPE)
        안 받는 것: 아파트 · 분양권 · 원룸 · 지식산업센터, 그리고 오피스텔 A02 · 빌라 C02 · 연립 A05 · 다세대 A06 ·
        도시형생활주택 A07 — 호실 광고뿐이라(10-08 표본 480건 전부 특정 층) 적재가 다 뺀다. 매물유형 칸은 그대로 있다
  임대  B2 월세 · B1 전세 × 사무실 D01 · 상가점포 D02

서울을 상자로 나눠(정밀도 13이 받는 가장 큰 상자 안쪽) 상자마다 목록을 30줄씩 끝까지 넘긴다.
깊이 제한 없음(7,796건 · 260쪽 실측). 상자 경계에 걸친 매물은 매물 번호로 한 번만 쓴다. 서울 밖 매물은 적재에서 거른다.
실패하면 60초 쉬고 세 번까지, 연속 20번 실패하면 멈춘다. 한 쪽마다 --sleep 초(기본 0.5) 쉰다.
결과: data/raw/_market/{날짜}/{sale,rent}.jsonl.gz — 매물 한 줄(목록이 준 원문 그대로).
다시 켜면 끝낸 상자는 건너뛴다(done.json). 상자가 전부 끝나면 done.json 에 "complete": true — 적재가 이걸 보고
「끝까지 다 돈 수집」으로 친다(사라짐 판정은 그때만).

    backend/.venv/bin/python scripts/market/crawl_market.py [--kind sale|rent|all] [--day 20261003] [--sleep 0.5] [--show]
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import gzip
import json
import os
import shutil
import socket
import subprocess
import time

from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CHROME = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")
HOME = "https://fin.land.naver.com/map?center=126.9780-37.5665&zoom=15"

KINDS = {
    "sale": {"tradeTypes": ["A1"], "realEstateTypes": ["D03", "D04", "D05", "E01", "E02", "E03", "C03", "C04", "C06"]},
    "rent": {"tradeTypes": ["B2", "B1"], "realEstateTypes": ["D01", "D02"]},
}
# 서울을 덮는 상자 — 경도 126.76~127.19 · 위도 37.41~37.72. 정밀도 13 은 ±0.10 × ±0.08 까지 받는다(12 는 거절)
LNG0, LNG1, LAT0, LAT1 = 126.76, 127.19, 37.41, 37.72
STEP_LNG, STEP_LAT = 0.0875, 0.0625


def tiles() -> list[dict]:
    out, y = [], LAT0
    while y < LAT1:
        x = LNG0
        while x < LNG1:
            out.append({"left": round(x, 4), "right": round(min(x + STEP_LNG, LNG1), 4),
                        "bottom": round(y, 4), "top": round(min(y + STEP_LAT, LAT1), 4)})
            x += STEP_LNG
        y += STEP_LAT
    return out


def flt(kind: str) -> dict:
    k = KINDS[kind]
    return {"tradeTypes": k["tradeTypes"], "realEstateTypes": k["realEstateTypes"], "roomCount": [],
            "bathRoomCount": [], "optionTypes": [], "oneRoomShapeTypes": [], "moveInTypes": [],
            "filtersExclusiveSpace": False, "floorTypes": [], "directionTypes": [], "hasArticlePhoto": False,
            "isAuthorizedByOwner": False, "parkingTypes": [], "entranceTypes": [], "hasArticle": False}


def free_port() -> int:
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


FETCH = """async ([path, body]) => {
  const r = await fetch('/front-api/v1' + path, {method: 'POST', credentials: 'include',
    headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
  return {s: r.status, t: await r.text()} }"""


class Blocked(Exception):
    pass


class Crawl:
    def __init__(self, pg, sleep: float):
        self.pg, self.sleep, self.streak, self.calls = pg, sleep, 0, 0

    async def post(self, path: str, body: dict) -> dict:
        """실패하면 60초 쉬고 세 번까지. 연속 실패가 쌓이면 멈춘다."""
        for attempt in range(4):
            try:
                r = await self.pg.evaluate(FETCH, [path, body])
                self.calls += 1
                if r["s"] == 200:
                    d = json.loads(r["t"])
                    if d.get("isSuccess"):
                        self.streak = 0
                        return d["result"]
                err = f"HTTP {r['s']} {r['t'][:120]}"
            except Exception as e:  # noqa: BLE001 — 페이지가 죽어도 같은 처리
                err = repr(e)[:160]
            self.streak += 1
            print(f"[{dt.datetime.now():%H:%M:%S}] 실패 (연속 {self.streak}) {err}", flush=True)
            if self.streak >= 20:
                raise Blocked(err)
            if attempt < 3:
                await asyncio.sleep(60)
                try:  # 화면을 다시 열어 쿠키 · 세션을 새로 받는다
                    await self.pg.goto(HOME, wait_until="networkidle", timeout=60000)
                except Exception:  # noqa: BLE001
                    pass
        raise RuntimeError(err)

    async def tile(self, kind: str, box: dict, out, seen: set) -> int:
        body = {"filter": flt(kind), "boundingBox": box, "precision": 13, "userChannelType": "PC",
                "articlePagingRequest": {"size": 30, "articleSortType": "RANKING_DESC", "lastInfo": []}}
        n = 0
        while True:
            res = await self.post("/article/boundedArticles", body)
            for it in res.get("list", []):
                a = it.get("representativeArticleInfo") or {}
                no = a.get("articleNumber")
                if no and no not in seen:
                    seen.add(no); n += 1
                    out.write(json.dumps(a, ensure_ascii=False) + "\n")
            if not res.get("hasNextPage") or not res.get("list"):
                return n
            body["articlePagingRequest"]["lastInfo"] = res["lastInfo"]
            body["articlePagingRequest"]["seed"] = res.get("seed")
            await asyncio.sleep(self.sleep)


async def run(kinds: list[str], day: str, sleep: float, show: bool):
    base = os.path.join(ROOT, "data", "raw", "_market", day)
    os.makedirs(base, exist_ok=True)
    prof = os.path.join(ROOT, "data", "raw", "_market", ".chrome")   # 따로 만든 빈 프로필(내 브라우저 아님)
    port = free_port()
    args = [CHROME, f"--remote-debugging-port={port}", f"--user-data-dir={prof}", "--no-first-run",
            "--no-default-browser-check", "--window-size=1400,900", f"--user-agent={UA}"]
    if not show:
        args.append("--headless=new")
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        async with async_playwright() as p:
            for _ in range(30):
                try:
                    b = await p.chromium.connect_over_cdp(f"http://127.0.0.1:{port}"); break
                except Exception:  # noqa: BLE001
                    time.sleep(1)
            else:
                raise RuntimeError("크롬에 붙지 못했다")
            ctx = b.contexts[0]
            pg = ctx.pages[0] if ctx.pages else await ctx.new_page()
            await pg.goto(HOME, wait_until="networkidle", timeout=60000)
            c = Crawl(pg, sleep)
            for kind in kinds:
                await one_kind(c, kind, base)
            await b.close()
    finally:
        proc.terminate()


async def one_kind(c: Crawl, kind: str, base: str):
    done_p = os.path.join(base, f"{kind}.done.json")
    raw_p = os.path.join(base, f"{kind}.jsonl.gz")
    done = json.load(open(done_p)) if os.path.exists(done_p) else {"tiles": [], "complete": False}
    if done.get("complete"):
        print(f"{kind}: 이미 끝남 — 건너뜀", flush=True); return
    # 이미 쓴 매물 번호(다시 켰을 때 상자 경계 중복 방지). 끝내지 못한 상자는 처음부터 다시 받는다 — 적재가 번호로 한 번만 싣는다
    seen: set[str] = set()
    if os.path.exists(raw_p):
        with gzip.open(raw_p, "rt", encoding="utf-8") as f:
            for line in f:
                try: seen.add(json.loads(line)["articleNumber"])
                except Exception: pass  # noqa: E701 — 끊긴 마지막 줄
    all_tiles = tiles()
    t0 = time.time()
    print(f"{kind}: 상자 {len(all_tiles)} · 끝낸 상자 {len(done['tiles'])} · 받은 매물 {len(seen):,}", flush=True)
    for i, box in enumerate(all_tiles):
        key = f"{box['left']},{box['bottom']}"
        if key in done["tiles"]:
            continue
        with gzip.open(raw_p, "at", encoding="utf-8") as out:
            n = await c.tile(kind, box, out, seen)
        done["tiles"].append(key)
        json.dump(done, open(done_p, "w"))
        print(f"[{dt.datetime.now():%H:%M:%S}] {kind} 상자 {i + 1}/{len(all_tiles)} +{n:,} · 누계 {len(seen):,}"
              f" · 요청 {c.calls:,} · {int(time.time() - t0)}초", flush=True)
    done["complete"] = True
    done["finished_at"] = dt.datetime.now().isoformat(timespec="seconds")
    done["n"] = len(seen)
    json.dump(done, open(done_p, "w"))
    print(f"{kind}: 끝 · 매물 {len(seen):,}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", choices=["sale", "rent", "all"], default="all")
    ap.add_argument("--day", default=dt.date.today().strftime("%Y%m%d"))
    ap.add_argument("--sleep", type=float, default=0.5)
    ap.add_argument("--show", action="store_true", help="크롬 창을 띄운다(헤드리스 대신)")
    a = ap.parse_args()
    if not shutil.which(CHROME) and not os.path.exists(CHROME):
        raise SystemExit(f"크롬이 없다: {CHROME} (CHROME 환경변수로 지정)")
    kinds = ["sale", "rent"] if a.kind == "all" else [a.kind]
    try:
        asyncio.run(run(kinds, a.day, a.sleep, a.show))
    except Blocked as e:
        raise SystemExit(f"막혔다 — 멈춤. 다시 켜면 끝낸 상자부터 잇는다. ({e})")


if __name__ == "__main__":
    main()
