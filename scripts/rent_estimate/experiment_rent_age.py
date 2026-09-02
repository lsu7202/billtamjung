"""임대 추정 — 연식을 제대로 넣는다(2026-08-29).

experiment_rent_v3.py 에서 연식을 넣었는데 27.7% → 27.5% 로 0.2%p 밖에 안 줄었다.
연식이 임대료와 관계가 없어서가 아니라 **내가 두 가지를 빠뜨렸기 때문**이다.

  ① **대수선을 안 봤다.** 사용승인일만 썼다. 1985년에 지었어도 2020년에 대수선한
     건물은 새 건물처럼 받는다. 대장에 15,432동이 적혀 있는데 안 쓰고 있었다.
     (적정가 F-17 은 이미 유효연식 = 대수선 경과 + 5년 으로 쓰고 있다.)

  ② **관계가 직선이 아니다.** 잔차를 연식 분위로 잘라 보면 U자다:
        신축 1.54 → 1.23 → 1.10 → 1.07 → 1.10 → 오래됨 1.20
     신축을 크게 과소평가하고, 아주 오래된 것도 과소평가한다. 가운데가 맞는다.
     그런데 나는 「10년마다 몇 % 감가」라는 **단조 감가**를 걸었다.
     단조 함수로는 U자를 못 잡는다 — 한쪽을 맞추면 반대쪽이 틀어진다.

그래서 구간별 계수로 다시 짠다. 학습·검증은 구 단위로 가른다.

    backend/.venv/bin/python scripts/rent_estimate/experiment_rent_age.py
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
from experiment_rent_v3 import add_gu, err, fit_pow, rate_rel, show

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")

# 연식 구간 — 잔차 U자가 꺾이는 자리에서 끊었다
BANDS = [(0, 5), (5, 10), (10, 20), (20, 30), (30, 40), (40, 200)]
BAND_KO = ["0-5년", "5-10", "10-20", "20-30", "30-40", "40년+"]

REMODEL_OFFSET = 5.0     # 적정가와 같은 규칙: 유효연식 = 대수선 경과 + 5년


async def add_age(rows):
    """사용승인일 + **대수선**. 유효연식 = 둘 중 새 쪽 기준."""
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=600)
    r = await c.fetch("SELECT building_pk pk, approval_ymd, remodel_ymd"
                      "  FROM master.buildings WHERE building_pk = ANY($1)",
                      list({s["pk"] for s in rows}))
    await c.close()
    A = {x["pk"]: (x["approval_ymd"], x["remodel_ymd"]) for x in r}
    for s in rows:
        ap, rm = A.get(s["pk"], (None, None))
        s["age_raw"] = _yrs(ap)
        s["age_eff"] = _eff(ap, rm)
        s["remodeled"] = rm is not None
    return rows


def _yrs(ymd):
    y = str(ymd or "")[:4]
    return (2026 - int(y)) if y.isdigit() and 1900 < int(y) <= 2026 else None


def _eff(ap, rm):
    a = _yrs(ap)
    r = _yrs(rm)
    if r is not None:
        v = r + REMODEL_OFFSET
        return min(a, v) if a is not None else v
    return a


def band(age):
    if age is None:
        return None
    for i, (lo, hi) in enumerate(BANDS):
        if lo <= age < hi:
            return i
    return len(BANDS) - 1


def train(tr, use_age=None, kr=0.4):
    """층대별 공시지가 계수 + (선택) 연식 구간 계수."""
    by = defaultdict(list)
    for s in tr:
        by[s["b"]].append(s)
    co = {b: fit_pow([x["g"] for x in v], [x["crawl_unit"] for x in v])
          for b, v in by.items() if len(v) >= 150}
    co["_"] = fit_pow([x["g"] for x in tr], [x["crawl_unit"] for x in tr])
    rr = [r for r in (rate_rel(s) for s in tr) if r]
    m = {"co": co, "rmed": st.median(rr) if rr else 1.0, "kr": kr, "age": None}
    if use_age:
        # 구간 계수 = 그 구간 잔차의 중앙 배율. 단조 가정 없이 데이터가 모양을 정한다.
        res = defaultdict(list)
        for s in tr:
            b = band(s.get(use_age))
            if b is None:
                continue
            p = _base(s, m)
            if p and p > 0:
                res[b].append(s["crawl_unit"] / p)
        m["age"] = {b: st.median(v) for b, v in res.items() if len(v) >= 100}
        m["age_key"] = use_age
    return m


def _base(s, m):
    a, b = m["co"].get(s["b"], m["co"]["_"])
    p = a * s["g"] ** b
    if m["kr"]:
        r = rate_rel(s)
        if r:
            p *= max(0.5, min(2.0, r / m["rmed"])) ** m["kr"]
    return p


def pred(s, m):
    p = _base(s, m)
    if m.get("age"):
        b = band(s.get(m["age_key"]))
        if b is not None and b in m["age"]:
            p *= m["age"][b]
    return p


def evaluate(tr, te, **kw):
    m = train(tr, **kw)
    v = [pred(s, m) / s["crawl_unit"] for s in te]
    if not v:
        return None
    k = st.median(v)
    return err([x / k for x in v]), m


def main():
    rows = asyncio.run(load())
    rows = [s for s in rows if s.get("crawl_unit")]
    # 공시지가
    c = asyncio.run(_gongsi(rows))
    rows = [s for s in rows if s["pk"] in c]
    for s in rows:
        s["g"] = c[s["pk"]]
        s["b"] = bucket(s["n"])
    rows = asyncio.run(add_gu(rows))
    rows = asyncio.run(add_age(rows))
    gus = sorted({s["gu"] for s in rows})
    tr = [s for s in rows if gus.index(s["gu"]) % 2 == 0]
    te = [s for s in rows if gus.index(s["gu"]) % 2 == 1]
    print(f"학습 {len(tr):,}층 · 검증 {len(te):,}층")
    print(f"대수선 있는 층 {sum(1 for s in rows if s['remodeled']):,}"
          f" ({sum(1 for s in rows if s['remodeled'])*100//len(rows)}%)\n")

    p1 = [(predict(s, eff=1.0), s) for s in te]
    p1 = [(p, s) for p, s in p1 if p]
    k1 = st.median([s["crawl_unit"] / p for p, s in p1])
    print("[검증셋]")
    show("① 지금(상권 요율 × 층)", err([p * k1 / s["crawl_unit"] for p, s in p1]))
    r0, _ = evaluate(tr, te)
    show("② 공시지가 + 상권수준", r0)
    r1, m1 = evaluate(tr, te, use_age="age_raw")
    show("③ + 연식(사용승인일만·구간별)", r1)
    r2, m2 = evaluate(tr, te, use_age="age_eff")
    show("④ + 유효연식(대수선 반영·구간별)", r2)

    print("\n[학습셋이 찾아낸 연식 구간 계수] 1.00 보다 크면 그 구간은 더 받는다")
    print(f"  {'구간':8s} {'사용승인일만':>10s} {'대수선 반영':>10s}")
    for i, ko in enumerate(BAND_KO):
        a = m1["age"].get(i)
        b = m2["age"].get(i)
        print(f"  {ko:8s} {(f'{a:10.3f}' if a else '         —')}"
              f" {(f'{b:10.3f}' if b else '         —')}")

    print("\n[대수선한 건물만 따로] 대수선을 반영하면 이 무리가 얼마나 나아지나")
    rem = [s for s in te if s["remodeled"]]
    if rem:
        for lab, m in (("사용승인일만", m1), ("대수선 반영", m2)):
            v = [pred(s, m) / s["crawl_unit"] for s in rem]
            k = st.median(v)
            e = err([x / k for x in v])
            print(f"  {lab:12s} n={e['n']:5d}  절반이 {e['mid']:5.1f}% 안  ±30% {e['hit30']:4.1f}%")


async def _gongsi(rows):
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=600)
    r = await c.fetch("SELECT building_pk pk, gongsi_latest::float g FROM master.buildings"
                      " WHERE building_pk = ANY($1) AND gongsi_latest > 0",
                      list({s["pk"] for s in rows}))
    await c.close()
    return {x["pk"]: float(x["g"]) for x in r}


if __name__ == "__main__":
    main()
