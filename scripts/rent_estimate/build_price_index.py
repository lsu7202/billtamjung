"""master.sale_price_index — 상업 실거래 분기 가격지수(공시배율 중앙값, 3분기 롤링 스무딩).

시점보정 정본(F-17 v3.1): 기존 연 단위 정적 표가 시장 흐름과 어긋나 시점별 bias −17%~+3.5% 유발
(2026-08-05 오차 해부에서 적발) → 데이터 자체에서 지수 산출. 파이프라인 적재 후 재실행.
사용: python build_price_index.py
"""
import asyncio
import os
import statistics

import asyncpg

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")
SECT = ['상업용', '업무용', '상업기타', '주상용', '주상기타']
MIN_N = 30      # 분기 최소 표본(미만이면 지수 제외 → 산식이 인접 분기/연표로 폴백)


async def main():
    c = await asyncpg.connect(DSN)
    rows = await c.fetch("""
      SELECT substr(sh.contract_ym,1,4)||CASE WHEN substr(sh.contract_ym,5,2)<='03' THEN 'Q1'
             WHEN substr(sh.contract_ym,5,2)<='06' THEN 'Q2'
             WHEN substr(sh.contract_ym,5,2)<='09' THEN 'Q3' ELSE 'Q4' END AS q,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY sh.price/(b.gongsi_latest*sh.land_area)) AS med,
             count(*) AS n
      FROM master.sales_history sh JOIN master.buildings b USING(building_pk)
      WHERE sh.contract_ym >= '201901' AND sh.price > 0 AND sh.land_area > 0 AND b.gongsi_latest > 0
        AND (b.land_use = ANY($1) OR substr(b.main_use,1,2) IN ('03','04','05','07','09','13','14','15','16'))
      GROUP BY 1 ORDER BY 1""", SECT)
    idx = {r['q']: float(r['med']) for r in rows if r['n'] >= MIN_N}
    ks = sorted(idx)
    smooth = {k: statistics.median([idx[ks[max(0, i-1)]], idx[k], idx[ks[min(len(ks)-1, i+1)]]])
              for i, k in enumerate(ks)}
    await c.execute("""CREATE TABLE IF NOT EXISTS master.sale_price_index(
        quarter text PRIMARY KEY, ratio double precision NOT NULL, updated timestamptz DEFAULT now())""")
    await c.execute("TRUNCATE master.sale_price_index")
    await c.executemany("INSERT INTO master.sale_price_index(quarter, ratio) VALUES($1,$2)",
                        list(smooth.items()))
    print(f"✓ sale_price_index {len(smooth)}분기 ({ks[0]}~{ks[-1]})")
    await c.close()


asyncio.run(main())
