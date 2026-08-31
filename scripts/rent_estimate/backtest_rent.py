"""임대 추정 백테스트 — 크롤 호가를 잣대로 층 단가를 잰다(2026-08-29).

잣대 = master._crawl_rent(crawl_bench.py --build 로 만든다). 25.7만 매물 · 39,319동.

무엇을 재나: **금액**이다. 순위가 아니라 「그 층이 실제로 얼마에 나와 있나」에
우리 추정이 몇 배로 서는가. 면적 기준을 맞춰야 자릿수가 비교된다 —

    크롤 단가 = 월세 ÷ 계약면적                    (임차인이 돈 내는 면적)
    우리 단가 = rent_est ÷ (대장 층면적 × EFF_RATIO)  (임대가능면적)

둘 다 「임대되는 면적 1㎡가 한 달에 버는 돈」이라 바로 나눌 수 있다.
비율 중앙 1.0 이 눈금이 맞은 것이고, MdAPE 가 흩어짐이다.

층 단위로 잰다. 건물 단위로 합치면 층 구성이 다른 건물끼리 상쇄되어
「눈금은 맞는데 층별로는 다 틀린」 상태가 안 보인다.

    backend/.venv/bin/python scripts/rent_estimate/backtest_rent.py
    backend/.venv/bin/python scripts/rent_estimate/backtest_rent.py --grid
"""
import argparse
import asyncio
import math
import os
import statistics as st
from collections import defaultdict

import asyncpg
import rent_common as RC

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")

# 호가 노이즈 방어 — 같은 층에 매물이 여러 개면 중앙값을 쓰고,
# 단가가 서울 상업 임대에서 있을 수 없는 자리는 뺀다(원/㎡/월).
UNIT_LO, UNIT_HI = 3_000, 400_000
MIN_ADS = 1


async def load():
    """(층 표본) — 크롤이 붙은 건물의 층별 크롤 단가 + 우리 입력값."""
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=1800)
    # 크롤: 건물×층 단가 중앙
    crawl = await c.fetch(f"""
        SELECT building_pk pk, floor,
               count(*) ads,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY rent/area_c) unit,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY deposit/NULLIF(rent,0)) dep_mult,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY area_e/NULLIF(area_c,0)) eff
          FROM master._crawl_rent
         WHERE building_pk IS NOT NULL AND floor IS NOT NULL
           AND rent/area_c BETWEEN {UNIT_LO} AND {UNIT_HI}
         GROUP BY 1,2 HAVING count(*) >= {MIN_ADS}""")
    pks = list({r["pk"] for r in crawl})
    # 우리 입력: 건물 속성 + 층별 대장면적
    bl = await c.fetch(
        f"SELECT b.building_pk pk, b.land_use lu, b.total_area::float ta, {RC.SANG_SQL} sang,"
        f" b.approval_ymd, b.station_dist::float sd, b.use_zone, b.gongsi_latest::float g,"
        f" pp.day_avg::float dpop, pp.night_avg::float npop"
        f" FROM master.buildings b"
        f" LEFT JOIN master.building_pop pp ON pp.building_pk = b.building_pk"
        f" WHERE b.building_pk = ANY($1)", pks)
    fo = await c.fetch(
        "SELECT building_pk pk, seq, floor, use, floor_area::float a"
        "  FROM master.floor_outline WHERE building_pk = ANY($1)", pks)
    await c.close()

    B = {r["pk"]: dict(r) for r in bl}
    FL = defaultdict(list)
    for r in fo:
        FL[r["pk"]].append(dict(r))
    # 건물별 계열 판정(빌더와 같은 규칙)
    for pk, rows in FL.items():
        b = B.get(pk)
        if not b:
            continue
        tot = sum(r["a"] or 0 for r in rows)
        off = sum((r["a"] or 0) for r in rows
                  if any(k in (r["use"] or "") for k in ["사무", "업무", "오피스", "연구", "교육", "학원"]))
        b["series"] = RC.pick_series(b["ta"], b["lu"], off, tot)
        # 층 정수 → 그 층의 대장면적 합(임대 가능한 용도만)
        area = defaultdict(float)
        for r in rows:
            u = r["use"] or ""
            if any(k in u for k in RC.EXCL) or not r["a"]:
                continue
            n = RC.signed_floor(r["floor"])
            if n is not None:
                area[n] += r["a"]
        b["area"] = dict(area)
        b["label"] = {RC.signed_floor(r["floor"]): r["floor"] for r in rows
                      if RC.signed_floor(r["floor"]) is not None}

    out = []
    for r in crawl:
        b = B.get(r["pk"])
        if not b or "area" not in b:
            continue
        n = r["floor"]
        a = b["area"].get(n)
        lab = b["label"].get(n)
        if not a or a <= 0 or not lab:
            continue
        out.append({"pk": r["pk"], "n": n, "label": lab, "ads": r["ads"],
                    "crawl_unit": float(r["unit"]), "dep_mult": r["dep_mult"] and float(r["dep_mult"]),
                    "eff": r["eff"] and float(r["eff"]),
                    "series": b["series"], "sang": b["sang"], "area": a,
                    "approval": b["approval_ymd"], "sd": b["sd"], "zone": b["use_zone"],
                    "g": b["g"],
                    "dpop": b["dpop"], "npop": b["npop"], "ta": b["ta"]})
    return out


def predict(s, eff=None, floor_adj=None, age_cfg=None, sta_cfg=None, series_fix=None, v3=False):
    """우리 임대 단가(원/㎡ 임대면적/월). 빌더와 같은 산식, 파라미터만 갈아 끼운다.

    v3=True 면 옛 산식(상권 요율)을 강제한다 — v4 와 나란히 재려고."""
    series = series_fix or s["series"]
    if not v3:                      # 빌더가 실제로 쓰는 길: v4 먼저, 없으면 v3 폴백
        u4 = RC.v4_unit(s.get("g"), s["label"], series, s["sang"], s.get("approval"), s.get("sd"))
        if u4:
            return u4
    rate, _ = RC.rate_for(series, s["sang"])
    if not rate:
        return None
    rt = RC.pick_rate(series, s["label"], rate)
    if not rt:
        return None
    adj = (floor_adj or RC.FLOOR_ADJ)
    unit = rt * 1000 * _market_adj(s["n"], adj)
    if age_cfg:                       # 연식 보정 — 오래된 건물이 덜 받는다
        yr = _year(s["approval"])
        if yr:
            age = 2026 - yr
            unit *= max(0.55, 1.0 - age_cfg * max(0, age - 5) / 100)
    if sta_cfg and s["sd"] is not None:   # 역거리 보정 — 가까울수록 더 받는다
        unit *= (1.0 + sta_cfg) ** (-(min(s["sd"], 1500) - 400) / 400)
    return unit * (eff if eff is not None else 1.0)


def _year(ymd):
    try:
        return int(str(ymd)[:4])
    except (TypeError, ValueError):
        return None


def _market_adj(n, adj):
    if n is None or n == 0:
        return 1.0
    if n < 0:
        return adj['지하']
    if n <= 3:
        return adj[str(n)]
    if n <= 5:
        return adj['4-5']
    if n <= 10:
        return adj['6-10']
    return adj['11+']


def score(rows, **kw):
    """비율(우리÷크롤) 중앙 · MdAPE · ±20% 적중."""
    rat = []
    for s in rows:
        p = predict(s, **kw)
        if not p:
            continue
        rat.append(p / s["crawl_unit"])
    if not rat:
        return None
    ape = [abs(r - 1) * 100 for r in rat]
    return {"n": len(rat), "med": st.median(rat), "MdAPE": st.median(ape),
            "hit20": sum(1 for e in ape if e <= 20) / len(ape) * 100,
            "geo": math.exp(st.mean(math.log(r) for r in rat if r > 0))}


def show(name, r):
    if not r:
        print(f"{name:44s}  —")
        return
    print(f"{name:44s} n={r['n']:6d}  비율 {r['med']:5.2f}(기하 {r['geo']:5.2f})"
          f"  MdAPE {r['MdAPE']:5.1f}%  ±20% {r['hit20']:4.1f}%")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--grid", action="store_true", help="파라미터 그리드 탐색")
    a = ap.parse_args()
    rows = asyncio.run(load())
    print(f"층 표본 {len(rows):,} · 건물 {len({r['pk'] for r in rows}):,}동\n")

    # 실측 상수 — 크롤이 직접 말해 주는 값
    dm = [r["dep_mult"] for r in rows if r["dep_mult"]]
    ef = [r["eff"] for r in rows if r["eff"]]
    print(f"[실측] 보증금/월세 중앙 {st.median(dm):.2f} (현행 {RC.DEPOSIT_MULT})"
          f" · 전용/계약 중앙 {st.median(ef):.3f}\n")

    print(f"{'변형':44s} {'':6s}")
    show("V0 현행(v4 공시지가 주축)", score(rows, eff=RC.EFF_RATIO))
    show("V3 옛 산식(상권 요율만)", score(rows, eff=RC.EFF_RATIO, v3=True))
    show("A eff=1.00(면적보정 없음)", score(rows, eff=1.0, v3=True))
    if a.grid:
        print()
        for e in (0.60, 0.65, 0.70, 0.75, 0.77, 0.80, 0.85, 0.90, 1.00):
            show(f"  eff={e:.2f}", score(rows, eff=e))
    print()
    print("[층별 오차] 현행")
    by = defaultdict(list)
    for s in rows:
        p = predict(s, eff=RC.EFF_RATIO)
        if p:
            by[_bucket(s["n"])].append(p / s["crawl_unit"])
    for k in ("지하", "1", "2", "3", "4-5", "6-10", "11+"):
        v = by.get(k)
        if v:
            print(f"  {k:5s} n={len(v):6d}  비율 중앙 {st.median(v):5.2f}"
                  f"  MdAPE {st.median([abs(x-1)*100 for x in v]):5.1f}%")
    print()
    print("[계열별] 현행")
    bs = defaultdict(list)
    for s in rows:
        p = predict(s, eff=RC.EFF_RATIO)
        if p:
            bs[s["series"]].append(p / s["crawl_unit"])
    for k, v in sorted(bs.items()):
        print(f"  {k:8s} n={len(v):6d}  비율 중앙 {st.median(v):5.2f}"
              f"  MdAPE {st.median([abs(x-1)*100 for x in v]):5.1f}%")
    print()
    print("[상권 매칭 여부] 현행")
    bm = defaultdict(list)
    for s in rows:
        p = predict(s, eff=RC.EFF_RATIO)
        if p:
            _, mapped = RC.rate_for(s["series"], s["sang"])
            bm["상권 매칭" if mapped else "서울평균 폴백"].append(p / s["crawl_unit"])
    for k, v in sorted(bm.items()):
        print(f"  {k:12s} n={len(v):6d}  비율 중앙 {st.median(v):5.2f}"
              f"  MdAPE {st.median([abs(x-1)*100 for x in v]):5.1f}%")


def _bucket(n):
    if n < 0:
        return "지하"
    if n <= 3:
        return str(n)
    if n <= 5:
        return "4-5"
    if n <= 10:
        return "6-10"
    return "11+"


if __name__ == "__main__":
    main()
