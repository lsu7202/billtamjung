"""임대 추정 잔차 분해 — 34% 흩어짐이 어디서 오나(2026-08-29).

backtest_rent.py 가 말한 것: 눈금(레벨)은 맞고 **흩어짐이 34%**인데,
층으로 잘라도 계열로 잘라도 상권으로 잘라도 32~37% 로 똑같다.
어느 축으로도 안 갈린다 = **건물 사이의 차이를 설명하는 변수가 산식에 하나도 없다.**

지금 산식은 (상권 요율 × 층 보정 × 면적비) 뿐이라, 같은 상권·같은 층이면
서울의 모든 건물이 같은 단가다. 실제로는 대로변과 이면도로가 두 배 차이 난다.

그래서 **잔차**를 본다: r = log(크롤 단가 ÷ 우리 추정).
r 을 설명하는 건물 변수를 찾으면 그게 곧 빠진 항이다.

    backend/.venv/bin/python scripts/rent_estimate/residual_rent.py
"""
import asyncio
import math
import os
import statistics as st
from collections import defaultdict

import asyncpg
import rent_common as RC
from backtest_rent import load, predict

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")


async def enrich(rows):
    """건물 변수 더 붙이기 — 공시지가·도로접면·용도지역·규모·연식."""
    pks = list({r["pk"] for r in rows})
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=900)
    ex = await c.fetch("""
        SELECT b.building_pk pk, b.gongsi_latest::float g, b.road_frontage rf,
               b.use_zone uz, b.total_area::float ta, b.land_area::float la,
               b.approval_ymd, b.floors_above::float fa, b.main_use mu,
               b.station_dist::float sd, b.elevator::float ev,
               pp.day_avg::float dpop, pp.night_avg::float npop
          FROM master.buildings b
          LEFT JOIN master.building_pop pp ON pp.building_pk = b.building_pk
         WHERE b.building_pk = ANY($1)""", pks)
    await c.close()
    E = {r["pk"]: dict(r) for r in ex}
    for s in rows:
        s.update(E.get(s["pk"], {}))
    return rows


def spearman(xs, ys):
    """순위상관 — 관계가 곡선이어도 잡힌다."""
    n = len(xs)
    if n < 30:
        return None
    def rank(v):
        order = sorted(range(len(v)), key=lambda i: v[i])
        r = [0.0] * len(v)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
                j += 1
            avg = (i + j) / 2 + 1
            for k in range(i, j + 1):
                r[order[k]] = avg
            i = j + 1
        return r
    rx, ry = rank(xs), rank(ys)
    mx, my = st.mean(rx), st.mean(ry)
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = math.sqrt(sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry))
    return num / den if den else None


def buckets(rows, key, label, n=6, fn=None):
    """변수를 분위로 잘라 각 칸의 잔차 중앙을 본다 — 관계 모양이 보인다."""
    v = [(fn(s) if fn else s.get(key), s["_r"]) for s in rows]
    v = [(x, r) for x, r in v if x is not None and r is not None]
    if len(v) < 200:
        print(f"  {label:16s} 표본 부족({len(v)})")
        return
    v.sort(key=lambda t: t[0])
    sp = spearman([x for x, _ in v], [r for _, r in v])
    step = len(v) // n
    out = []
    for i in range(n):
        seg = v[i * step:(i + 1) * step] if i < n - 1 else v[i * step:]
        if not seg:
            continue
        out.append(f"{math.exp(st.median([r for _, r in seg])):.2f}")
    print(f"  {label:16s} ρ={sp:+.3f}  분위별 배율 {' '.join(out)}")


def cats(rows, key, label, top=8):
    """범주형 — 값별 잔차 중앙."""
    g = defaultdict(list)
    for s in rows:
        k = s.get(key)
        if k and s.get("_r") is not None:
            g[str(k)].append(s["_r"])
    g = {k: v for k, v in g.items() if len(v) >= 150}
    if not g:
        print(f"  {label}: 표본 부족")
        return
    print(f"  {label}")
    for k, v in sorted(g.items(), key=lambda t: -st.median(t[1]))[:top]:
        print(f"    {k[:22]:24s} n={len(v):6d}  배율 {math.exp(st.median(v)):5.2f}")


def main():
    rows = asyncio.run(load())
    rows = asyncio.run(enrich(rows))
    for s in rows:
        p = predict(s, eff=RC.EFF_RATIO)
        s["_r"] = math.log(s["crawl_unit"] / p) if p and p > 0 else None
    ok = [s for s in rows if s["_r"] is not None]
    print(f"표본 {len(ok):,} · 잔차 중앙 배율 {math.exp(st.median([s['_r'] for s in ok])):.2f}"
          f" · 잔차 표준편차(로그) {st.pstdev([s['_r'] for s in ok]):.3f}\n")

    print("[연속 변수] ρ = 잔차와의 순위상관. 분위별 배율이 단조로우면 넣을 값이다.")
    buckets(ok, "g", "공시지가(원/㎡)")
    buckets(ok, "sd", "역거리(m)")
    buckets(ok, "dpop", "낮 생활인구")
    buckets(ok, "npop", "밤 생활인구")
    buckets(ok, None, "주야비(낮÷밤)", fn=lambda s: (s["dpop"] / s["npop"])
            if s.get("dpop") and s.get("npop") else None)
    buckets(ok, "ta", "연면적(㎡)")
    buckets(ok, "la", "대지면적(㎡)")
    buckets(ok, "fa", "지상층수")
    buckets(ok, None, "연식(년)", fn=lambda s: (2026 - int(str(s["approval_ymd"])[:4]))
            if s.get("approval_ymd") and str(s["approval_ymd"])[:4].isdigit() else None)
    buckets(ok, None, "용적률(%)", fn=lambda s: (s["ta"] / s["la"] * 100)
            if s.get("ta") and s.get("la") else None)
    buckets(ok, "ev", "승강기(대)")
    print()
    print("[범주 변수]")
    cats(ok, "rf", "도로접면")
    cats(ok, "uz", "용도지역")
    cats(ok, "sang", "상권(상위)", top=10)


if __name__ == "__main__":
    main()
