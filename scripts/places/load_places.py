#!/usr/bin/env python3
"""카카오 장소 수집 결과를 `master.place` · `master.biz` 로 적재한다(2026-09-27, 스펙 11 §7).

    BT_DATABASE_URL=... backend/.venv/bin/python scripts/places/load_places.py [data/raw/_places/20260926]

인자를 안 주면 `data/raw/_places/` 아래 가장 최근 날짜 폴더를 읽는다.

## 표
  master.place           카카오 1곳 = 1줄. (source, source_id) 유일 — 다음 수집 때 같은 장소를 알아보는 열쇠.
                         **upsert** 다: first_seen 은 처음 본 날, last_seen 은 이번 수집일.
                         이번에 수집한 도로명에서 안 보인 장소는 gone_on = 이번 수집일(없어짐 = 다음 수집에 없으면, §4)
  master.biz             우리 쪽 업체 하나. 네이버를 버려 지금은 카카오 장소와 1:1 이다. 매번 place 에서 다시 만든다
  master.place_crawl_log 도로명 한 번 수집 = 1줄(질의어 · 전체 · 받은 수 · 버린 수 · 시각)
  ref.biz_cat            업종 나무(카카오 기준, §6). 경로 「의료,건강 > 병원 > 피부과」로 부모-자식

## 건물 붙이기
수집 줄마다 그 도로명의 우리 건물번호 목록(pks)이 있다. 하나면 그대로, 여럿이면 장소의 **지번**
(「역삼동 809-12」)과 건물 대장 지번이 같은 것 하나. 여럿이 같거나 못 맞추면 null — 지어내지 않는다.

## 층
상세주소 끝(「대연빌딩 2-5층」 · 「3층 301호」 · 「B1층」)에서 읽는다. 원문은 floor_raw 에 그대로 둔다.
「2-5층」처럼 여러 층을 쓰는 곳은 **낮은 층**을 floor 로 둔다(그 층에 있는 것은 사실이다).
못 읽으면 같은 건물의 상가정보·인허가에서 **같은 이름**의 층을 빌리고 floor_from 에 출처를 남긴다.

## 링크(URL)는 저장하지 않는다(§7). 건물 그 자체(업종 「부동산 > 빌딩」)는 업체로 세지 않는다.
"""
import asyncio
import datetime as dt
import glob
import importlib.util
import json
import os
import re
import sys
import time

import asyncpg

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "backend"))
from app.core.floor_label import normalize as norm_floor  # noqa: E402
from app.domains.tenants import norm_name  # noqa: E402

DSN = os.environ.get("BT_DATABASE_URL") or os.environ.get(
    "DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")

DDL = """
CREATE TABLE IF NOT EXISTS master.place(
  id          bigserial PRIMARY KEY,
  source      text NOT NULL,              -- kakao (네이버는 버렸다)
  source_id   text NOT NULL,              -- 카카오 장소 번호
  name        text,
  cat_path    text,                       -- 「의료,건강 > 병원 > 피부과」
  cat_tokens  text[],                     -- 경로를 마디로 쪼갠 것
  phone       text,
  road_addr   text,                       -- 수집한 도로명(우리 쪽 표기)
  jibun_addr  text,                       -- 카카오 지번 주소 + 상세
  floor_raw   text,                       -- 상세주소 원문. 없으면 null
  building_pk text,                       -- 붙인 우리 건물. 못 붙으면 null
  lng double precision, lat double precision,
  biz_id      bigint,
  first_seen  date NOT NULL, last_seen date NOT NULL, gone_on date,
  UNIQUE (source, source_id));
CREATE INDEX IF NOT EXISTS place_bldg ON master.place(building_pk) WHERE gone_on IS NULL;
CREATE INDEX IF NOT EXISTS place_road ON master.place(road_addr);

CREATE TABLE IF NOT EXISTS master.biz(
  id          bigserial PRIMARY KEY,
  building_pk text,
  name        text, name_norm text,
  phone       text,
  floor       text,                       -- 정규화한 층. 크롤링 → 없으면 상가정보·인허가에서 빌림
  floor_from  text,                       -- crawl | sbiz | localdata (내부 검증용 · 화면엔 안 쓴다)
  cat_nodes   text[],                     -- 업종 조상까지 펼친 것(§6). 검색은 낱말 = ANY(cat_nodes)
  first_seen  date, last_seen date, gone_on date);

CREATE TABLE IF NOT EXISTS master.place_crawl_log(
  crawl_day date NOT NULL, source text NOT NULL, road text NOT NULL,
  pks text[], query text, total int, got int, dropped int, at timestamptz, error text);
CREATE INDEX IF NOT EXISTS place_crawl_log_day ON master.place_crawl_log(crawl_day, source);

CREATE TABLE IF NOT EXISTS ref.biz_cat(
  id serial PRIMARY KEY, name text NOT NULL, parent_id int REFERENCES ref.biz_cat(id),
  path text NOT NULL UNIQUE, depth smallint NOT NULL);
"""

BIZ_IDX = """
CREATE INDEX IF NOT EXISTS biz_bldg ON master.biz(building_pk) WHERE gone_on IS NULL;
CREATE INDEX IF NOT EXISTS biz_cat ON master.biz USING gin(cat_nodes);
CREATE INDEX IF NOT EXISTS biz_name ON master.biz USING gin(name_norm gin_trgm_ops);
"""

# 층 — 「지하1층」·「B1층」·「2층」·「2-5층」. 호수만 있는 「B-01호」는 층이 아니다
_FL = re.compile(r"(?:지하\s*(\d+)|B\s*(\d+)|(\d{1,2}))\s*(?:[-~]\s*\d{1,2}\s*)?층")
# 지번 — 「역삼동 809-12」 · 「종로1가 12」 · 「산 12-3」
_JIBUN = re.compile(r"(\S+?(?:동|가|로))\s*(\d*가)?\s+(산\s*)?(\d+(?:-\d+)?)")


def load_reader():
    spec = importlib.util.spec_from_file_location(
        "crawl_places", os.path.join(ROOT, "scripts/places/crawl_places.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m.read_members


def detail(p: dict) -> str:
    """상세주소 — new_address_disp 의 마지막 칸(「서울|강남구||강남대로|452|대연빌딩 2-5층」)."""
    d = (p.get("new_address_disp") or "").split("|")
    return d[-1].strip() if len(d) >= 6 else ""


def read_floor(det: str) -> str | None:
    m = _FL.search(det or "")
    if not m:
        return None
    if m.group(1) or m.group(2):
        return f"지하{int(m.group(1) or m.group(2))}층"
    return norm_floor(f"{int(m.group(3))}층")[0]


def jibun_key(s: str | None) -> str | None:
    """「서울 강남구 역삼동 809-12 대연빌딩」·「서울특별시 강남구 역삼동 809-12번지」 → 「역삼동809-12」"""
    m = _JIBUN.search((s or "").replace("번지", " "))
    if not m:
        return None
    return f"{m.group(1)}{m.group(2) or ''}{'산' if m.group(3) else ''}{m.group(4)}"


def cat_path(p: dict) -> list[str]:
    return [p[k].strip() for k in (f"cate_name_depth{i}" for i in range(1, 6)) if (p.get(k) or "").strip()]


async def main(folder: str) -> None:
    day = os.path.basename(folder.rstrip("/"))
    crawl_day = f"{day[:4]}-{day[4:6]}-{day[6:8]}"
    cday = dt.date.fromisoformat(crawl_day)         # 질의 인자는 날짜 값으로(asyncpg 는 글자를 안 받는다)
    path = os.path.join(folder, "kakao.jsonl.gz")
    t0 = time.time()
    read_members = load_reader()

    con = await asyncpg.connect(DSN)
    await con.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    await con.execute(DDL)

    # 건물 지번 — 여러 건물이 한 도로명에 걸릴 때 가른다
    baddr = {r["building_pk"]: jibun_key(r["addr"]) for r in await con.fetch(
        "SELECT building_pk, addr FROM master.buildings WHERE addr IS NOT NULL")}
    print(f"건물 지번 {len(baddr):,} · {time.time()-t0:.0f}s", flush=True)

    places: dict[str, tuple] = {}
    logs: list[tuple] = []
    paths: set[tuple[str, ...]] = set()
    roads: set[str] = set()
    one = many = none = 0
    for line in read_members(path):
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        road = rec.get("road")
        if not road or road in roads:
            continue
        roads.add(road)
        pks = rec.get("pks") or []
        got = rec.get("places") or []
        logs.append((crawl_day, "kakao", road, pks, rec.get("q"), rec.get("total"), len(got),
                     rec.get("dropped"), rec.get("at"), None))
        for p in got:
            sid = str(p.get("confirmid") or "")
            if not sid or sid in places:
                continue
            det = detail(p)
            cp = cat_path(p)
            if cp:
                paths.add(tuple(cp))
            if len(pks) == 1:
                bpk = pks[0]; one += 1
            else:
                k = jibun_key(p.get("address"))
                hit = [x for x in pks if k and baddr.get(x) == k]
                bpk = hit[0] if len(hit) == 1 else None
                many += bpk is not None
                none += bpk is None
            places[sid] = ("kakao", sid, p.get("name"), " > ".join(cp) or None, cp or None,
                           p.get("tel") or None, road, p.get("address"), det or None, bpk,
                           p.get("lon"), p.get("lat"))
    print(f"도로명 {len(roads):,} · 장소 {len(places):,} · 건물 하나 {one:,} · 지번으로 {many:,} · 못 붙임 {none:,}"
          f" · {time.time()-t0:.0f}s", flush=True)

    async with con.transaction():
        # 업종 나무 — 짧은 경로부터(부모가 먼저 서야 한다)
        known = {r["path"]: r["id"] for r in await con.fetch("SELECT id, path FROM ref.biz_cat")}
        for cp in sorted({c[:i] for c in paths for i in range(1, len(c) + 1)}, key=len):
            pth = " > ".join(cp)
            if pth in known:
                continue
            known[pth] = await con.fetchval(
                "INSERT INTO ref.biz_cat(name, parent_id, path, depth) VALUES($1,$2,$3,$4) RETURNING id",
                cp[-1], known.get(" > ".join(cp[:-1])) if len(cp) > 1 else None, pth, len(cp))

        # place — 임시 표로 한 번에 넣고 upsert
        await con.execute("""CREATE TEMP TABLE _pl (source text, source_id text, name text, cat_path text,
            cat_tokens text[], phone text, road_addr text, jibun_addr text, floor_raw text, building_pk text,
            lng double precision, lat double precision) ON COMMIT DROP""")
        await con.copy_records_to_table("_pl", records=list(places.values()))
        await con.execute("""
            INSERT INTO master.place(source, source_id, name, cat_path, cat_tokens, phone, road_addr, jibun_addr,
                                     floor_raw, building_pk, lng, lat, first_seen, last_seen, gone_on)
            SELECT source, source_id, name, cat_path, cat_tokens, phone, road_addr, jibun_addr,
                   floor_raw, building_pk, lng, lat, $1::date, $1::date, NULL FROM _pl
            ON CONFLICT (source, source_id) DO UPDATE SET
              name=EXCLUDED.name, cat_path=EXCLUDED.cat_path, cat_tokens=EXCLUDED.cat_tokens,
              phone=EXCLUDED.phone, road_addr=EXCLUDED.road_addr, jibun_addr=EXCLUDED.jibun_addr,
              floor_raw=EXCLUDED.floor_raw, building_pk=EXCLUDED.building_pk, lng=EXCLUDED.lng, lat=EXCLUDED.lat,
              last_seen=GREATEST(master.place.last_seen, EXCLUDED.last_seen), gone_on=NULL""", cday)
        # 이번에 수집한 도로명에서 안 보인 장소 = 없어짐(§4). 실패한 도로명은 수집 목록에 없으니 안 걸린다
        await con.execute("CREATE TEMP TABLE _rd (road text PRIMARY KEY) ON COMMIT DROP")
        await con.copy_records_to_table("_rd", records=[(r,) for r in roads])
        gone = await con.execute("""
            UPDATE master.place p SET gone_on = $1::date
             WHERE p.source='kakao' AND p.gone_on IS NULL AND p.last_seen < $1::date
               AND EXISTS (SELECT 1 FROM _rd WHERE _rd.road = p.road_addr)""", cday)

        await con.execute("DELETE FROM master.place_crawl_log WHERE crawl_day=$1::date AND source='kakao'", cday)
        kst = dt.timezone(dt.timedelta(hours=9))        # 수집기는 한국 시각으로 적는다
        await con.copy_records_to_table("place_crawl_log", schema_name="master", records=[
            (dt.date.fromisoformat(c), src, r, pk, q, tot, g, dr,
             dt.datetime.fromisoformat(a).replace(tzinfo=kst) if a else None, e)
            for c, src, r, pk, q, tot, g, dr, a, e in logs])
    print(f"place 적재 · 없어짐 {gone} · {time.time()-t0:.0f}s", flush=True)

    # biz — place 에서 다시 만든다. 층 못 읽은 것은 상가정보·인허가에서 같은 이름의 층을 빌린다
    rows = await con.fetch("""SELECT id, source_id, name, phone, building_pk, floor_raw, cat_tokens,
                                     first_seen, last_seen, gone_on
                                FROM master.place WHERE source='kakao'
                                  AND NOT COALESCE(cat_tokens[1:2] = ARRAY['부동산','빌딩'], false)""")
    ledger: dict[str, list[tuple[str, str, str]]] = {}
    for r in await con.fetch("""
            SELECT bp.building_pk, s.name, s.floor_no, s.is_base, 'sbiz' AS src
              FROM master.sbiz_store s JOIN master.building_parcels bp ON bp.pnu = s.pnu
             WHERE s.floor_no IS NOT NULL OR s.is_base"""):
        fl = (f"지하{abs(r['floor_no'])}층" if r["is_base"] or (r["floor_no"] or 0) < 0 else f"{r['floor_no']}층") \
            if r["floor_no"] is not None else None
        if fl:
            ledger.setdefault(r["building_pk"], []).append((norm_name(r["name"]), fl, r["src"]))
    print(f"상가정보 층 {sum(len(v) for v in ledger.values()):,} · {time.time()-t0:.0f}s", flush=True)
    for r in await con.fetch("""
            SELECT bp.building_pk, l.name, l.floor_no, l.is_base
              FROM master.localdata_permit l
              JOIN master.parcels p ON l.geom && p.geom AND ST_Contains(p.geom, l.geom)
              JOIN master.building_parcels bp ON bp.pnu = p.pnu
             WHERE l.state = '영업' AND l.floor_no IS NOT NULL"""):
        fl = f"지하{abs(r['floor_no'])}층" if r["is_base"] or r["floor_no"] < 0 else f"{r['floor_no']}층"
        ledger.setdefault(r["building_pk"], []).append((norm_name(r["name"]), fl, "localdata"))
    print(f"인허가 층 더함 · {time.time()-t0:.0f}s", flush=True)

    def borrow(bpk: str | None, nm: str) -> tuple[str | None, str | None]:
        if not bpk or not nm:
            return None, None
        for k, fl, src in ledger.get(bpk, []):
            if k == nm or (len(k) >= 3 and len(nm) >= 3 and (k.startswith(nm) or nm.startswith(k))):
                return fl, src
        return None, None

    nodes_of = {pth: pth.split(" > ") for pth in known}
    biz = []
    counts = {"crawl": 0, "sbiz": 0, "localdata": 0, None: 0}
    for r in rows:
        nm = norm_name(r["name"])
        fl, src = read_floor(r["floor_raw"]), "crawl"
        if not fl:
            fl, src = borrow(r["building_pk"], nm)
        counts[src if fl else None] += 1
        toks = list(r["cat_tokens"] or [])
        biz.append((r["id"], r["building_pk"], r["name"], nm, r["phone"], fl, src if fl else None,
                    nodes_of.get(" > ".join(toks), toks) or None, r["first_seen"], r["last_seen"], r["gone_on"]))
    async with con.transaction():
        await con.execute("TRUNCATE master.biz RESTART IDENTITY")
        await con.copy_records_to_table("biz", schema_name="master", records=[b[1:] for b in biz],
                                        columns=["building_pk", "name", "name_norm", "phone", "floor", "floor_from",
                                                 "cat_nodes", "first_seen", "last_seen", "gone_on"])
        # place.biz_id — 1:1 이라 넣은 순서대로 잇는다(RESTART IDENTITY 라 1부터)
        await con.execute("CREATE TEMP TABLE _bz (place_id bigint, biz_id bigint) ON COMMIT DROP")
        await con.copy_records_to_table("_bz", records=[(b[0], i + 1) for i, b in enumerate(biz)])
        await con.execute("UPDATE master.place p SET biz_id = b.biz_id FROM _bz b WHERE b.place_id = p.id")
        await con.execute(BIZ_IDX)
    await con.execute("ANALYZE master.place; ANALYZE master.biz")
    print(f"biz {len(biz):,} · 층 크롤링 {counts['crawl']:,} · 상가정보 {counts['sbiz']:,}"
          f" · 인허가 {counts['localdata']:,} · 모름 {counts[None]:,} · {time.time()-t0:.0f}s", flush=True)
    await con.close()


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else None
    if not arg:
        days = sorted(d for d in glob.glob(os.path.join(ROOT, "data/raw/_places/*"))
                      if os.path.exists(os.path.join(d, "kakao.jsonl.gz")))
        if not days:
            sys.exit("수집 결과가 없다: data/raw/_places/<날짜>/kakao.jsonl.gz")
        arg = days[-1]
    asyncio.run(main(arg))
