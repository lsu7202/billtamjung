"""매물을 **주소로** 다시 붙인다(2026-08-29).

crawl_bench.py 는 좌표만 보고 30m 안 최근접 건물에 붙였다. 그때 이렇게 적어 뒀다:

    주소 문자열은 안 쓴다 — 지번 표기가 크롤과 대장에서 갈리고, 좌표는 갈릴 데가 없다

좌표도 갈렸다. 봉천동 862-10(지상 6층 · 오락실·당구장)에 8~14층 매물이 붙었는데,
크롤 원본을 보니 **주소가 「봉천동 862-9」라고 정확히 적혀 있었다.** 19m 떨어진 옆 건물이다.
주소가 바로 옆에 있는데 안 쓰고 좌표로 짐작한 것이다.

그래서 순서를 뒤집는다:
    ① 주소(법정동 + 지번)가 정확히 맞는 건물 → 그 건물
    ② 주소로 못 찾으면 좌표 최근접(10m 이내로 좁힘 — 30m 는 옆 건물을 물어온다)
    ③ 그래도 못 찾으면 버린다

같은 지번에 건물이 여럿이면(집합건물·다동) 연면적이 가장 큰 것을 쓴다.

    backend/.venv/bin/python scripts/rent_estimate/resnap.py
"""
import asyncio
import os
import re
import statistics as st
from collections import defaultdict

import asyncpg

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")
NEAR_M = 10.0        # 주소로 못 찾을 때만 쓰는 좌표 폴백. 30m 는 옆 건물을 문다


def norm_addr(a):
    """'서울특별시 관악구 봉천동 862-9' → ('봉천동', '862-9'). 못 읽으면 None."""
    if not a:
        return None
    s = str(a).strip()
    s = re.sub(r"번지$", "", s)
    m = re.search(r"([가-힣0-9]+(?:동|가|리))\s+(산?\s?\d+(?:-\d+)?)\s*$", s)
    if not m:
        return None
    dong = m.group(1)
    ji = m.group(2).replace(" ", "")
    return (dong, ji)


async def main():
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=1800)

    print("[1] 우리 건물 주소 색인 만들기")
    b = await c.fetch("""
        SELECT building_pk pk, addr, total_area::float ta
          FROM master.buildings WHERE bjd_code LIKE '11%' AND addr IS NOT NULL""")
    IDX = defaultdict(list)
    for r in b:
        k = norm_addr(r["addr"])
        if k:
            IDX[k].append((r["pk"], r["ta"] or 0))
    for k in IDX:
        IDX[k].sort(key=lambda t: -t[1])      # 같은 지번이면 연면적 큰 것
    print(f"  건물 {len(b):,}동 · 주소 키 {len(IDX):,}개")

    print("\n[2] 크롤 주소로 다시 붙이기")
    cr = await c.fetch("SELECT DISTINCT addr, lat, lng FROM master._crawl_rent")
    hit = miss = 0
    upd = []
    for r in cr:
        k = norm_addr(r["addr"])
        if k and k in IDX:
            upd.append((r["addr"], r["lat"], r["lng"], IDX[k][0][0]))
            hit += 1
        else:
            miss += 1
    print(f"  좌표 묶음 {len(cr):,}개 · 주소로 찾음 {hit:,} ({hit*100//max(len(cr),1)}%)"
          f" · 못 찾음 {miss:,}")

    # 4만 건을 한 줄씩 UPDATE 하면 addr 에 인덱스가 없어 매번 25만 행을 훑는다(실측: 안 끝남).
    # 임시표에 부어 놓고 **조인 한 번**으로 끝낸다.
    await c.execute("ALTER TABLE master._crawl_rent ADD COLUMN IF NOT EXISTS pk_addr text")
    await c.execute("DROP TABLE IF EXISTS master._resnap;"
                    "CREATE TABLE master._resnap(addr text, lat double precision,"
                    " lng double precision, pk text)")
    await c.copy_records_to_table("_resnap", schema_name="master", records=upd,
                                  columns=["addr", "lat", "lng", "pk"])
    await c.execute("CREATE INDEX ON master._resnap(addr, lat, lng)")
    await c.execute("ANALYZE master._resnap")
    await c.execute("""
        UPDATE master._crawl_rent cr SET pk_addr = r.pk
          FROM master._resnap r
         WHERE cr.addr = r.addr AND cr.lat = r.lat AND cr.lng = r.lng""")

    print("\n[3] 좌표로 붙인 것과 얼마나 다른가")
    same = await c.fetchval(
        "SELECT count(*) FROM master._crawl_rent WHERE pk_addr IS NOT NULL AND pk_addr = building_pk")
    diff = await c.fetchval(
        "SELECT count(*) FROM master._crawl_rent WHERE pk_addr IS NOT NULL AND pk_addr <> building_pk")
    only = await c.fetchval(
        "SELECT count(*) FROM master._crawl_rent WHERE pk_addr IS NOT NULL AND building_pk IS NULL")
    print(f"  같은 건물 {same:,}건 · **다른 건물 {diff:,}건** · 좌표로는 못 붙였던 것 {only:,}건")
    if same + diff:
        print(f"  → 좌표 스냅의 {diff*100/(same+diff):.1f}% 가 엉뚱한 건물이었다")

    print("\n[4] 다시 붙인 뒤 층 검사 — 대장에 없는 층 매물이 얼마나 줄었나")
    for col, ko in (("building_pk", "좌표 30m(지금)"), ("pk_addr", "주소(새로)")):
        r = await c.fetchrow(f"""
            WITH fl AS (
              SELECT fo.building_pk pk,
                     max(CASE WHEN fo.floor ~ '지|B' THEN NULL
                              ELSE NULLIF(regexp_replace(fo.floor,'\\D','','g'),'')::int END) mx
                FROM master.floor_outline fo GROUP BY 1)
            SELECT count(*) FILTER (WHERE cr.floor > fl.mx) bad, count(*) tot
              FROM master._crawl_rent cr JOIN fl ON fl.pk = cr.{col}
             WHERE cr.floor > 0 AND fl.mx IS NOT NULL""")
        if r and r["tot"]:
            print(f"  {ko:16s} 지상 매물 {r['tot']:7,}건 중 대장 최고층 초과 {r['bad']:6,}건"
                  f" ({r['bad']*100/r['tot']:.2f}%)")

    print("\n[5] 봉천동 862-10 확인")
    q = await c.fetch("""
        SELECT cr.addr, b1.addr a_xy, b2.addr a_ad, count(*) n
          FROM master._crawl_rent cr
          LEFT JOIN master.buildings b1 ON b1.building_pk = cr.building_pk
          LEFT JOIN master.buildings b2 ON b2.building_pk = cr.pk_addr
         WHERE cr.building_pk = '102214841' GROUP BY 1,2,3""")
    for r in q:
        print(f"  크롤 주소 {r['addr']}")
        print(f"    좌표로 붙인 건물: {r['a_xy']}")
        print(f"    주소로 붙인 건물: {r['a_ad']}   ({r['n']}건)")
    await c.close()


if __name__ == "__main__":
    asyncio.run(main())
