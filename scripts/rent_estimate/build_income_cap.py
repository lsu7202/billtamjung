"""master.income_cap 적재 — 자치구별 cap rate(연임대추정÷실거래 중앙). F-17 수익환원 블렌드용.

cap이 구별 2.5~6.9%로 크게 달라 구별 필요. 매매가 = 연NOI ÷ cap.
    python scripts/rent_estimate/build_income_cap.py
"""
import os
import asyncio
import asyncpg

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")
SECT = ('상업용', '업무용', '상업기타', '주상용', '주상기타')


async def main():
    c = await asyncpg.connect(DSN)
    await c.execute("""DROP TABLE IF EXISTS master.income_cap;
        CREATE TABLE master.income_cap(gu text PRIMARY KEY, cap numeric, n int)""")
    # 자치구(bjd 앞5)별 median(연임대추정/실거래). 이상 cap 제외(0.5~20%).
    rows = await c.fetch(
        """WITH s AS (
             SELECT DISTINCT ON (sh.building_pk) substr(b.bjd_code,1,5) gu,
                    (e.annual_rent::float / sh.price) cap
             FROM master.sales_history sh
             JOIN master.buildings b USING(building_pk)
             JOIN master.building_rent_est e USING(building_pk)
             WHERE b.bjd_code LIKE '11%' AND b.land_use = ANY($1)
               AND sh.contract_ym >= to_char(now()-interval '5 years','YYYYMM')
               AND sh.price > 0 AND e.annual_rent > 0
             ORDER BY sh.building_pk, sh.contract_ym DESC)
           SELECT gu, percentile_cont(0.5) WITHIN GROUP (ORDER BY cap) cap, count(*) n
           FROM s WHERE cap BETWEEN 0.005 AND 0.2 GROUP BY gu HAVING count(*) >= 20""",
        list(SECT))
    seoul_cap = await c.fetchval(
        """WITH s AS (SELECT DISTINCT ON (sh.building_pk) (e.annual_rent::float/sh.price) cap
             FROM master.sales_history sh JOIN master.buildings b USING(building_pk)
             JOIN master.building_rent_est e USING(building_pk)
             WHERE b.bjd_code LIKE '11%' AND b.land_use=ANY($1) AND sh.price>0 AND e.annual_rent>0
               AND sh.contract_ym >= to_char(now()-interval '5 years','YYYYMM')
             ORDER BY sh.building_pk, sh.contract_ym DESC)
           SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY cap) FROM s WHERE cap BETWEEN 0.005 AND 0.2""",
        list(SECT))
    ins = [(r["gu"], round(float(r["cap"]), 5), r["n"]) for r in rows]
    ins.append(("_seoul", round(float(seoul_cap), 5), 0))   # 폴백
    await c.executemany("INSERT INTO master.income_cap(gu,cap,n) VALUES($1,$2,$3)", ins)
    print(f"income_cap 적재: {len(ins)}행 (서울폴백 {seoul_cap*100:.2f}%)")
    for r in sorted(ins, key=lambda x: -x[2])[:6]:
        print(f"  {r[0]}: cap {r[1]*100:.2f}% (n={r[2]})")
    await c.close()


if __name__ == "__main__":
    asyncio.run(main())
