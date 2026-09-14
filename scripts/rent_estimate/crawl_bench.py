"""임대 추정 백테스트 잣대 — 네이버 임대 호가 크롤을 건물에 붙인다(2026-08-29).

임대 추정의 직접 잣대는 **호가**다(주야비 기각 때 정한 것). 그런데 지금까지 잣대를
쓸 때마다 붙이는 코드를 그 자리에서 새로 짰다 — 강남 160동, 22.6만 매물, 36,318동이
전부 다른 스크립트였고 서로 비교가 안 됐다. 붙이는 일을 여기 한 곳에 둔다.

원본: ~/Desktop/budongsan/빌탐정데스크탑/naverAd_rent.json
  {"위도, 경도": {"address": "...", "items": [{매물번호, 보증금, 월세, 층, 계약면적, 전용면적}]}}
  좌표 43,139 · 매물 269,389.

붙이는 법: 좌표 → 가장 가까운 건물(30m 안). 주소 문자열은 안 쓴다 —
지번 표기가 크롤과 대장에서 갈리고(번지·산·부번), 좌표는 갈릴 데가 없다.

    backend/.venv/bin/python scripts/rent_estimate/crawl_bench.py --build
      → master._crawl_rent 적재(1회). 그 뒤 실험 스크립트는 이 표만 읽는다.
"""
import argparse
import asyncio
import json
import os
import re

import asyncpg

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")
SRC = os.environ.get(
    "CRAWL_RENT_JSON",
    os.path.expanduser("~/Desktop/budongsan/빌탐정데스크탑/naverAd_rent.json"))

# 붙이는 반경 — 30m. 네이버 좌표는 건물 중심이 아니라 도로 접점에 찍히는 일이 있어
# 10m 는 놓치고, 50m 는 옆 건물을 물어온다. 30m 에서 붙는 비율과 정확도가 갈린다.
SNAP_M = 30


def parse_floor(s):
    """'2/15' → 2 · 'B1/15' → -1 · '고/15' → None(저·중·고 표기는 층을 모른다)."""
    s = str(s or "").split("/")[0].strip()
    if not s:
        return None
    if s.upper().startswith("B") or s.startswith("지하"):
        n = re.sub(r"\D", "", s)
        return -int(n) if n else -1
    n = re.sub(r"\D", "", s)
    return int(n) if n else None


def load_rows():
    """크롤 JSON → (lat, lng, 층, 계약면적, 전용면적, 보증금, 월세) 목록."""
    with open(SRC, encoding="utf-8") as f:
        d = json.load(f)
    out = []
    for key, v in d.items():
        try:
            lat, lng = [float(x) for x in key.split(",")]
        except ValueError:
            continue
        for it in v.get("items", []):
            rent = it.get("월세")
            ca = it.get("계약면적")
            if not rent or not ca or ca <= 0:
                continue          # 월세 없는 건 전세다 — 임대료 잣대가 아니다
            out.append((lat, lng, parse_floor(it.get("층")), float(ca),
                        float(it.get("전용면적") or 0) or None,
                        float(it.get("보증금") or 0), float(rent),
                        str(it.get("매물번호")), v.get("address")))
    return out


DDL = """
DROP TABLE IF EXISTS master._crawl_rent;
CREATE TABLE master._crawl_rent (
  no          text PRIMARY KEY,
  building_pk text,
  dist_m      real,
  addr        text,
  lat         double precision,
  lng         double precision,
  floor       int,
  area_c      real,     -- 계약면적(㎡) — 공공요율의 분모와 같은 기준
  area_e      real,     -- 전용면적(㎡)
  deposit     bigint,
  rent        bigint    -- 월세(원)
);
CREATE INDEX ON master._crawl_rent(building_pk);
CREATE INDEX ON master._crawl_rent(building_pk, floor);
"""


async def build():
    rows = load_rows()
    print(f"크롤 매물 {len(rows):,}건(월세 있는 것만)")
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=1800)
    await c.execute(DDL)
    await c.executemany(
        "INSERT INTO master._crawl_rent(no,addr,lat,lng,floor,area_c,area_e,deposit,rent)"
        " VALUES($8,$9,$1,$2,$3,$4,$5,$6,$7) ON CONFLICT (no) DO NOTHING",
        rows)
    n = await c.fetchval("SELECT count(*) FROM master._crawl_rent")
    print(f"적재 {n:,}건")

    # 좌표 → 건물. geography 로 재야 m 가 나온다. 건물 geom 은 폴리곤이라 ST_Distance 가
    # 「면까지의 거리」다 — 건물 안에 찍힌 좌표는 0m 로 붙는다.
    print(f"건물 붙이는 중(반경 {SNAP_M}m)…")
    # UPDATE ... FROM LATERAL 은 갱신 대상 행을 못 본다(asyncpg: invalid reference to
    # FROM-clause entry). 좌표는 43,139개뿐이고 매물이 그 위에 얹히는 구조라,
    # **좌표 단위로 한 번만** 최근접을 구해 조인한다 — 26.9만 번 대신 4.3만 번이다.
    await c.execute(f"""
        WITH pt AS (
          SELECT DISTINCT lat, lng FROM master._crawl_rent
        ), snap AS (
          SELECT pt.lat, pt.lng, s.pk, s.d
            FROM pt
            LEFT JOIN LATERAL (
              SELECT b.building_pk pk,
                     ST_Distance(b.geom::geography,
                                 ST_SetSRID(ST_MakePoint(pt.lng, pt.lat),4326)::geography) d
                FROM master.buildings b
               WHERE b.geom IS NOT NULL
                 AND ST_DWithin(b.geom::geography,
                                ST_SetSRID(ST_MakePoint(pt.lng, pt.lat),4326)::geography, {SNAP_M})
               ORDER BY b.geom <-> ST_SetSRID(ST_MakePoint(pt.lng, pt.lat),4326)
               LIMIT 1) s ON TRUE
        )
        UPDATE master._crawl_rent cr
           SET building_pk = snap.pk, dist_m = snap.d
          FROM snap
         WHERE cr.lat = snap.lat AND cr.lng = snap.lng""")
    got = await c.fetchval("SELECT count(*) FROM master._crawl_rent WHERE building_pk IS NOT NULL")
    bl = await c.fetchval("SELECT count(DISTINCT building_pk) FROM master._crawl_rent WHERE building_pk IS NOT NULL")
    print(f"붙은 매물 {got:,}건({got*100//max(n,1)}%) · 건물 {bl:,}동")
    await c.close()


async def stat():
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=600)
    q = await c.fetch("""
        SELECT count(*) n, count(DISTINCT building_pk) bl,
               count(*) FILTER (WHERE floor IS NULL) nofloor,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY rent) med_rent,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY rent/area_c) med_unit,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY deposit/NULLIF(rent,0)) med_dep_mult,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY area_e/NULLIF(area_c,0)) med_eff
          FROM master._crawl_rent WHERE building_pk IS NOT NULL""")
    r = q[0]
    print(f"붙은 매물 {r['n']:,} · 건물 {r['bl']:,}동 · 층 미상 {r['nofloor']:,}")
    print(f"  월세 중앙 {r['med_rent']:,.0f}원 · 단가 {r['med_unit']:,.0f}원/㎡")
    print(f"  보증금/월세 중앙 {r['med_dep_mult']:.1f} · 전용/계약 중앙 {r['med_eff']:.3f}")
    await c.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", action="store_true", help="크롤 JSON → master._crawl_rent 재적재")
    a = ap.parse_args()
    asyncio.run(build() if a.build else stat())
