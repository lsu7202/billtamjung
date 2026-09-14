"""임대 추정 — 층 용도 · 주용도 · 실거래를 넣는다(2026-08-29).

사용자 지적 셋을 그대로 시험한다.

  ① **층별 용도** — 우리는 `master.floor_outline.use` 를 갖고 있으면서
     지금은 주차장·기계실을 **거르는 데만** 쓴다. 그 층이 병원인지 사무실인지
     식당인지는 안 본다. 같은 건물 3층이라도 의료시설과 창고는 임대료가 다르다.
  ② **주용도** — 건물 전체 성격(`buildings.main_use`).
  ③ **실거래** — 비싸게 팔린 건물은 임대료도 비쌀 것이다.
     실거래가 없는 건물이 많으니 빌탐정 추정가(sale_est)도 함께 본다.
     다만 추정가는 공시지가에서 파생되므로 이미 쓴 공시지가와 겹친다 — 실거래가 진짜 새 정보다.

바탕은 experiment_rent_age.py 의 ④(공시지가 + 상권수준 + 유효연식) = 검증 26.8%.

    backend/.venv/bin/python scripts/rent_estimate/experiment_rent_use.py
"""
import asyncio
import math
import os
import statistics as st
from collections import defaultdict

import asyncpg
from backtest_rent import load, predict
from experiment_rent_comp import bucket
from experiment_rent_v3 import add_gu, err, fit_pow, rate_rel, show
from experiment_rent_age import BANDS, BAND_KO, add_age, band

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")

# 층 용도를 굵게 묶는다 — 대장 문자열은 수백 가지라 그대로 쓰면 표본이 흩어진다
USE_GROUP = [
    ("의료", ["의료", "병원", "의원", "치과", "한의", "약국", "산후조리"]),
    ("교육", ["학원", "교육", "학교", "도서", "연구"]),
    ("숙박", ["숙박", "호텔", "여관", "관광"]),
    ("위락", ["위락", "유흥", "단란", "노래", "무도"]),
    ("음식", ["휴게음식", "일반음식", "음식점", "제과"]),
    ("판매", ["판매", "소매", "상점", "슈퍼", "시장", "도매"]),
    ("업무", ["사무", "업무", "오피스", "금융", "부동산중개"]),
    ("운동", ["운동", "체육", "체력", "골프", "수영"]),
    ("문화", ["문화", "집회", "공연", "전시", "종교"]),
    ("근생", ["근린생활"]),
    ("주거", ["주택", "주거", "아파트", "다세대", "연립", "오피스텔", "기숙"]),
    ("창고", ["창고", "공장", "저장", "물류"]),
]


def use_group(u):
    u = str(u or "")
    for name, keys in USE_GROUP:
        if any(k in u for k in keys):
            return name
    return "기타"


async def add_use(rows):
    """층 용도(그 층에서 면적이 가장 큰 용도) + 주용도."""
    pks = list({s["pk"] for s in rows})
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=900)
    fo = await c.fetch(
        "SELECT building_pk pk, floor, use, floor_area::float a"
        "  FROM master.floor_outline WHERE building_pk = ANY($1)", pks)
    mu = await c.fetch(
        "SELECT building_pk pk, main_use FROM master.buildings WHERE building_pk = ANY($1)", pks)
    await c.close()
    from rent_common import signed_floor
    F = defaultdict(lambda: defaultdict(float))
    for r in fo:
        n = signed_floor(r["floor"])
        if n is not None and r["a"]:
            F[r["pk"]][(n, use_group(r["use"]))] += r["a"]
    M = {r["pk"]: str(r["main_use"] or "")[:2] for r in mu}
    for s in rows:
        cand = {k[1]: v for k, v in F.get(s["pk"], {}).items() if k[0] == s["n"]}
        s["fuse"] = max(cand, key=cand.get) if cand else None
        s["muse"] = M.get(s["pk"])
    return rows


async def add_price(rows):
    """실거래 평단가(최근) + 빌탐정 추정가 평단가."""
    pks = list({s["pk"] for s in rows})
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=900)
    sh = await c.fetch("""
        SELECT DISTINCT ON (sh.building_pk) sh.building_pk pk,
               (sh.price / NULLIF(sh.total_area,0))::float pa, sh.contract_ym
          FROM master.sales_history sh
         WHERE sh.building_pk = ANY($1) AND sh.price > 0 AND sh.total_area > 0
         ORDER BY sh.building_pk, sh.contract_ym DESC""", pks)
    se = await c.fetch("""
        SELECT se.building_pk pk, (se.sale_est / NULLIF(b.total_area,0))::float pa
          FROM master.building_sale_est se
          JOIN master.buildings b USING (building_pk)
         WHERE se.building_pk = ANY($1) AND se.sale_est > 0 AND b.total_area > 0""", pks)
    await c.close()
    R = {r["pk"]: float(r["pa"]) for r in sh if r["pa"]}
    E = {r["pk"]: float(r["pa"]) for r in se if r["pa"]}
    for s in rows:
        s["real_pa"] = R.get(s["pk"])
        s["est_pa"] = E.get(s["pk"])
    return rows


def train(tr, use_age="age_eff", kr=0.4, fuse=False, muse=False, pkey=None, pk_pow=0.0):
    by = defaultdict(list)
    for s in tr:
        by[s["b"]].append(s)
    co = {b: fit_pow([x["g"] for x in v], [x["crawl_unit"] for x in v])
          for b, v in by.items() if len(v) >= 150}
    co["_"] = fit_pow([x["g"] for x in tr], [x["crawl_unit"] for x in tr])
    rr = [r for r in (rate_rel(s) for s in tr) if r]
    m = {"co": co, "rmed": st.median(rr) if rr else 1.0, "kr": kr,
         "age": None, "fuse": None, "muse": None, "pkey": pkey, "pk_pow": pk_pow, "pmed": None}
    # 연식 구간
    res = defaultdict(list)
    for s in tr:
        b = band(s.get(use_age))
        p = _base(s, m)
        if b is not None and p and p > 0:
            res[b].append(s["crawl_unit"] / p)
    m["age"] = {b: st.median(v) for b, v in res.items() if len(v) >= 100}
    m["age_key"] = use_age
    # 층 용도 · 주용도 — 남은 잔차의 중앙 배율
    for key, on in (("fuse", fuse), ("muse", muse)):
        if not on:
            continue
        r2 = defaultdict(list)
        for s in tr:
            k = s.get(key)
            p = _mid(s, m)
            if k and p and p > 0:
                r2[k].append(s["crawl_unit"] / p)
        m[key] = {k: st.median(v) for k, v in r2.items() if len(v) >= 100}
    if pkey:
        v = [s[pkey] for s in tr if s.get(pkey)]
        m["pmed"] = st.median(v) if v else None
    return m


def _base(s, m):
    a, b = m["co"].get(s["b"], m["co"]["_"])
    p = a * s["g"] ** b
    if m["kr"]:
        r = rate_rel(s)
        if r:
            p *= max(0.5, min(2.0, r / m["rmed"])) ** m["kr"]
    return p


def _mid(s, m):
    p = _base(s, m)
    if m.get("age"):
        b = band(s.get(m["age_key"]))
        if b is not None and b in m["age"]:
            p *= m["age"][b]
    return p


def pred(s, m):
    p = _mid(s, m)
    for key in ("fuse", "muse"):
        t = m.get(key)
        if t:
            k = s.get(key)
            if k in t:
                p *= t[k]
    if m.get("pkey") and m.get("pmed") and m["pk_pow"]:
        v = s.get(m["pkey"])
        if v:
            p *= max(0.4, min(2.5, v / m["pmed"])) ** m["pk_pow"]
    return p


def ev(tr, te, **kw):
    m = train(tr, **kw)
    v = [pred(s, m) / s["crawl_unit"] for s in te]
    if not v:
        return None, None
    k = st.median(v)
    return err([x / k for x in v]), m


def main():
    rows = asyncio.run(load())
    c = asyncio.run(_gongsi(rows))
    rows = [s for s in rows if s["pk"] in c]
    for s in rows:
        s["g"] = c[s["pk"]]
        s["b"] = bucket(s["n"])
    rows = asyncio.run(add_gu(rows))
    rows = asyncio.run(add_age(rows))
    rows = asyncio.run(add_use(rows))
    rows = asyncio.run(add_price(rows))
    gus = sorted({s["gu"] for s in rows})
    tr = [s for s in rows if gus.index(s["gu"]) % 2 == 0]
    te = [s for s in rows if gus.index(s["gu"]) % 2 == 1]
    print(f"학습 {len(tr):,}층 · 검증 {len(te):,}층")
    print(f"  층 용도 있음 {sum(1 for s in rows if s['fuse']):,}"
          f" · 실거래 있음 {sum(1 for s in rows if s['real_pa']):,}"
          f" · 추정가 있음 {sum(1 for s in rows if s['est_pa']):,}\n")

    p1 = [(predict(s, eff=1.0), s) for s in te]
    p1 = [(p, s) for p, s in p1 if p]
    k1 = st.median([s["crawl_unit"] / p for p, s in p1])
    print("[검증셋]")
    show("① 지금(상권 요율 × 층)", err([p * k1 / s["crawl_unit"] for p, s in p1]))
    b4, _ = ev(tr, te)
    show("④ 공시+상권수준+유효연식", b4)
    r5, m5 = ev(tr, te, fuse=True)
    show("⑤ + 층 용도", r5)
    r6, _ = ev(tr, te, fuse=True, muse=True)
    show("⑥ + 주용도", r6)

    print("\n[실거래 · 추정가]")
    for key, ko in (("real_pa", "실거래 평단가"), ("est_pa", "빌탐정 추정가")):
        for pw in (0.1, 0.2, 0.3, 0.5):
            r, _ = ev(tr, te, fuse=True, pkey=key, pk_pow=pw)
            show(f"  ⑤ + {ko}^{pw}", r)

    print("\n[학습셋이 찾아낸 층 용도 계수] 1.00 보다 크면 그 용도는 더 받는다")
    for k, v in sorted(m5["fuse"].items(), key=lambda t: -t[1]):
        n = sum(1 for s in tr if s.get("fuse") == k)
        print(f"  {k:6s} n={n:6d}  ×{v:5.2f}")

    print("\n[실거래 있는 건물만 따로] 실거래가 실제로 도움이 되나")
    sub = [s for s in te if s.get("real_pa")]
    if sub:
        for lab, kw in (("⑤ 층용도까지", dict(fuse=True)),
                        ("⑤ + 실거래^0.3", dict(fuse=True, pkey="real_pa", pk_pow=0.3))):
            m = train(tr, **kw)
            v = [pred(s, m) / s["crawl_unit"] for s in sub]
            k = st.median(v)
            e = err([x / k for x in v])
            print(f"  {lab:16s} n={e['n']:5d}  절반이 {e['mid']:5.1f}% 안  ±30% {e['hit30']:4.1f}%")


async def _gongsi(rows):
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=600)
    r = await c.fetch("SELECT building_pk pk, gongsi_latest::float g FROM master.buildings"
                      " WHERE building_pk = ANY($1) AND gongsi_latest > 0",
                      list({s["pk"] for s in rows}))
    await c.close()
    return {x["pk"]: float(x["g"]) for x in r}


if __name__ == "__main__":
    main()
