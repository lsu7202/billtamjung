"""깨끗한 잣대를 만든다 — master._crawl_clean(2026-08-29).

앞서 쓰던 잣대(_crawl_rent.building_pk = 좌표 30m 최근접)에 오염이 있었다:
좌표 스냅의 4.7%가 엉뚱한 건물이었고, 방향이 한쪽으로 쏠렸다 —
신축·대형 건물은 좌표가 넓게 잡혀서 **비싼 매물이 낡은 건물 쪽으로 흘러갔다.**
그래서 「우리가 전반적으로 싸게 본다」는 결론이 나왔다. 그건 채점지가 남의 답을 쥔 것이다.

거르는 규칙 넷:
  ① **주소로 붙은 것만** 쓴다(resnap.py 의 pk_addr). 좌표 폴백은 안 쓴다 —
     주소로 못 찾는 건 대개 나대지·신축중이라 우리 대장에 아직 없는 건물이다.
  ② **대장에 있는 층**의 매물만. 6층 건물의 14층 매물은 남의 것이다.
  ③ **중복 매물 제거** — (보증금, 월세, **전용면적**)이 같으면 한 건.
     계약면적은 뺀다: 같은 물건을 **계약면적만 조금씩 바꿔** 여러 번 올리는 관행이 있다.
     실측(천호동 427-35) — 1층짜리 42㎡ 건물에 매물 4건이 붙었는데 전부 보증금 1억·월세 600만·
     전용 42.0㎡ 로 같고 계약면적만 달랐다. 실제로는 주점 하나가 들어선 단층 건물이다.
  ④ **층 면적 초과 검사** — 그 층 매물들의 전용면적 합이 대장 층면적의 1.3배를 넘으면
     중복이 남아 있다는 뜻이라 그 층을 통째로 버린다. 42㎡ 층에 42㎡ 매물이 넷일 수는 없다.
  ⑤ 단가 범위 밖(3천~40만원/㎡) 제외.

    backend/.venv/bin/python scripts/rent_estimate/build_clean_bench.py
"""
import asyncio
import os
import statistics as st
from collections import defaultdict

import asyncpg
import rent_common as RC

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")
UNIT_LO, UNIT_HI = 3_000, 400_000


async def main():
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=1800)
    n0 = await c.fetchval("SELECT count(*) FROM master._crawl_rent")
    print(f"원본 {n0:,}건")

    # ③ 중복 제거(계약면적 뺌) + ① 주소로 붙은 것만
    rows = await c.fetch(f"""
        SELECT DISTINCT ON (pk_addr, floor, deposit, rent, area_e)
               no, pk_addr pk, addr, floor, deposit, rent, area_c, area_e
          FROM master._crawl_rent
         WHERE pk_addr IS NOT NULL AND floor IS NOT NULL
           AND area_c > 0 AND rent > 0
           AND rent/area_c BETWEEN {UNIT_LO} AND {UNIT_HI}""")
    print(f"  주소로 붙고 중복 제거 후 {len(rows):,}건")

    # ② 대장에 있는 층만
    fo = await c.fetch("SELECT building_pk pk, floor FROM master.floor_outline")
    FL = defaultdict(set)
    for r in fo:
        n = RC.signed_floor(r["floor"])
        if n is not None:
            FL[r["pk"]].add(n)
    keep = [r for r in rows if r["floor"] in FL.get(r["pk"], set())]
    print(f"  대장에 있는 층만 남기면 {len(keep):,}건"
          f" (뺀 것 {len(rows)-len(keep):,}건)")

    # ④ 층 면적 초과 — 매물 전용면적 합이 대장 층면적을 크게 넘으면 중복이 남은 것
    fa = await c.fetch("SELECT building_pk pk, floor, use, floor_area::float a"
                       "  FROM master.floor_outline")
    AREA = defaultdict(float)
    for r in fa:
        n = RC.signed_floor(r["floor"])
        if n is not None and r["a"] and not any(k in (r["use"] or "") for k in RC.EXCL):
            AREA[(r["pk"], n)] += r["a"]
    sum_e = defaultdict(float)
    for r in keep:
        if r["area_e"]:
            sum_e[(r["pk"], r["floor"])] += float(r["area_e"])
    over = {k for k, v in sum_e.items()
            if AREA.get(k, 0) > 0 and v > AREA[k] * 1.3}
    keep2 = [r for r in keep if (r["pk"], r["floor"]) not in over]
    print(f"  층 면적 초과한 층 {len(over):,}개 빼면 {len(keep2):,}건"
          f" (뺀 것 {len(keep)-len(keep2):,}건)")
    keep = keep2

    await c.execute("""
        DROP TABLE IF EXISTS master._crawl_clean;
        CREATE TABLE master._crawl_clean(
          no text PRIMARY KEY, building_pk text, addr text, floor int,
          area_c real, area_e real, deposit bigint, rent bigint)""")
    await c.copy_records_to_table(
        "_crawl_clean", schema_name="master",
        records=[(r["no"], r["pk"], r["addr"], r["floor"], r["area_c"],
                  r["area_e"], r["deposit"], r["rent"]) for r in keep],
        columns=["no", "building_pk", "addr", "floor", "area_c", "area_e", "deposit", "rent"])
    await c.execute("CREATE INDEX ON master._crawl_clean(building_pk, floor)")
    await c.execute("ANALYZE master._crawl_clean")

    r = await c.fetchrow("""
        SELECT count(*) n, count(DISTINCT building_pk) bl,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY rent) med_rent,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY rent/area_c) u_c,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY rent/NULLIF(area_e,0)) u_e,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY deposit/NULLIF(rent,0)) dm,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY area_e/NULLIF(area_c,0)) eff
          FROM master._crawl_clean""")
    print(f"\n[깨끗한 잣대] 매물 {r['n']:,}건 · 건물 {r['bl']:,}동")
    print(f"  월세 중앙 {r['med_rent']:,.0f}원")
    print(f"  계약㎡당 {r['u_c']:,.0f}원 · 전용㎡당 {r['u_e']:,.0f}원")
    print(f"  보증금/월세 {r['dm']:.1f} · 전용률 {r['eff']:.3f}")

    old = await c.fetchrow("""
        SELECT count(*) n, count(DISTINCT building_pk) bl,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY rent/area_c) u_c
          FROM master._crawl_rent
         WHERE building_pk IS NOT NULL AND floor IS NOT NULL
           AND rent/area_c BETWEEN 3000 AND 400000""")
    print(f"\n[전과 비교] 옛 잣대 {old['n']:,}건 · {old['bl']:,}동 · 계약㎡당 {old['u_c']:,.0f}원")
    print(f"           새 잣대 {r['n']:,}건 · {r['bl']:,}동 · 계약㎡당 {r['u_c']:,.0f}원")
    d = (float(r['u_c']) / float(old['u_c']) - 1) * 100
    print(f"           → 잣대 단가가 {d:+.1f}% 움직였다")
    if d < 0:
        print("             오염이 잣대를 부풀리고 있었다는 뜻 — 「우리가 과소평가한다」가")
        print("             그만큼 과장돼 있었다.")

    print("\n[층 검사] 대장 최고층을 넘는 매물")
    for tbl, ko in (("_crawl_rent", "옛 잣대"), ("_crawl_clean", "새 잣대")):
        col = "building_pk"
        q = await c.fetchrow(f"""
            WITH fl AS (
              SELECT building_pk pk,
                     max(NULLIF(regexp_replace(floor,'\\D','','g'),'')::int) mx
                FROM master.floor_outline WHERE floor !~ '지|B' GROUP BY 1)
            SELECT count(*) FILTER (WHERE cr.floor > fl.mx) bad, count(*) tot
              FROM master.{tbl} cr JOIN fl ON fl.pk = cr.{col}
             WHERE cr.floor > 0 AND fl.mx IS NOT NULL""")
        if q and q["tot"]:
            print(f"  {ko:8s} {q['bad']:6,} / {q['tot']:7,}건 ({q['bad']*100/q['tot']:.2f}%)")
    await c.close()


if __name__ == "__main__":
    asyncio.run(main())
