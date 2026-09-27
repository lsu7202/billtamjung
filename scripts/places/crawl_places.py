"""카카오맵 · 네이버지도 장소 수집 — 우리 도로명 주소 전체(2026-09-26 대표 지시).
명세: specs/07-architecture/11-업체-크롤링.md

화면이 부르는 **데이터 주소를 직접** 부른다(브라우저를 안 띄운다 — 띄우면 지도 그림까지 받아 건물당 1분이 걸렸다).

  카카오  map.kakao.com/api/v1/mapsearch/map?q=도로명     15곳씩 쪽을 넘겨 전부 받는다
  네이버  map.naver.com/p/api/entry/addressInfo?lng&lat&address
          좌표 + 도로명으로 그 주소의 장소를 준다. 한 번에 20곳까지 — 넘으면 totalCount 만 남긴다

네이버 검색 주소(allSearch)는 직접 부르면 캡차(자동 요청 차단)가 걸린다. **쓰지 않고, 풀려고 하지도 않는다.**

**목표: 도로명 주소 전체(49.4만)를 하루 안에**(2026-09-26 대표). 곳마다 --workers 줄(기본 8)이 나눠 부르고
초당 --rate 번(기본 10)으로 맞춘다 — 계산상 카카오 약 15시간(쪽 넘김 포함) · 네이버 약 14시간.
실패하면 60초 쉬고 세 번까지 다시, 연속 30번 실패하면 그 곳은 멈춘다(막힌 채로 계속 두드리지 않는다).
결과: data/raw/_places/{날짜}/{kakao,naver}.jsonl.gz — 주소 한 줄. 다시 켜면 이미 받은 주소는 건너뛴다.
DB 에는 싣지 않는다(스키마는 명세 1단계에서 정한다).

    backend/.venv/bin/python scripts/places/crawl_places.py [--limit N] [--rate 10] [--workers 8] [--day 20260926]
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import gzip
import json
import os
import re
import time

import asyncpg
import httpx

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB = os.environ.get("DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

# 카카오 장소에서 남길 칸 — 층은 주소 끝(「… 10 2층」 · new_address_disp 마지막 토막)에 붙어 온다
K_KEEP = ("confirmid", "name", "tel", "address", "new_address", "new_address_disp",
          "cate_name_depth1", "cate_name_depth2", "cate_name_depth3", "cate_name_depth4",
          "cate_name_depth5", "last_cate_name", "lat", "lon")
N_KEEP = ("id", "name", "tel", "category", "categoryPath", "address", "roadAddress",
          "abbrAddress", "x", "y")


def road_clean(s: str) -> str:
    return re.sub(r"\s*\([^)]*\)\s*$", "", (s or "").strip())


def kakao_q(road: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"^서울특별시\s+", "서울 ", road)).strip()


def nkey(s: str | None) -> str:
    return re.sub(r"\s+", "", re.sub(r"^서울특별시", "서울", s or ""))


# 도로 이름(…로·…길) + 건물번호가 있어야 주소로 묻는다. 대장엔 「서울특별시 강남구 24」처럼 도로 이름이 빠진
# 도로명이 있다 — 그대로 물으면 카카오가 「24」를 낱말로 찾아 이마트24 를 준다(2026-09-26 시험).
ROAD_OK = re.compile(r"\S+(?:로|길)\s*(?:지하\s*)?\d+(?:-\d+)?$")      # 「강남대로 지하396」 같은 지하 주소도 받는다


# master.buildings 는 뷰라 묶기(GROUP BY)를 걸면 뷰 전체를 계산해 몇 분이 걸린다. 행만 받아 여기서 묶는다
ROWS_SQL = """SELECT building_pk, road_addr, ST_X(geom) AS x, ST_Y(geom) AS y
                FROM master.buildings WHERE road_addr IS NOT NULL AND geom IS NOT NULL"""


def group_addrs(rows, listed: set[str]) -> list[dict]:
    by: dict[str, dict] = {}
    for r in rows:
        road = road_clean(r["road_addr"])
        a = by.setdefault(road, {"road": road, "x": r["x"], "y": r["y"], "pks": [], "listed": False})
        a["pks"].append(r["building_pk"])
        a["listed"] = a["listed"] or r["building_pk"] in listed
    return sorted(by.values(), key=lambda a: (not a["listed"], a["road"]))   # 팀 매물 건물 먼저(명세 §3)


class Stop(Exception):
    pass


def read_members(path: str):
    """이어 받기용 읽기 — gzip 조각을 하나씩 따로 푼다(2026-09-26).

    도중에 끊으면 그 실행의 조각이 끝나지 않은 채 남고, 다음 실행은 그 뒤에 새 조각을 붙인다.
    gzip.open 은 덜 끝난 첫 조각에서 멈춰서, 뒤 조각에 든 수십만 주소를 「안 받은 것」으로 알고
    처음부터 다시 받았다. 여기서는 조각 머리(파일 이름이 박힌 헤더)마다 따로 풀고,
    덜 끝난 조각은 풀리는 데까지만 쓴다. 잘린 마지막 줄은 버린다(다시 받는다)."""
    import zlib
    raw = open(path, "rb").read()
    name = os.path.basename(path)[:-3].encode() + b"\x00"       # gzip.open 이 헤더에 적는 이름
    heads = [m.start() for m in re.finditer(re.escape(b"\x1f\x8b\x08\x08"), raw)
             if raw.find(name, m.start(), m.start() + 64) > 0] or [0]
    for k, h in enumerate(heads):
        end = heads[k + 1] if k + 1 < len(heads) else len(raw)
        d, out = zlib.decompressobj(31), []
        for i in range(h, end, 1 << 16):
            try:
                out.append(d.decompress(raw[i:min(i + (1 << 16), end)]))
            except zlib.error:
                break
            if d.eof:
                break
        lines = b"".join(out).decode("utf-8", "ignore").split("\n")
        if not d.eof:
            lines = lines[:-1]                                    # 덜 끝난 조각의 마지막 줄은 잘렸을 수 있다
        yield from (ln for ln in lines if ln.strip())


DEADLINE: float | None = None     # --until. 이 시각이 되면 하던 주소까지 마치고 파일을 닫는다


class Source:
    def __init__(self, name: str, path: str, rate: float):
        self.name, self.path, self.gap = name, path, 1.0 / rate
        self.next_at = time.monotonic()      # 곳마다 한 박자 — 줄이 여럿이어도 초당 rate 번을 안 넘는다
        self.stopped: str | None = None
        self.done: set[str] = set()
        if os.path.exists(path):
            for line in read_members(path):
                try:
                    self.done.add(json.loads(line)["road"])
                except Exception:
                    pass
        self.out = gzip.open(path, "at", encoding="utf-8")
        self.n = self.places = self.fails = self.streak = 0
        self.t0 = time.time()

    def write(self, rec: dict):
        self.out.write(json.dumps(rec, ensure_ascii=False) + "\n")
        self.n += 1
        if self.n % 200 == 0:
            self.out.flush()


async def get_json(c: httpx.AsyncClient, src: Source, url: str, params: dict, referer: str) -> dict:
    """실패하면 60초 쉬고 세 번까지. 연속 실패가 쌓이면 멈춘다 — 막힌 채로 계속 두드리지 않는다."""
    for attempt in range(3):
        if src.stopped:
            raise Stop(src.stopped)
        now = time.monotonic()
        src.next_at = max(src.next_at + src.gap, now)
        await asyncio.sleep(src.next_at - now)
        try:
            r = await c.get(url, params=params, headers={"User-Agent": UA, "Referer": referer,
                                                          "Accept-Language": "ko-KR,ko;q=0.9"})
            if r.status_code == 200:
                j = r.json()
                if isinstance(j, dict) and ("ncaptcha" in j or "ncaptcha" in (j.get("result") or {})):
                    raise RuntimeError("캡차")
                src.streak = 0
                return j
            raise RuntimeError(f"HTTP {r.status_code}")
        except Exception as e:  # noqa: BLE001
            src.fails += 1
            src.streak += 1
            # 왜 실패했는지 남긴다 — 막힌 건지(429·403·캡차) 우리 쪽 문제인지 가려야 속도를 정한다
            print(f"[{dt.datetime.now():%H:%M:%S}] {src.name} 실패 {src.fails} (연속 {src.streak}) {e}", flush=True)
            if src.streak >= 30:
                src.stopped = f"{src.name}: 연속 30번 실패 — 멈춤 ({e})"
                raise Stop(src.stopped) from e
            await asyncio.sleep(60)
    return {"_err": "세 번 실패"}


async def pool(n: int, fn, c, src: Source, addrs: list[dict]):
    """주소 목록을 n 줄이 나눠 가져간다. 속도는 src 의 박자가 맞춘다."""
    q: asyncio.Queue = asyncio.Queue()
    for a in addrs:
        if a["road"] not in src.done:
            q.put_nowait(a)

    async def worker():
        while not q.empty() and not src.stopped:
            if DEADLINE and time.time() >= DEADLINE:     # 정한 시각이 되면 새 주소를 안 집는다
                return
            await fn(c, src, q.get_nowait(), len(addrs))
    res = await asyncio.gather(*(worker() for _ in range(n)), return_exceptions=True)
    bad = next((r for r in res if isinstance(r, Exception)), None)
    if bad:
        raise bad


async def one_kakao(c, src: Source, a: dict, n_all: int):
    q, places, total, page, dropped = kakao_q(a["road"]), [], None, 1, 0
    while True:
        j = await get_json(c, src, "https://map.kakao.com/api/v1/mapsearch/map",
                           {"q": q, "msFlag": "A", "sort": "0", "page": page}, "https://map.kakao.com/")
        if "_err" in j:
            break
        got = j.get("place") or []
        total = j.get("place_totalcount")
        # **그 도로명의 장소만** 남긴다. 카카오는 주소를 낱말로 넓게 찾아 근처 가게까지 준다
        # (시험 40주소 480곳 중 맞는 것 178). 한 쪽이 전부 맞을 때만 다음 쪽으로 — 섞이기 시작하면 끝이다
        mine = [p for p in got if nkey(p.get("new_address")) == nkey(q)]
        places += [{k: p.get(k) for k in K_KEEP} for p in mine]
        dropped += len(got) - len(mine)
        if len(got) < 15 or len(mine) < len(got) or page >= 20:
            break
        page += 1
    src.places += len(places)
    src.write({"road": a["road"], "pks": a["pks"], "q": q, "total": total, "places": places, "dropped": dropped,
               "at": dt.datetime.now().isoformat(timespec="seconds"), **({"err": j["_err"]} if "_err" in j else {})})
    progress(src, n_all)


async def one_naver(c, src: Source, a: dict, n_all: int):
    j = await get_json(c, src, "https://map.naver.com/p/api/entry/addressInfo",
                       {"lng": f"{a['x']:.7f}", "lat": f"{a['y']:.7f}", "address": a["road"]},
                       "https://map.naver.com/")
    pl = j.get("place") or {}
    lst = [{k: p.get(k) for k in N_KEEP} for p in (pl.get("list") or [])]
    src.places += len(lst)
    src.write({"road": a["road"], "pks": a["pks"], "count": pl.get("count"), "total": pl.get("totalCount"),
               "places": lst, "build": (j.get("address") or {}).get("buildName"),
               "at": dt.datetime.now().isoformat(timespec="seconds"), **({"err": j["_err"]} if "_err" in j else {})})
    progress(src, n_all)


def progress(src: Source, total: int):
    if src.n % 500 == 0:
        left = total - len(src.done) - src.n
        rate = src.n / max(1, time.time() - src.t0)
        print(f"[{dt.datetime.now():%m-%d %H:%M}] {src.name} {len(src.done) + src.n:,}/{total:,} · 장소 {src.places:,} "
              f"· 실패 {src.fails} · {rate:.2f}건/초 · 남은 {left / max(rate, 1e-6) / 3600:.1f}시간", flush=True)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--rate", type=float, default=10.0)
    ap.add_argument("--kr", type=float, default=0, help="카카오 초당 횟수(안 주면 --rate)")
    ap.add_argument("--nr", type=float, default=0, help="네이버 초당 횟수(안 주면 --rate)")
    ap.add_argument("--only", choices=["kakao", "naver"], default=None)
    ap.add_argument("--until", default=None, help="멈출 시각(예: 2026-09-26T10:53)")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--day", default=dt.date.today().strftime("%Y%m%d"))
    a = ap.parse_args()
    global DEADLINE
    if a.until:
        DEADLINE = dt.datetime.fromisoformat(a.until).timestamp()
    out = os.path.join(ROOT, "data", "raw", "_places", a.day)
    os.makedirs(out, exist_ok=True)
    db = await asyncpg.connect(DB)
    rows = await db.fetch(ROWS_SQL)
    listed = {r["building_pk"] for r in await db.fetch("SELECT DISTINCT building_pk FROM app.listings")}
    await db.close()
    addrs = group_addrs(rows, listed)
    bad = [x for x in addrs if not ROAD_OK.search(x["road"])]
    addrs = [x for x in addrs if ROAD_OK.search(x["road"])]
    print(f"도로 이름이 빠진 도로명 {len(bad):,}개는 건너뜀 (예: {', '.join(b['road'] for b in bad[:3])})", flush=True)
    if a.limit:
        addrs = addrs[: a.limit]
    print(f"도로명 주소 {len(addrs):,} (팀 매물 {sum(x['listed'] for x in addrs):,}) → {out}", flush=True)
    k = Source("카카오", os.path.join(out, "kakao.jsonl.gz"), a.kr or a.rate)
    n = Source("네이버", os.path.join(out, "naver.jsonl.gz"), a.nr or a.rate)
    lim = httpx.Limits(max_connections=a.workers * 2 + 4, max_keepalive_connections=a.workers * 2)
    async with httpx.AsyncClient(timeout=15, limits=lim) as c:
        jobs = []
        if a.only in (None, "kakao"):
            jobs.append(pool(a.workers, one_kakao, c, k, addrs))
        if a.only in (None, "naver"):
            jobs.append(pool(a.workers, one_naver, c, n, addrs))
        res = await asyncio.gather(*jobs, return_exceptions=True)
        res += [None] * (2 - len(res))
    for s in (k, n):
        s.out.close()
    for s, r in zip((k, n), res):
        print(f"{s.name} 끝 · 이번에 {s.n:,}주소 · 장소 {s.places:,} · 실패 {s.fails}" + (f" · {r}" if isinstance(r, Exception) else ""), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
