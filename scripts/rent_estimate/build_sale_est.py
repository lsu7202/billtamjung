"""master.building_sale_est 적재 — 전 서울 상업 건물 F-17 v2 적정가(매매가 마스터 기본값).

★ 라이브(리포트)와 **동일한 report_calc.appraise + blend_income** 호출 = 단일 산식 소스.
  배치는 comp를 그리드 버킷팅으로 빠르게 모아서(기본 500m) 그 함수에 넘길 뿐 — 수학 중복 없음.
  라이브와 값이 다르면 그건 comp 영역 차이(팀 커스텀 상권 등)이지 산식 차이 아님.
    python scripts/rent_estimate/build_sale_est.py
"""
import os
import sys
import json
import math
import asyncio

import asyncpg

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend", "app", "jobs"))
import report_calc  # noqa: E402  (fastapi 의존 없음)

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")
SECT = ('상업용', '업무용', '상업기타', '주상용', '주상기타')
CELL = 500.0


def _mx(lng): return lng * 88000.0
def _my(lat): return lat * 111000.0


async def main():
    c = await asyncpg.connect(DSN)
    # params·시점보정표 — 라이브와 동일 소스(ref.formula_params active)
    prm = await c.fetch(
        """SELECT p.param_key, p.value_num, p.value_json FROM ref.formula_params p
           JOIN ref.formula_sets s ON s.set_version=p.set_version AND s.active""")
    params = {r["param_key"]: float(r["value_num"]) for r in prm if r["value_num"] is not None}
    tj = next((r["value_json"] for r in prm if r["param_key"] == "time_adjust"), None)
    time_adjust = json.loads(tj) if isinstance(tj, str) else (tj or {})
    beta = params.get("blend.income", 0.2)
    seoul_cap = await c.fetchval("SELECT cap FROM master.income_cap WHERE gu='_seoul'")

    # comp 풀: 서울 상업 매각(5년). 공시총액 = gongsi_latest × sh.land_area
    comps = await c.fetch(
        f"""SELECT DISTINCT ON (sh.building_pk) ST_X(b.geom) lng, ST_Y(b.geom) lat,
              sh.price::float pr, sh.land_area::float la, sh.total_area::float ta,
              b.gongsi_latest::float*sh.land_area gt, sh.contract_ym
            FROM master.sales_history sh JOIN master.buildings b USING(building_pk)
            WHERE b.bjd_code LIKE '11%' AND b.land_use = ANY($1)
              AND sh.contract_ym >= to_char(now()-interval '5 years','YYYYMM')
              AND sh.price>0 AND sh.land_area>0 AND sh.total_area>0 AND b.gongsi_latest>0""",
        list(SECT))
    grid: dict[tuple[int, int], list] = {}
    for r in comps:
        x, y = _mx(float(r['lng'])), _my(float(r['lat']))
        grid.setdefault((int(x // CELL), int(y // CELL)), []).append(
            (x, y, float(r['pr']), float(r['gt']), float(r['la']), float(r['ta']), r['contract_ym']))
    print(f"comp 풀 {len(comps)}건 · 그리드셀 {len(grid)}")

    subs = await c.fetch(
        f"""SELECT b.building_pk pk, ST_X(b.geom) lng, ST_Y(b.geom) lat,
              b.gongsi_latest::float g, b.land_area::float la, b.total_area::float ta,
              e.annual_rent::float ann, COALESCE(ic.cap, {float(seoul_cap)})::float cap
            FROM master.buildings b
            LEFT JOIN master.building_rent_est e ON e.building_pk=b.building_pk
            LEFT JOIN master.income_cap ic ON ic.gu=substr(b.bjd_code,1,5)
            WHERE b.bjd_code LIKE '11%' AND b.land_use=ANY($1)
              AND b.gongsi_latest>0 AND b.land_area>0 AND b.total_area>0""",
        list(SECT))

    await c.execute("""DROP TABLE IF EXISTS master.building_sale_est;
        CREATE TABLE master.building_sale_est(
          building_pk text PRIMARY KEY, sale_est bigint, per_py bigint, n_comps int, method text,
          updated timestamptz DEFAULT now())""")
    ins = []
    for s in subs:
        sx, sy = _mx(float(s['lng'])), _my(float(s['lat']))
        cx, cy = int(sx // CELL), int(sy // CELL)
        cd = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for (x, y, pr, gt, la, ta, ym) in grid.get((cx + dx, cy + dy), []):
                    d = math.hypot(x - sx, y - sy)
                    if d > CELL or (abs(x - sx) < 1e-6 and abs(y - sy) < 1e-6):
                        continue
                    cd.append({"price": pr, "total_area": ta, "land_area": la,
                               "gongsi_total": gt, "dist_m": d, "contract_ym": ym})
        if len(cd) < 3:
            continue
        subj = {"total_area": s['ta'], "land_area": s['la'], "gongsi_latest": s['g']}
        ap = report_calc.appraise(0, subj, cd, params, time_adjust)   # ← 라이브와 동일 함수
        fair = ap.get("fair_price")
        if not fair:
            continue
        ann = (float(s['ann']) if s['ann'] else None)
        fair = report_calc.blend_income(fair, ann, float(s['cap']) if s['cap'] else None, beta)  # ← 공용
        py = float(s['ta']) / 3.305785
        per_py = int(fair / py) if py else 0
        if fair <= 0 or per_py > 300_000_000:
            continue
        ins.append((s['pk'], int(fair), per_py, len(cd), 'f17v2'))
    await c.executemany(
        "INSERT INTO master.building_sale_est(building_pk,sale_est,per_py,n_comps,method) VALUES($1,$2,$3,$4,$5)", ins)
    print(f"적정가 적재: {len(ins)}동 (comp<3 등 제외 {len(subs)-len(ins)})")
    r = await c.fetchrow("""SELECT sale_est,n_comps FROM master.building_sale_est
        WHERE building_pk=(SELECT building_pk FROM master.buildings WHERE jibun_norm='강남구삼성동157-36')""")
    if r:
        print(f"157-36: {r['sale_est']/1e8:.0f}억 (comp {r['n_comps']}) · 라이브와 동일 함수")
    await c.close()


if __name__ == "__main__":
    asyncio.run(main())
