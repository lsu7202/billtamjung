"""유동인구가 임대 추정의 오차를 줄이는지 재는 실험(2026-08-26).

물음: 지금 임대 요율은 **상권 하나에 하나**다(한국부동산원 통계표).
      같은 상권 안에서도 목 좋은 자리와 뒷골목은 임대료가 다른데, 지금은 똑같이 매긴다.
      서울 생활인구 250m 격자 실측으로 그 안을 갈라 주면 나아지나?

잣대 = **실거래 평당가**. 임대 실측(app.floor_rents)이 세 줄뿐이라 직접 못 잰다.
       대신 수익형 부동산은 임대료가 값을 만드니, 임대 추정이 옳다면
       **추정이 높은 건물이 실제로 비싸게 팔려야** 한다.
       스피어만(순위상관) — 자릿수가 아니라 순서가 맞는지를 본다.

    backend/.venv/bin/python scripts/rent_estimate/experiment_pop_rent.py
"""
import os
import sys
import math
import asyncio
import statistics

import asyncpg

sys.path.insert(0, os.path.dirname(__file__))
from rent_common import (EXCL, rate_for, pick_rate, market_adj,  # noqa: E402
                         SANG_SQL, BLDG_FILTER, pick_series)

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")
P = 3.305785

SQL = f"""
SELECT b.building_pk pk, b.land_use lu, b.total_area::float ta, {SANG_SQL} sang,
       p.day_avg::float d_pop, p.night_avg::float n_pop,   -- day 는 예약어라 못 쓴다
       sh.price::float price, sh.contract_ym
  FROM master.buildings b
  JOIN master.building_pop p USING (building_pk)
  JOIN LATERAL (SELECT price, contract_ym FROM master.sales_history s
                 WHERE s.building_pk = b.building_pk AND s.contract_ym >= '202108'
                 ORDER BY contract_ym DESC LIMIT 1) sh ON TRUE
 WHERE {BLDG_FILTER} AND b.total_area > 0
   AND p.day_avg IS NOT NULL AND p.night_avg > 0
"""

FLOOR_SQL = f"""
SELECT fo.building_pk pk, fo.floor, fo.use, fo.floor_area::float a
  FROM master.floor_outline fo JOIN master.buildings b USING(building_pk)
 WHERE {BLDG_FILTER} AND b.total_area > 0
"""


def spearman(xs, ys):
    """순위상관 — 값이 아니라 순서만 본다. 임대료와 매매가는 자릿수가 다르다."""
    n = len(xs)
    if n < 3:
        return None

    def rank(v):
        order = sorted(range(n), key=lambda i: v[i])
        r = [0.0] * n
        i = 0
        while i < n:               # 동점은 평균 순위로 — 안 그러면 같은 값이 순서를 만든다
            j = i
            while j + 1 < n and v[order[j + 1]] == v[order[i]]:
                j += 1
            avg = (i + j) / 2 + 1
            for k in range(i, j + 1):
                r[order[k]] = avg
            i = j + 1
        return r

    rx, ry = rank(xs), rank(ys)
    mx, my = statistics.fmean(rx), statistics.fmean(ry)
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = math.sqrt(sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry))
    return num / den if den else None


def base_rent(rows, series, rate):
    """지금 산식 그대로 — 층별 요율 × 면적 × 호가보정의 합(원/월). 밖에서 평당으로 나눈다."""
    tot = 0
    for r in rows:
        u, a = r['use'] or '', r['a'] or 0
        if any(k in u for k in EXCL) or a <= 0:
            continue
        rt = pick_rate(series, r['floor'], rate)
        if rt:
            tot += rt * 1000 * a * market_adj(r['floor'])
    return tot


async def main():
    c = await asyncpg.connect(DSN)
    print("불러오는 중…")
    bldgs = await c.fetch(SQL)
    fo = await c.fetch(FLOOR_SQL)
    await c.close()

    FL = {}
    for r in fo:
        FL.setdefault(r['pk'], []).append(r)

    # 상권별 유동인구 중앙 — 「이 건물이 제 상권 안에서 몇 번째 자리냐」를 재는 자
    by_sang, by_sang_n = {}, {}
    recs = []
    for b in bldgs:
        rows = FL.get(b['pk'], [])
        if not rows:
            continue
        tot = sum(r['a'] or 0 for r in rows)
        off = sum((r['a'] or 0) for r in rows
                  if any(k in (r['use'] or '') for k in ['사무', '업무', '오피스', '연구', '교육', '학원']))
        series = pick_series(b['ta'], b['lu'], off, tot)
        rate, _ = rate_for(series, b['sang'])
        if not rate:
            continue
        rent = base_rent(rows, series, rate)
        if rent <= 0 or not b['ta']:
            continue
        py = b['ta'] / P
        # 둘 다 **평당**으로 맞춘다(2026-08-26). 총액끼리 견주면 큰 건물이 임대료도 크고
        # 평당가는 낮아서, 「추정이 높을수록 싸게 팔린다」는 거꾸로 된 상관이 나온다(실측 −0.13).
        recs.append({'pk': b['pk'], 'sang': b['sang'], 'rent': rent / py, 'day': b['d_pop'],
                     'night': b['n_pop'], 'per_py': b['price'] / py})
        by_sang.setdefault(b['sang'], []).append(b['d_pop'])
        by_sang_n.setdefault(b['sang'], []).append(b['n_pop'])

    med = {k: statistics.median(v) for k, v in by_sang.items() if len(v) >= 5}
    med_n = {k: statistics.median(v) for k, v in by_sang_n.items() if len(v) >= 5}
    print(f"표본 {len(recs):,}건 · 상권 {len(med)}곳(5건 이상)\n")

    # 상권 중앙이 없는 곳(표본 얇음)은 제외 — 자가 없는데 재면 잡음만 는다
    use = [r for r in recs if r['sang'] in med]
    print(f"잴 수 있는 것 {len(use):,}건\n")

    price = [r['per_py'] for r in use]
    variants = {
        "지금 (상권 요율만)": [r['rent'] for r in use],
    }
    # 주야비 — 날것 곱 vs **상권 내 평균=1 정규화**(2026-08-27).
    # 날것 곱은 강남 크롤 검증에서 레벨을 +54% 부풀렸다(강남은 어디나 낮>밤이라 다 >1).
    # 정규화는 상권 안 순서는 그대로 두고 레벨만 되돌린다 — 순위 이득이 살아남는지 잰다.
    import statistics as _st
    def _padj(r, lo=0.6, hi=2.0, pw=0.5):
        return min(hi, max(lo, r['day'] / r['night'])) ** pw
    sang_mean = {}
    for sg in med:
        xs = [_padj(r) for r in use if r['sang'] == sg]
        sang_mean[sg] = _st.fmean(xs) if xs else 1.0
    variants["주야비 ^0.5 (날것 곱)"] = [r['rent'] * _padj(r) for r in use]
    variants["주야비 ^0.5 (상권 정규화)"] = [
        r['rent'] * _padj(r) / sang_mean.get(r['sang'], 1.0) for r in use]

    print(f"{'산식':<24} {'스피어만':>9}   실거래 평당가와의 순위상관")
    print("─" * 62)
    base = None
    for name, xs in variants.items():
        s = spearman(xs, price)
        if base is None:
            base = s
        d = "" if s == base else f"  ({'+' if s > base else ''}{(s - base) * 100:.2f}p)"
        print(f"{name:<24} {s:>9.4f}{d}")

    print(f"\n{'날것 (임대 추정 없이)':<24} {'스피어만':>9}   그 값 하나만으로 평당가를 맞히면")
    print("─" * 62)
    for name, xs in (("낮 인구", [r['day'] for r in use]),
                     ("밤 인구", [r['night'] for r in use]),
                     ("주야비", [r['day'] / r['night'] for r in use])):
        print(f"{name:<24} {spearman(xs, price):>9.4f}")

    # 상권 안에서만 재기 — 상권 사이 차이는 이미 요율이 잡으니, 갈라야 할 것은 상권 **안**이다
    print(f"\n{'같은 상권 안에서만':<24} {'스피어만':>9}   (상권별로 재서 표본 가중평균)")
    print("─" * 62)
    for name, xs in variants.items():
        num = den = 0
        for sg in med:
            idx = [i for i, r in enumerate(use) if r['sang'] == sg]
            if len(idx) < 8:
                continue
            s = spearman([xs[i] for i in idx], [price[i] for i in idx])
            if s is not None:
                num += s * len(idx)
                den += len(idx)
        print(f"{name:<24} {num / den:>9.4f}" if den else f"{name:<24}        —")


if __name__ == "__main__":
    asyncio.run(main())
