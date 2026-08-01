"""master.building_sale_est 적재 — 전 서울 상업 건물 F-17 v2 적정가(매매가 마스터 기본값).

★ 라이브(리포트) 기본값과 **완전 통일**. 오버레이(상권·comp제외) 없으면 검색·상세·리포트 동일 값.
  - 산식: report_calc.appraise + blend_income (동일 함수)
  - comp 수집: 500m 반경(geodesic) + 상업·주상 성격 + building_pk 제외 + per_area IQR 이상치 제외
    → 라이브 _fetch_comps 규칙과 정합(거리는 equirectangular ~0.1%, 경계 1건 이내 오차).
  값이 달라지는 건 오직 유저 오버레이(상권 반경/폴리곤·comp 제외) 반영분뿐 — 산식·규칙 차이 아님.
    python scripts/rent_estimate/build_sale_est.py
"""
import os
import sys
import json
import math
import asyncio
import statistics

import asyncpg

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend", "app", "jobs"))
import report_calc  # noqa: E402  (fastapi 의존 없음)

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")
SECT = ('상업용', '업무용', '상업기타', '주상용', '주상기타')
CELL = 500.0      # 그리드 버킷 크기(m) — 후보 수집용
RADIUS = 500.0    # comp 반경(m) — 라이브 _market_spatial 기본과 동일


def _mx(lng): return lng * 88000.0   # 그리드 버킷팅용 근사(500m 셀 인덱싱만)
def _my(lat): return lat * 111000.0

_R = 6371008.8   # 지구 평균반경(m) — geodesic 거리(라이브 ST_Distance geography와 정합)


def _dist_m(lat1, lng1, lat2, lng2):
    """equirectangular geodesic(<1km 정확) — 라이브 PostGIS ST_Distance(geography)와 ~0.1% 이내."""
    x = math.radians(lng2 - lng1) * math.cos(math.radians((lat1 + lat2) * 0.5))
    y = math.radians(lat2 - lat1)
    return _R * math.hypot(x, y)


def _iqr_keep(cd):
    """per_area(=매매가/연면적, 원/㎡) 이상치 제외 — 라이브 _outlier_bounds와 동일 규칙.
    표본 ≥10=IQR 1.5, 소표본=MAD 수정z(3.5). 3건 미만/편차0이면 유지."""
    vals = [c["price"] / c["total_area"] for c in cd]
    if len(vals) < 3:
        return cd
    med = statistics.median(vals)
    if len(vals) >= 10:
        q1, q3 = statistics.quantiles(vals, n=4)[0], statistics.quantiles(vals, n=4)[2]
        iqr = q3 - q1
        lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    else:
        mad = statistics.median([abs(x - med) for x in vals])
        if mad == 0:
            return cd
        d = 3.5 * mad / 0.6745
        lo, hi = med - d, med + d
    kept = [c for c, v in zip(cd, vals) if lo <= v <= hi]
    return kept if len(kept) >= 3 else cd


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
        f"""SELECT DISTINCT ON (sh.building_pk) sh.building_pk pk, ST_X(b.geom) lng, ST_Y(b.geom) lat,
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
            (r['pk'], float(r['lng']), float(r['lat']), float(r['pr']),
             float(r['gt']), float(r['la']), float(r['ta']), r['contract_ym']))
    print(f"comp 풀 {len(comps)}건 · 그리드셀 {len(grid)}")

    # 계산 대상 = 서울 전 건물(주거 포함). comp 풀은 상업(SECT) 유지 → 주거도 주변 상업 comp로 appraise.
    # 라이브(reportsApi.comps) 폴백과 소스 통일 — 핀 태그 == 상세 적정가.
    subs = await c.fetch(
        f"""SELECT b.building_pk pk, ST_X(b.geom) lng, ST_Y(b.geom) lat,
              b.gongsi_latest::float g, b.land_area::float la, b.total_area::float ta,
              e.annual_rent::float ann, COALESCE(ic.cap, {float(seoul_cap)})::float cap
            FROM master.buildings b
            LEFT JOIN master.building_rent_est e ON e.building_pk=b.building_pk
            LEFT JOIN master.income_cap ic ON ic.gu=substr(b.bjd_code,1,5)
            WHERE b.bjd_code LIKE '11%'
              AND b.gongsi_latest>0 AND b.land_area>0 AND b.total_area>0""")

    await c.execute("""DROP TABLE IF EXISTS master.building_sale_est;
        CREATE TABLE master.building_sale_est(
          building_pk text PRIMARY KEY, sale_est bigint, per_py bigint, n_comps int, method text,
          updated timestamptz DEFAULT now())""")
    ins = []
    for s in subs:
        slng, slat = float(s['lng']), float(s['lat'])
        cx, cy = int(_mx(slng) // CELL), int(_my(slat) // CELL)
        cd = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for (pk, clng, clat, pr, gt, la, ta, ym) in grid.get((cx + dx, cy + dy), []):
                    if pk == s['pk']:                      # 본매물 제외 — 라이브(building_pk 기준)와 동일
                        continue
                    d = _dist_m(slat, slng, clat, clng)    # geodesic — 라이브와 정합
                    if d > RADIUS:                          # 500m 반경(라이브 기본과 동일)
                        continue
                    cd.append({"price": pr, "total_area": ta, "land_area": la,
                               "gongsi_total": gt, "dist_m": d, "contract_ym": ym})
        if len(cd) < 3:
            continue
        cd = _iqr_keep(cd)   # 이상치 제외 — 라이브와 동일(검색·상세 값 통일)
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
