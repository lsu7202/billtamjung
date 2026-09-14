"""임대 추정 v3 — 공시지가를 주축으로(2026-08-29).

**주변 호가 comp 방식은 폐기했다.** 네이버 크롤을 산식의 입력으로 쓰는 것이라
임대시세를 갱신할 때마다 남의 사이트를 긁어야 하고, 막히면 제품이 멈춘다.
크롤은 **우리 추정이 맞는지 재는 자**로만 쓴다.

그래서 우리가 가진 공공데이터만으로 다시 짠다. experiment_gongsi_rent.py 가
뜻밖의 답을 줬다 — 절반이 이 안에 드는 오차:

    ① 상권 요율만(지금)      33.1%
    ② 공시지가만            28.7%   ← 부동산원 표보다 공시지가 하나가 낫다
    ③ 상권 요율 + 공시 살짝   32.3%
    (참고) 주변 호가         25.3%   ← 쓸 수 없는 상한선

부동산원 표는 서울을 68칸으로만 나눈다. 공시지가는 **필지마다** 다르다.
그래서 상권 요율을 주축에 놓고 공시를 곁들이면(③) 공시의 힘을 못 쓴다.
자리를 잡는 일은 공시지가에 맡기고, 상권 요율은 「이 동네 임대료 수준」을
잡는 데만 쓰는 게 맞다.

정직하게 재려고 **구 단위로 학습·검증을 가른다.** 계수를 고른 구에서 재면
자기 답안지를 채점하는 것이다.

    backend/.venv/bin/python scripts/rent_estimate/experiment_rent_v3.py
"""
import asyncio
import math
import os
import statistics as st
from collections import defaultdict

import asyncpg
import rent_common as RC
from backtest_rent import load, predict
from experiment_rent_comp import bucket
from residual_rent import enrich

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")


async def add_gu(rows):
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=600)
    r = await c.fetch("SELECT building_pk pk, substr(bjd_code,1,5) gu"
                      "  FROM master.buildings WHERE building_pk = ANY($1)",
                      list({s["pk"] for s in rows}))
    await c.close()
    G = {x["pk"]: x["gu"] for x in r}
    for s in rows:
        s["gu"] = G.get(s["pk"])
    return [s for s in rows if s["gu"]]


def fit_pow(xs, ys):
    lx = [math.log(x) for x in xs]
    ly = [math.log(y) for y in ys]
    mx, my = st.mean(lx), st.mean(ly)
    num = sum((a - mx) * (b - my) for a, b in zip(lx, ly))
    den = sum((a - mx) ** 2 for a in lx)
    b = num / den if den else 0.0
    return math.exp(my - b * mx), b


def err(rat):
    if not rat:
        return None
    ape = [abs(x - 1) * 100 for x in rat]
    return {"n": len(rat), "med": st.median(rat), "mid": st.median(ape),
            "hit20": sum(1 for e in ape if e <= 20) / len(ape) * 100,
            "hit30": sum(1 for e in ape if e <= 30) / len(ape) * 100}


def show(name, r):
    if not r:
        print(f"  {name:34s} —")
        return
    print(f"  {name:34s} n={r['n']:6d}  절반이 {r['mid']:5.1f}% 안"
          f"  ±20% {r['hit20']:4.1f}%  ±30% {r['hit30']:4.1f}%")


def train(tr, kr=0.0, ka=0.0, ks=0.0):
    """학습 — 층대별 (a, b) + 보조축 계수는 밖에서 준다."""
    by = defaultdict(list)
    for s in tr:
        by[s["b"]].append(s)
    co = {}
    for b, v in by.items():
        if len(v) >= 150:
            co[b] = fit_pow([x["g"] for x in v], [x["crawl_unit"] for x in v])
    # 폴백 — 표본 적은 층대는 전체로
    co["_"] = fit_pow([x["g"] for x in tr], [x["crawl_unit"] for x in tr])
    # 상권 요율의 상대값(서울 평균 대비) — 「이 동네 임대료 수준」만 빌린다
    rr = []
    for s in tr:
        r0 = rate_rel(s)
        if r0:
            rr.append(r0)
    med = st.median(rr) if rr else 1.0
    return {"co": co, "rmed": med, "kr": kr, "ka": ka, "ks": ks}


def rate_rel(s):
    """이 건물의 상권 요율 ÷ 서울평균 요율(같은 층). 상권 수준만 뽑아 쓴다."""
    t = RC.TBL.get(s["series"]) or {}
    a = t.get(s.get("sang") or "")
    b = t.get(RC.SEOUL_AVG)
    if not a or not b:
        return None
    ra = RC.pick_rate(s["series"], s["label"], a)
    rb = RC.pick_rate(s["series"], s["label"], b)
    return (ra / rb) if (ra and rb and rb > 0) else None


def pred(s, m):
    a, b = m["co"].get(s["b"], m["co"]["_"])
    p = a * s["g"] ** b
    if m["kr"]:
        r = rate_rel(s)
        if r:
            p *= max(0.5, min(2.0, r / m["rmed"])) ** m["kr"]
    if m["ka"] and s.get("approval_ymd"):
        y = str(s["approval_ymd"])[:4]
        if y.isdigit():
            p *= (1.0 - m["ka"]) ** min((2026 - int(y)) / 10, 4)
    if m["ks"] and s.get("sd") is not None:
        p *= max(0.5, min(2.0, s["sd"] / 400.0)) ** (-m["ks"])
    return p


def evaluate(tr, te, **kw):
    m = train(tr, **kw)
    v = [pred(s, m) / s["crawl_unit"] for s in te if s.get("g")]
    if not v:
        return None
    k = st.median(v)                     # 눈금은 학습셋 기준이 아니라 전체 상수 하나로 맞춘다
    return err([x / k for x in v])


def main():
    rows = asyncio.run(load())
    rows = asyncio.run(enrich(rows))
    rows = [s for s in rows if s.get("g")]
    for s in rows:
        s["b"] = bucket(s["n"])
    rows = asyncio.run(add_gu(rows))
    gus = sorted({s["gu"] for s in rows})
    # 구를 반씩 갈라 학습·검증
    tr = [s for s in rows if gus.index(s["gu"]) % 2 == 0]
    te = [s for s in rows if gus.index(s["gu"]) % 2 == 1]
    print(f"학습 {len(tr):,}층({len({s['gu'] for s in tr})}개 구)"
          f" · 검증 {len(te):,}층({len({s['gu'] for s in te})}개 구)\n")

    # 지금 방식(검증셋에서)
    p1 = [(predict(s, eff=1.0), s) for s in te]
    p1 = [(p, s) for p, s in p1 if p]
    k1 = st.median([s["crawl_unit"] / p for p, s in p1])
    print("[검증셋에서 나란히]")
    show("① 지금(상권 요율 × 층)", err([p * k1 / s["crawl_unit"] for p, s in p1]))
    show("② 공시지가(층대별)", evaluate(tr, te))

    print("\n[공시지가 + 상권 수준 보조]")
    best = (0.0, evaluate(tr, te))
    for kr in (0.2, 0.4, 0.6, 0.8, 1.0):
        r = evaluate(tr, te, kr=kr)
        show(f"  + 상권^{kr:.1f}", r)
        if r and r["mid"] < best[1]["mid"]:
            best = (kr, r)
    kr = best[0]

    print("\n[+ 연식]")
    ba = (0.0, best[1])
    for ka in (0.02, 0.04, 0.06, 0.08):
        r = evaluate(tr, te, kr=kr, ka=ka)
        show(f"  + 연식 -{ka*100:.0f}%/10년", r)
        if r and r["mid"] < ba[1]["mid"]:
            ba = (ka, r)
    ka = ba[0]

    print("\n[+ 역거리]")
    bs = (0.0, ba[1])
    for ks in (0.05, 0.1, 0.2, 0.3):
        r = evaluate(tr, te, kr=kr, ka=ka, ks=ks)
        show(f"  + 역^-{ks:.2f}", r)
        if r and r["mid"] < bs[1]["mid"]:
            bs = (ks, r)
    ks = bs[0]

    fin = evaluate(tr, te, kr=kr, ka=ka, ks=ks)
    print("\n[검증셋 최종]")
    show("① 지금", err([p * k1 / s["crawl_unit"] for p, s in p1]))
    show(f"③ 공시 + 상권^{kr} 연식{ka} 역{ks}", fin)

    print("\n[구별 — 검증셋]")
    m = train(tr, kr=kr, ka=ka, ks=ks)
    byg = defaultdict(list)
    for s in te:
        byg[s["gu"]].append(pred(s, m) / s["crawl_unit"])
    kk = st.median([x for v in byg.values() for x in v])
    for gu, v in sorted(byg.items()):
        if len(v) < 300:
            continue
        e = err([x / kk for x in v])
        print(f"  {gu}  n={e['n']:5d}  절반이 {e['mid']:5.1f}% 안")


if __name__ == "__main__":
    main()
