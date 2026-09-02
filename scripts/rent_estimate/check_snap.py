"""잣대 오염 검사 — 매물이 엉뚱한 건물에 붙었나(2026-08-29).

봉천동 862-10(지상 6층 · 1989년 · 오락실·당구장)에 **8~14층 매물**이 붙어 있었다.
있지도 않은 층이다. 좌표 30m 스냅이 옆 신축 빌딩 매물을 끌어온 것이다.

이런 오염이 얼마나 되는지 센다. 검사는 간단하다 —
**대장에 없는 층의 매물이 붙었으면 그 건물은 스냅이 틀렸다.**

    backend/.venv/bin/python scripts/rent_estimate/check_snap.py
"""
import asyncio
import os
import statistics as st
from collections import defaultdict

import asyncpg
import rent_common as RC

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")


async def main():
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=1800)
    fo = await c.fetch("""
        SELECT fo.building_pk pk, fo.floor
          FROM master.floor_outline fo
         WHERE fo.building_pk IN (SELECT DISTINCT building_pk FROM master._crawl_rent
                                   WHERE building_pk IS NOT NULL)""")
    FL = defaultdict(set)
    for r in fo:
        n = RC.signed_floor(r["floor"])
        if n is not None:
            FL[r["pk"]].add(n)
    cr = await c.fetch("""
        SELECT building_pk pk, floor, count(*) n, min(dist_m) d
          FROM master._crawl_rent
         WHERE building_pk IS NOT NULL AND floor IS NOT NULL
         GROUP BY 1,2""")
    bad_b, ok_b = set(), set()
    bad_ads = ok_ads = 0
    over = []
    for r in cr:
        f = FL.get(r["pk"])
        if not f:
            continue
        if r["floor"] in f:
            ok_b.add(r["pk"]); ok_ads += r["n"]
        else:
            bad_b.add(r["pk"]); bad_ads += r["n"]
            over.append((r["pk"], r["floor"], max(f), r["n"], r["d"]))
    allb = ok_b | bad_b
    print(f"매물이 붙은 건물 {len(allb):,}동")
    print(f"  대장에 없는 층의 매물이 하나라도 있는 건물 {len(bad_b):,}동"
          f" ({len(bad_b)*100/max(len(allb),1):.1f}%)")
    print(f"  그런 매물 {bad_ads:,}건 / 정상 {ok_ads:,}건"
          f" ({bad_ads*100/max(bad_ads+ok_ads,1):.1f}%)\n")

    print("[얼마나 벗어났나] 대장 최고층 대비")
    gap = defaultdict(int)
    for pk, f, mx, n, d in over:
        if f > mx:
            g = f - mx
            gap["1층 초과" if g == 1 else ("2-3층 초과" if g <= 3 else
                 ("4-9층 초과" if g <= 9 else "10층+ 초과"))] += n
        elif f < 0:
            gap["대장에 없는 지하"] += n
        else:
            gap["중간 층이 대장에 없음"] += n
    for k in ("1층 초과", "2-3층 초과", "4-9층 초과", "10층+ 초과",
              "대장에 없는 지하", "중간 층이 대장에 없음"):
        if gap.get(k):
            print(f"  {k:18s} {gap[k]:7,}건")

    print("\n[스냅 거리별] 멀리서 붙인 것이 더 틀리나")
    for lo, hi in ((0, 1), (1, 5), (5, 10), (10, 20), (20, 31)):
        b = sum(n for pk, f, mx, n, d in over if d is not None and lo <= d < hi)
        t = await c.fetchval(
            "SELECT count(*) FROM master._crawl_rent WHERE dist_m >= $1 AND dist_m < $2", lo, hi)
        if t:
            print(f"  {lo:2d}~{hi:2d}m  전체 {t:7,}건 중 층 안 맞는 것 {b:6,}건 ({b*100/t:4.1f}%)")

    print("\n[가장 심한 것 10동]")
    worst = defaultdict(lambda: [0, 0, 0])
    for pk, f, mx, n, d in over:
        w = worst[pk]
        w[0] += n
        w[1] = max(w[1], f)
        w[2] = mx
    top = sorted(worst.items(), key=lambda t: -t[1][0])[:10]
    rows = await c.fetch("SELECT building_pk pk, addr, floors_above::float fa"
                         "  FROM master.buildings WHERE building_pk = ANY($1)",
                         [t[0] for t in top])
    A = {r["pk"]: r for r in rows}
    for pk, (n, mxf, mx) in top:
        a = A.get(pk)
        if a:
            print(f"  {a['addr'].replace('서울특별시 ',''):32s} 대장 최고 {mx:>3d}층"
                  f"(지상{a['fa'] or 0:.0f}) · 매물 최고 {mxf:>3d}층 · 어긋난 매물 {n}건")
    await c.close()

    print("\n[뜻] 이 오염은 잣대를 부풀린다 —")
    print("  낡은 저층 상가에 신축 고층 오피스 매물이 붙으면 「우리가 과소평가한다」로 잡힌다.")
    print("  앞서 낸 숫자(32.2% → 25.6% 등)는 이 오염이 섞인 값이다. 걸러내고 다시 재야 한다.")


if __name__ == "__main__":
    asyncio.run(main())
