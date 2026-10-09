"""매매시세 · 임대시세 적재 — crawl_market.py 가 받은 원문을 매매가 표 · master.market_sale / market_rent 로.
스키마: db/migrations/0212_market_daily.sql (수집한 날 하나에 한 줄) · 0226_listing_centric.sql
  매매는 날마다의 기록(market_sale)과 **수집 매물**(app.listings · 주인 = 수집 사무소 「네이버」 + app.listing_crawl)로 간다(0226).
  수집 매물은 건물마다 하나 — 그날 값으로 매매가 · seen_on 을 고치고, 끝까지 다 돈 수집에서 안 보이면 gone_on 을 찍는다

- 서울 매물만(address.city = 서울시). 같은 매물 번호는 한 번만.
- 건물은 **좌표가 든 필지**로 붙인다(옛 크롤러의 「좌표 → 주소」와 같은 결과). 최근접 스냅은 쓰지 않는다 —
  4.7%가 옆 건물에 붙었다([[rent-crawl-bench]]). 필지에 건물이 없으면(나대지) 버린다.
  **토지 광고만 예외(10-08)** — 건물 없는 필지면 그 나대지(`'P' + pnu`, master.vacant_parcels)에 붙는다. 팀이 등록한
  나대지 매물과 같은 열쇠다. 건물이 있는 필지의 토지 광고는 그 건물(지번 대표)에 붙는다. 건물 일부 거름(연면적 · 추정가)은
  나대지엔 견줄 값이 없어 안 걸린다.
- **같은 것을 여러 중개사가 올린 광고는 노이즈다(대표 10-04).** 그날 가장 싼 하나만 남기고 몇 건이었는지(n_ads)만 적는다.
    매매  건물 하나 = 하나. 통매매만 — 층 칸이 건물 규모(「-1/4」 · 「0/5」 · 「전체층/4」)가 아니라
          특정 층(「2/6」 · 「-2/-1」)이면 구분 매물이라 뺀다.
          **광고 연면적이 대장 연면적의 70% 미만이어도 뺀다(10-04).** 구분 호실 · 상가 부분만 묶은 광고가
          「빌딩 · 상가건물」로 올라온다(역삼동 831-11 루카831: 29층 건물에 「2/B1 · 14,439㎡」 120억).
          실측: 광고 96%는 대장과 0.9~1.1배, 0.3배 미만 204건은 호가가 추정가의 21%. 연면적이 없으면 견줄 수 없어 둔다.
          **호가가 추정가의 20% 미만이어도 뺀다(10-04).** 구분 호실 광고가 대지 · 연면적 칸에 건물 전체 값을 적어
          면적 규칙을 통과한다(역삼동 736-24: 「1층 상가 급매」 9.5억 · 연면적 24,533㎡ 그대로 · 추정가 2,805억).
          추정가 오차는 가운데 17~25%라 다섯 배 넘게 어긋난 것만 걸린다(실측 120건). 추정가가 없으면 걸지 않는다
    임대  같은 층 · 같은 면적(계약면적 ㎡ 반올림)이면 같은 공간. 월세가 가장 싼 광고, 같으면 보증금이 싼 것.
          월세 광고가 있으면 전세(월세 0)보다 앞선다 — 0 이 「가장 싼 월세」로 뽑히면 안 된다
- 층: 「3/15」→3층 · 「B1/5」·「-1/4」→지하1층 · 「저/7」 같은 글자는 null.
- 면적 0 은 모르는 값이라 null. 계약면적이 없는 임대 광고는 공간을 못 가르니 버린다. 가격은 원 단위.
- 같은 날을 다시 적재하면 그날 줄을 지우고 새로 쓴다(다른 날 줄은 그대로 — 시계열).

    backend/.venv/bin/python scripts/market/load_market.py --day 20261003 [--kind sale|rent|all] [--file 원문.jsonl.gz]
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import gzip
import json
import os
import re

import asyncpg

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB = os.environ.get("DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")
SOURCE = "naver"
# 네이버 유형 원문. 매물유형으로 바꾸는 대응은 ref.enums building_major meta.naver 한 곳(0246 · 0248)
TYPE_NAME = {"D01": "사무실", "D02": "상가", "D03": "빌딩", "D04": "상가건물", "D05": "상가주택",
             "E01": "숙박", "E02": "공장·창고", "E03": "토지", "A02": "오피스텔",
             "C02": "빌라", "A05": "연립", "A06": "다세대", "A07": "도시형생활주택",
             "C03": "단독/다가구", "C04": "전원주택", "C06": "한옥주택"}


def num(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x > 0 else None


def won(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return int(x) if x >= 0 else None


def day_of(s):
    try:
        return dt.date.fromisoformat(str(s)[:10])
    except (TypeError, ValueError):
        return None


def floor_of(note: str | None) -> str | None:
    """「3/15」→3층 · 「B1/5」·「-1/4」→지하1층. 글자(저 · 중 · 고)나 0 이면 모른다"""
    head = (note or "").split("/")[0].strip()
    m = re.fullmatch(r"(?:B|-)(\d+)", head, re.I)
    if m and int(m.group(1)) > 0:
        return f"지하{int(m.group(1))}층"
    if re.fullmatch(r"\d+", head) and int(head) > 0:
        return f"{int(head)}층"
    return None


def is_unit_sale(note: str | None) -> bool:
    """매매 층 칸이 특정 층이면 구분 매물. 통매매는 「지하층수/지상층수」(-1/4 · 0/5) 또는 「전체층/4」"""
    parts = (note or "").split("/")
    if len(parts) != 2:
        return False
    a, b = parts[0].strip(), parts[1].strip()
    if b.startswith("-"):                       # 「-2/-1」 — 지하 몇 층 중 하나
        return True
    return bool(re.fullmatch(r"\d+", a)) and int(a) > 0   # 「2/6」 — 6층 건물의 2층


def rows(path: str, kind: str):
    seen = set()
    with gzip.open(path, "rt", encoding="utf-8") if path.endswith(".gz") else open(path, encoding="utf-8") as f:
        for line in f:
            try:
                a = json.loads(line)
            except json.JSONDecodeError:
                continue  # 끊긴 마지막 줄
            no = a.get("articleNumber")
            ad = a.get("address") or {}
            if not no or no in seen or ad.get("city") != "서울시":
                continue
            seen.add(no)
            c = ad.get("coordinates") or {}
            sp, pr = a.get("spaceInfo") or {}, a.get("priceInfo") or {}
            note = (a.get("articleDetail") or {}).get("floorInfo") or None
            common = (str(no), num(c.get("xCoordinate")), num(c.get("yCoordinate")),
                      TYPE_NAME.get(a.get("realEstateType"), a.get("realEstateType")),
                      day_of((a.get("verificationInfo") or {}).get("articleConfirmDate")))
            if kind == "sale":
                price = won(pr.get("dealPrice"))
                if not price or is_unit_sale(note):
                    continue
                yield common + (price, num(sp.get("landSpace")), num(sp.get("floorSpace")) or num(sp.get("exclusiveSpace")))
            else:
                area = num(sp.get("supplySpace"))
                if not area:
                    continue
                yield common + (floor_of(note), area, num(sp.get("exclusiveSpace")),
                                won(pr.get("warrantyPrice")), won(pr.get("rentPrice")))


COMMON = ["no", "lng", "lat", "use_type", "posted_on"]
COLS = {
    "sale": COMMON + ["price", "land_area", "total_area"],
    "rent": COMMON + ["floor", "contract_area", "excl_area", "deposit", "rent"],
}
TYPES = {"no": "text", "lng": "float8", "lat": "float8", "use_type": "text", "posted_on": "date",
         "price": "bigint", "land_area": "numeric", "total_area": "numeric", "floor": "text",
         "contract_area": "numeric", "excl_area": "numeric", "deposit": "bigint", "rent": "bigint"}

# 같은 것끼리 묶어 가장 싼 하나. 순서가 「가장 싼」의 뜻이다
PICK = {
    "sale": """
        CREATE TEMP TABLE _pick ON COMMIT DROP AS
        SELECT DISTINCT ON (building_pk) building_pk, price, posted_on,
               count(*) OVER (PARTITION BY building_pk) AS n_ads, land_area, total_area, use_type
          FROM _a WHERE NOT part
         ORDER BY building_pk, price, posted_on DESC NULLS LAST;
        INSERT INTO master.market_sale(building_pk, observed_on, price, posted_on, n_ads, land_area, total_area, use_type)
        SELECT building_pk, $1, price, posted_on, n_ads, land_area, total_area, use_type FROM _pick""",
    "rent": """
        INSERT INTO master.market_rent(building_pk, floor, area_key, observed_on, contract_area, excl_area,
                                       deposit, rent, posted_on, n_ads, use_type)
        SELECT DISTINCT ON (building_pk, COALESCE(floor, ''), round(contract_area)::int)
               building_pk, floor, round(contract_area)::int, $1, contract_area, excl_area, deposit, rent, posted_on,
               count(*) OVER (PARTITION BY building_pk, COALESCE(floor, ''), round(contract_area)::int), use_type
          FROM _a
         ORDER BY building_pk, COALESCE(floor, ''), round(contract_area)::int,
                  COALESCE(rent, 0) = 0, rent, deposit NULLS LAST, posted_on DESC NULLS LAST""",
}


async def crawl_listings(con, day: dt.date, complete: bool) -> None:
    """수집 매물(0226) — 주인은 수집 사무소 「네이버」. 지번마다 하나(0229). 가장 최근 수집일보다 옛날 판을 다시 적재할 때는
    매물을 건드리지 않는다(지금 값은 가장 최근 수집일의 값이다)."""
    latest = await con.fetchval("SELECT max(observed_on) FROM master.market_sale")
    if latest is not None and day < latest:
        return
    team = await con.fetchval("SELECT id FROM app.teams WHERE system AND name = '네이버'")
    # 매물은 지번마다 하나(0229 · 0255) — 광고가 붙은 동(또는 나대지)의 지번으로 모으고, 한 지번에 둘이면 싼 것(§2-4)
    await con.execute(
        """CREATE TEMP TABLE _pick_pnu ON COMMIT DROP AS
           SELECT DISTINCT ON (pnu) p.* FROM (SELECT p.*, app.pnu_of(p.building_pk) AS pnu FROM _pick p) p
            WHERE pnu IS NOT NULL
            ORDER BY pnu, price NULLS LAST""")
    # 새 지번이면 매물 + 지번 연결을 만든다(한 팀 한 지번 매물 하나 · listing_parcels_team_pnu)
    await con.execute(
        """WITH new AS (SELECT p.pnu FROM _pick_pnu p
                         WHERE NOT EXISTS (SELECT 1 FROM app.listing_parcels lp WHERE lp.team_id = $1 AND lp.pnu = p.pnu)),
                ins AS (INSERT INTO app.listings(team_id) SELECT $1 FROM new RETURNING id),
                pair AS (SELECT i.id, n.pnu FROM (SELECT id, row_number() OVER (ORDER BY id) k FROM ins) i
                           JOIN (SELECT pnu, row_number() OVER (ORDER BY pnu) k FROM new) n USING (k))
           INSERT INTO app.listing_parcels(listing_id, pnu, main) SELECT id, pnu, true FROM pair""", team)
    await con.execute(
        """UPDATE app.listings l SET price = p.price, price_on = $2, updated_at = now()
             FROM _pick_pnu p JOIN app.listing_parcels lp ON lp.pnu = p.pnu AND lp.team_id = $1
            WHERE l.id = lp.listing_id""", team, day)
    await con.execute(
        """INSERT INTO app.listing_crawl(listing_id, seen_on, gone_on, n_ads, posted_on, ad_land_area, ad_total_area, ad_use_type)
           SELECT lp.listing_id, $2, NULL, p.n_ads, p.posted_on, p.land_area, p.total_area, p.use_type
             FROM _pick_pnu p JOIN app.listing_parcels lp ON lp.pnu = p.pnu AND lp.team_id = $1
           ON CONFLICT (listing_id) DO UPDATE SET seen_on = EXCLUDED.seen_on, gone_on = NULL, n_ads = EXCLUDED.n_ads,
             posted_on = EXCLUDED.posted_on, ad_land_area = EXCLUDED.ad_land_area,
             ad_total_area = EXCLUDED.ad_total_area, ad_use_type = EXCLUDED.ad_use_type""", team, day)
    if complete:   # 끝까지 다 돈 수집에서만 「내려감」을 판정한다(중간에 멈춘 수집은 없어짐을 모른다)
        await con.execute(
            """UPDATE app.listing_crawl c SET gone_on = $2
                 FROM app.listings l WHERE l.id = c.listing_id AND l.team_id = $1
                  AND c.gone_on IS NULL AND c.seen_on < $2""", team, day)


async def load(con, kind: str, path: str, day: dt.date, complete: bool):
    table = f"master.market_{kind}"
    cols = COLS[kind]
    recs = list(rows(path, kind))
    run_id = await con.fetchval("INSERT INTO master.market_run(kind, source, n_seen) VALUES ($1, $2, $3) RETURNING id",
                                "매매" if kind == "sale" else "임대", SOURCE, len(recs))
    async with con.transaction():
        await con.execute(f"CREATE TEMP TABLE _m ({', '.join(f'{c} {TYPES[c]}' for c in cols)}) ON COMMIT DROP")
        await con.copy_records_to_table("_m", records=recs, columns=cols)
        # 좌표가 든 필지 → 건물. 한 좌표에 필지가 겹치면 건물 있는 필지 먼저(겹침은 지적 오류). 건물 없는 필지는 버린다 —
        # 토지 광고만 그 나대지('P' + pnu)에 붙인다(10-08). 나대지 목록에 없는 필지(도로 등)면 그래도 버린다
        await con.execute("""
            CREATE TEMP TABLE _a ON COMMIT DROP AS
            SELECT m.*, p.building_pk
              FROM _m m JOIN LATERAL (
                SELECT COALESCE(p.building_pk, 'P' || v.pnu) AS building_pk FROM master.parcels p
                  LEFT JOIN master.vacant_parcels v ON v.pnu = p.pnu AND p.building_pk IS NULL AND m.use_type = '토지'
                 WHERE ST_Contains(p.geom, ST_SetSRID(ST_Point(m.lng, m.lat), 4326))
                   AND (p.building_pk IS NOT NULL OR v.pnu IS NOT NULL)
                 ORDER BY p.building_pk IS NULL
                 LIMIT 1) p ON true""")
        n_bld = await con.fetchval("SELECT count(*) FROM _a")
        n_part = 0
        if kind == "sale":
            # 건물 일부만 판 광고(광고 연면적 < 대장 연면적 × 0.7 · 호가 < 추정가 × 0.2) — 표시만 해 두고 고르기에서 뺀다
            await con.execute("""
                ALTER TABLE _a ADD COLUMN part boolean NOT NULL DEFAULT false;
                UPDATE _a SET part = true FROM master.buildings b
                 WHERE b.building_pk = _a.building_pk AND _a.total_area > 0 AND b.total_area > 0
                   AND _a.total_area < b.total_area * 0.7;
                UPDATE _a SET part = true FROM master.parcel_sale_est e
                 WHERE e.pnu = app.pnu_of(_a.building_pk) AND e.sale_est > 0 AND _a.price < e.sale_est * 0.2""")
            n_part = await con.fetchval("SELECT count(*) FROM _a WHERE part")
        await con.execute(f"DELETE FROM {table} WHERE observed_on = $1", day)   # 같은 날 다시 적재
        if kind == "sale":
            # 문장 둘(고르기 · 수집 기록)이라 인자 묶음이 안 된다 — 날짜를 박아 넣는다(우리가 만든 date 값)
            await con.execute(PICK[kind].replace("$1", f"DATE '{day.isoformat()}'"))
            n = await con.fetchval("SELECT count(*) FROM _pick")
            await crawl_listings(con, day, complete)
        else:
            n = int((await con.execute(PICK[kind], day)).split()[-1])
        await con.execute("UPDATE master.market_run SET finished_at = now(), ok = $2 WHERE id = $1", run_id, complete)
    unit = "건물" if kind == "sale" else "공간"
    print(f"{kind}: 서울 광고 {len(recs):,} · 건물 붙음 {n_bld:,}"
          f"{f' · 건물 일부 광고 뺌 {n_part:,}' if kind == 'sale' else ''} · 중복 걷고 {unit} {n:,}줄"
          f"{'' if complete else ' (수집이 끝까지 안 돈 판)'}", flush=True)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--day", required=True, help="수집한 날(YYYYMMDD) — 원문 폴더 이름이자 시계열의 날짜")
    ap.add_argument("--kind", choices=["sale", "rent", "all"], default="all")
    ap.add_argument("--file", help="원문 파일을 직접 지정(시험용)")
    a = ap.parse_args()
    day = dt.datetime.strptime(a.day, "%Y%m%d").date()
    base = os.path.join(ROOT, "data", "raw", "_market", a.day)
    con = await asyncpg.connect(DB)
    try:
        for kind in (["sale", "rent"] if a.kind == "all" else [a.kind]):
            if a.file:
                await load(con, kind, a.file, day, False); continue
            path = os.path.join(base, f"{kind}.jsonl.gz")
            if not os.path.exists(path):
                print(f"{kind}: 원문 없음 — {path}"); continue
            done_p = os.path.join(base, f"{kind}.done.json")
            complete = os.path.exists(done_p) and json.load(open(done_p)).get("complete", False)
            await load(con, kind, path, day, complete)
    finally:
        await con.close()


if __name__ == "__main__":
    asyncio.run(main())
