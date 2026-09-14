"""한 짝의 **원 매물을 그대로** 찍는다(2026-08-29).

pick_pairs.py 는 층 단가를 중앙값으로 뭉개서 보여준다. 그러면 뒤에 뭐가 있는지
안 보인다 — 매물 두 건이 각각 얼마인지, 한 건이 튀어서 중앙값을 끌었는지,
면적이 제각각인지. 요약을 믿으라고 하는 대신 원본을 보여준다.

    backend/.venv/bin/python scripts/rent_estimate/show_raw.py "신사동 554-1" "신사동 551-32" 1
    backend/.venv/bin/python scripts/rent_estimate/show_raw.py --pk 1023xxxx 1
"""
import argparse
import asyncio
import os
import statistics as st

import asyncpg

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("addrs", nargs="*", help="주소 조각 (예: '신사동 554-1')")
    ap.add_argument("--floor", type=int, default=None, help="층(생략하면 전 층)")
    a = ap.parse_args()
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=900)

    for q in a.addrs:
        b = await c.fetch("""
            SELECT building_pk pk, addr, gongsi_latest::float g, approval_ymd, remodel_ymd,
                   total_area::float ta, floors_above::float fa, elevator::float ev,
                   parking::float pkn, road_frontage rf, main_use mu, station_dist::float sd
              FROM master.buildings WHERE addr LIKE '%' || $1 || '%'
               AND bjd_code LIKE '11%' LIMIT 3""", q)
        if not b:
            print(f"\n[{q}] 건물을 못 찾았습니다")
            continue
        for bb in b:
            print(f"\n{'='*78}")
            print(f"{bb['addr']}   (building_pk {bb['pk']})")
            print(f"  공시지가 {bb['g']/1e4:,.0f}만원/㎡ · 사용승인 {str(bb['approval_ymd'] or '—')[:7]}"
                  f" · 대수선 {str(bb['remodel_ymd'] or '—')[:7]}")
            print(f"  연면적 {bb['ta'] or 0:,.0f}㎡ · 지상 {bb['fa'] or 0:.0f}층"
                  f" · 엘리베이터 {bb['ev'] if bb['ev'] is not None else '—'}"
                  f" · 주차 {bb['pkn'] if bb['pkn'] is not None else '—'}"
                  f" · 도로 {bb['rf'] or '—'} · 역 {bb['sd'] or 0:.0f}m")

            # 대장 층 구성
            fo = await c.fetch(
                "SELECT floor, use, floor_area::float a FROM master.floor_outline"
                "  WHERE building_pk=$1 ORDER BY seq", bb["pk"])
            if fo:
                print("\n  ── 대장 층별 ──")
                for r in fo:
                    print(f"    {str(r['floor']):8s} {str(r['use'] or ''):24s} {r['a'] or 0:8,.1f}㎡")

            # 크롤 매물 원본
            where = "building_pk=$1" + (" AND floor=$2" if a.floor is not None else "")
            args = [bb["pk"]] + ([a.floor] if a.floor is not None else [])
            cr = await c.fetch(
                f"SELECT no, floor, area_c, area_e, deposit, rent FROM master._crawl_rent"
                f"  WHERE {where} ORDER BY floor, rent", *args)
            print(f"\n  ── 네이버 매물 원본 {len(cr)}건"
                  f"{f' (층 {a.floor} 만)' if a.floor is not None else ''} ──")
            if cr:
                print(f"    {'매물번호':>12s} {'층':>4s} {'계약㎡':>8s} {'전용㎡':>8s}"
                      f" {'보증금':>10s} {'월세':>9s} {'전용㎡당':>10s} {'전용률':>6s}")
                for r in cr:
                    ac, ae = float(r["area_c"] or 0), float(r["area_e"] or 0)
                    rent = float(r["rent"] or 0)
                    ue = (rent / ae) if ae else None
                    print(f"    {r['no']:>12s} {r['floor']:>4d} {ac:8,.1f} {ae:8,.1f}"
                          f" {float(r['deposit'] or 0)/1e4:9,.0f}만 {rent/1e4:8,.0f}만"
                          f" {(f'{ue:10,.0f}' if ue else '         —')}"
                          f" {(f'{ae/ac:6.2f}' if ac and ae else '     —')}")
                if a.floor is not None and len(cr) >= 2:
                    ue = [float(r["rent"]) / float(r["area_e"]) for r in cr if r["area_e"]]
                    if ue:
                        print(f"    → 전용㎡당 중앙 {st.median(ue):,.0f}원"
                              f" (최저 {min(ue):,.0f} ~ 최고 {max(ue):,.0f})")
    await c.close()


if __name__ == "__main__":
    asyncio.run(main())
