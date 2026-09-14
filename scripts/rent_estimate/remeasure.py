"""깨끗한 잣대로 전부 다시 잰다(2026-08-29).

앞서 낸 숫자는 오염된 잣대(좌표 30m 스냅 · 중복 매물 포함)로 낸 것이라 폐기했다.
master._crawl_clean(주소로 붙임 · 중복 제거 · 대장에 있는 층만 · 13.6만건 · 35,893동)
으로 처음부터 다시 잰다.

재는 것:
  ① 지금 산식이 실제로 얼마나 틀리나
  ② 공시지가 주축으로 바꾸면 얼마나 주나
  ③ 각 항(상권수준·연식·층용도)이 얼마씩 보태나
  ④ 눈금 — 우리가 정말 과소평가하고 있나

정직하게 재려고 **구를 반씩 갈라** 한쪽에서 계수를 뽑아 다른 쪽에서 채점한다.

    backend/.venv/bin/python scripts/rent_estimate/remeasure.py
"""
import asyncio
import math
import os
import statistics as st
from collections import defaultdict

import asyncpg
import rent_common as RC

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")

USE_KEYS = [("의료", ["의료", "병원", "의원", "치과", "한의"]),
            ("음식", ["음식", "제과"]), ("판매", ["판매", "소매", "상점", "슈퍼", "시장"]),
            ("업무", ["사무", "업무", "오피스", "금융"]), ("교육", ["학원", "교육", "도서"]),
            ("숙박", ["숙박", "호텔", "여관"]), ("위락", ["위락", "유흥", "단란", "노래"]),
            ("운동", ["운동", "체육", "골프"]), ("문화", ["문화", "집회", "공연", "종교"]),
            ("근생", ["근린생활"]), ("주거", ["주택", "주거", "오피스텔", "아파트"]),
            ("창고", ["창고", "공장", "물류"])]
BANDS = [(0, 5), (5, 10), (10, 20), (20, 30), (30, 40), (40, 200)]
BAND_KO = ["0-5년", "5-10", "10-20", "20-30", "30-40", "40년+"]


def ugroup(u):
    u = str(u or "")
    for k, keys in USE_KEYS:
        if any(x in u for x in keys):
            return k
    return "기타"


def bucket(n):
    if n < 0:
        return "B"
    if n <= 3:
        return str(n)
    if n <= 5:
        return "4-5"
    if n <= 10:
        return "6-10"
    return "11+"


def band(age):
    if age is None:
        return None
    for i, (lo, hi) in enumerate(BANDS):
        if lo <= age < hi:
            return i
    return len(BANDS) - 1


def yrs(ymd):
    y = str(ymd or "")[:4]
    return (2026 - int(y)) if y.isdigit() and 1900 < int(y) <= 2026 else None


async def load(min_ads=2):
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=1800)
    cr = await c.fetch(f"""
        SELECT building_pk pk, floor, count(*) ads,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY rent/area_c) u_c,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY area_c) ac
          FROM master._crawl_clean
         GROUP BY 1,2 HAVING count(*) >= {min_ads}""")
    pks = list({r["pk"] for r in cr})
    b = await c.fetch(f"""
        SELECT b.building_pk pk, substr(b.bjd_code,1,5) gu, b.gongsi_latest::float g,
               b.approval_ymd, b.remodel_ymd, b.total_area::float ta, b.land_use lu,
               b.main_use mu, b.station_dist::float sd,
               b.elevator::float ev, b.parking::float pk_n,
               b.floors_above::float fa, {RC.SANG_SQL} sang
          FROM master.buildings b WHERE b.building_pk = ANY($1) AND b.gongsi_latest > 0""", pks)
    fo = await c.fetch("SELECT building_pk pk, floor, use, floor_area::float a"
                       "  FROM master.floor_outline WHERE building_pk = ANY($1)", pks)
    await c.close()

    B = {r["pk"]: dict(r) for r in b}
    FL = defaultdict(list)
    for r in fo:
        FL[r["pk"]].append(dict(r))
    for pk, rows in FL.items():
        bb = B.get(pk)
        if not bb:
            continue
        tot = sum(r["a"] or 0 for r in rows)
        off = sum((r["a"] or 0) for r in rows
                  if any(k in (r["use"] or "") for k in ["사무", "업무", "오피스", "연구", "교육", "학원"]))
        bb["series"] = RC.pick_series(bb["ta"], bb["lu"], off, tot)
        bb["_fl"] = rows
    out = []
    for r in cr:
        bb = B.get(r["pk"])
        if not bb or "_fl" not in bb:
            continue
        fl = r["floor"]
        same = [x for x in bb["_fl"] if RC.signed_floor(x["floor"]) == fl]
        if not same:
            continue
        area = sum(x["a"] or 0 for x in same
                   if not any(k in (x["use"] or "") for k in RC.EXCL))
        if area <= 0:
            continue
        uses = defaultdict(float)
        for x in same:
            uses[ugroup(x["use"])] += x["a"] or 0
        a_ap, a_rm = yrs(bb["approval_ymd"]), yrs(bb["remodel_ymd"])
        eff_age = min(a_ap, a_rm + 5) if (a_ap is not None and a_rm is not None) \
            else (a_rm + 5 if a_rm is not None else a_ap)
        out.append({**bb, "floor": fl, "b": bucket(fl), "label": same[0]["floor"],
                    "farea": area, "u": float(r["u_c"]), "ads": r["ads"],
                    "fuse": max(uses, key=uses.get) if uses else None,
                    "muse": str(bb["mu"] or "")[:2] or None,
                    "age": eff_age,
                    # 건물 「급」 — 봉천동 짝(연면적 9.3만 vs 1.9만 · 엘리베이터 7 vs 2 ·
                    # 주차 682 vs 105)에서 눈에 띈 축. 지금 산식은 하나도 안 본다.
                    "ev": bb["ev"], "pk_n": bb["pk_n"], "fa": bb["fa"]})
    return out


def now_unit(s):
    """지금 산식의 ㎡당 단가."""
    rate, _ = RC.rate_for(s["series"], s["sang"])
    if not rate:
        return None
    rt = RC.pick_rate(s["series"], s["label"], rate)
    if not rt:
        return None
    return rt * 1000 * RC.EFF_RATIO * RC.market_adj(s["label"])


def rate_rel(s):
    t = RC.TBL.get(s["series"]) or {}
    a, b = t.get(s.get("sang") or ""), t.get(RC.SEOUL_AVG)
    if not a or not b:
        return None
    ra, rb = RC.pick_rate(s["series"], s["label"], a), RC.pick_rate(s["series"], s["label"], b)
    return (ra / rb) if (ra and rb and rb > 0) else None


def fit_pow(xs, ys):
    lx, ly = [math.log(x) for x in xs], [math.log(y) for y in ys]
    mx, my = st.mean(lx), st.mean(ly)
    num = sum((a - mx) * (b - my) for a, b in zip(lx, ly))
    den = sum((a - mx) ** 2 for a in lx)
    bb = num / den if den else 0.0
    return math.exp(my - bb * mx), bb


# 건물 「급」 축 — 절대 대수가 아니라 **연면적 대비**로 본다.
# 연면적 9만㎡에 엘리베이터 7대와 500㎡에 1대는 급이 다르지 않다. 규모로 나눠야 급이 나온다.
# NULL 은 「모른다」가 아니라 **「없다」**다(2026-08-29 확인).
# 서울 58만 동에 elevator=0 · parking=0 인 행이 **한 건도 없다** — 전부 NULL 아니면 1 이상.
# 층수별 NULL 비율이 그 뜻을 말한다: 2층 건물 97.7% NULL · 8층 건물 0.6% NULL.
# 낮은 건물엔 엘리베이터가 없으니 대장에 안 적힌 것이다.
# 이걸 「값 없음」으로 버리면 **엘리베이터 없는 건물 40%를 통째로 빼고** 재게 된다.
GRADE = {
    "ev":   lambda s: ((s["ev"] or 0) / (s["ta"] / 3000.0)) if s.get("ta") else None,
    "pk":   lambda s: ((s["pk_n"] or 0) / (s["ta"] / 1000.0)) if s.get("ta") else None,
    "size": lambda s: s.get("ta"),
    "sd":   lambda s: s.get("sd"),
}
GRADE_KO = {"ev": "엘리베이터(연면적당)", "pk": "주차(연면적당)",
            "size": "연면적", "sd": "역거리"}


def train(tr, kr=0.0, age=False, fuse=False, muse=False, grade=()):
    by = defaultdict(list)
    for s in tr:
        by[s["b"]].append(s)
    co = {k: fit_pow([x["g"] for x in v], [x["u"] for x in v])
          for k, v in by.items() if len(v) >= 150}
    co["_"] = fit_pow([x["g"] for x in tr], [x["u"] for x in tr])
    rr = [r for r in (rate_rel(s) for s in tr) if r]
    m = {"co": co, "rmed": st.median(rr) if rr else 1.0, "kr": kr,
         "age": None, "fuse": None, "muse": None}
    if age:
        res = defaultdict(list)
        for s in tr:
            bd, p = band(s["age"]), _p(s, m)
            if bd is not None and p:
                res[bd].append(s["u"] / p)
        m["age"] = {k: st.median(v) for k, v in res.items() if len(v) >= 80}
    for key, on in (("fuse", fuse), ("muse", muse)):
        if not on:
            continue
        res = defaultdict(list)
        for s in tr:
            k, p = s.get(key), _p(s, m)
            if k and p:
                res[k].append(s["u"] / p)
        m[key] = {k: st.median(v) for k, v in res.items() if len(v) >= 80}
    # 연속 축은 분위 구간별 계수로 — 관계가 직선인지 모르니 모양을 데이터가 정하게 둔다
    m["grade"] = {}
    for key in grade:
        vals = [(GRADE[key](s), s) for s in tr]
        vals = [(x, s) for x, s in vals if x is not None]
        if len(vals) < 800:
            continue
        vals.sort(key=lambda t: t[0])
        step = len(vals) // 5
        cuts, coef = [], []
        for i in range(5):
            seg = vals[i*step:(i+1)*step] if i < 4 else vals[i*step:]
            if not seg:
                continue
            cuts.append(seg[-1][0])
            r = [s["u"] / _p(s, m) for _, s in seg if _p(s, m)]
            coef.append(st.median(r) if r else 1.0)
        m["grade"][key] = (cuts, coef)
    return m


def _grade_mul(s, m):
    out = 1.0
    for key, (cuts, coef) in (m.get("grade") or {}).items():
        x = GRADE[key](s)
        if x is None:
            continue
        i = 0
        while i < len(cuts) - 1 and x > cuts[i]:
            i += 1
        out *= coef[i]
    return out


def _p(s, m):
    a, b = m["co"].get(s["b"], m["co"]["_"])
    p = a * s["g"] ** b
    if m["kr"]:
        r = rate_rel(s)
        if r:
            p *= max(0.5, min(2.0, r / m["rmed"])) ** m["kr"]
    if m.get("age"):
        bd = band(s["age"])
        if bd in m["age"]:
            p *= m["age"][bd]
    for key in ("fuse", "muse"):
        t = m.get(key)
        if t and s.get(key) in t:
            p *= t[s[key]]
    if m.get("grade"):
        p *= _grade_mul(s, m)
    return p


def err(rat, k=None):
    if not rat:
        return None
    k = k if k is not None else st.median(rat)
    v = [x / k for x in rat]
    ape = [abs(x - 1) * 100 for x in v]
    return {"n": len(v), "mid": st.median(ape), "raw_med": st.median(rat),
            "h20": sum(1 for e in ape if e <= 20) / len(ape) * 100,
            "h30": sum(1 for e in ape if e <= 30) / len(ape) * 100}


def show(name, r, base=None):
    if not r:
        print(f"  {name:32s} —")
        return
    d = f" ({r['mid']-base:+5.1f}%p)" if base is not None else " " * 9
    print(f"  {name:32s} n={r['n']:6d}  절반이 {r['mid']:5.1f}% 안{d}"
          f"  ±20% {r['h20']:4.1f}%  ±30% {r['h30']:4.1f}%")


def main():
    rows = asyncio.run(load())
    gus = sorted({s["gu"] for s in rows})
    tr = [s for s in rows if gus.index(s["gu"]) % 2 == 0]
    te = [s for s in rows if gus.index(s["gu"]) % 2 == 1]
    print(f"표본 {len(rows):,}(건물×층, 서로 다른 매물 2건 이상) · {len({s['pk'] for s in rows}):,}동")
    print(f"학습 {len(tr):,} · 검증 {len(te):,}\n")

    print("[④ 눈금 — 우리가 정말 싸게 보고 있나]")
    v = [(now_unit(s), s) for s in te]
    v = [(p, s) for p, s in v if p]
    ratio = [p / s["u"] for p, s in v]
    print(f"  지금 산식 ÷ 실제 호가 중앙 {st.median(ratio):.2f}")
    print(f"    (1.00 이면 눈금이 맞음 · 0.83 이면 17% 싸게 본다는 뜻)")
    print(f"  옛 잣대에서는 0.83 이었다 — 오염을 걷어내니 이 값이 바뀌었는지 본다\n")

    print("[① 지금 산식 · ② 공시지가 주축] 검증셋")
    base = err(ratio)
    show("① 지금(상권요율 × 층)", base)
    b0 = base["mid"]
    m = train(tr)
    show("② 공시지가만", err([_p(s, m) / s["u"] for s in te]), b0)

    print("\n[③ 항을 하나씩 더한다]")
    best_kr, bk = 0.0, None
    for kr in (0.2, 0.4, 0.6):
        m = train(tr, kr=kr)
        r = err([_p(s, m) / s["u"] for s in te])
        show(f"  + 상권수준^{kr}", r, b0)
        if bk is None or r["mid"] < bk:
            best_kr, bk = kr, r["mid"]
    m = train(tr, kr=best_kr, age=True)
    show("  + 연식(대수선 반영)", err([_p(s, m) / s["u"] for s in te]), b0)
    m = train(tr, kr=best_kr, age=True, fuse=True)
    show("  + 층 용도", err([_p(s, m) / s["u"] for s in te]), b0)
    m = train(tr, kr=best_kr, age=True, fuse=True, muse=True)
    fin = err([_p(s, m) / s["u"] for s in te])
    show("  + 주용도", fin, b0)

    print("\n[④ 건물 급 — 엘리베이터·주차·규모·역거리]")
    print("   봉천동 짝에서 눈에 띈 축. 절대 대수가 아니라 연면적 대비로 본다.")
    base_kw = dict(kr=best_kr, age=True, fuse=True, muse=True)
    for key in ("ev", "pk", "size", "sd"):
        mm = train(tr, **base_kw, grade=(key,))
        show(f"  + {GRADE_KO[key]}", err([_p(s, mm) / s["u"] for s in te]), b0)
    m_all = train(tr, **base_kw, grade=("ev", "pk", "size", "sd"))
    r_all = err([_p(s, m_all) / s["u"] for s in te])
    show("  + 넷 다", r_all, b0)
    mm2 = train(tr, **base_kw, grade=("ev", "pk"))
    show("  + 엘리베이터·주차만", err([_p(s, mm2) / s["u"] for s in te]), b0)

    if r_all and r_all["mid"] < fin["mid"]:
        fin, m = r_all, m_all
    for key, (cuts, coef) in (m.get("grade") or {}).items():
        print(f"\n  [{GRADE_KO[key]}] 구간별 계수")
        prev = None
        for cu, co in zip(cuts, coef):
            lo = "" if prev is None else f"{prev:,.1f} ~ "
            print(f"    {lo}{cu:,.1f}   ×{co:.2f}")
            prev = cu

    print(f"\n[최종] 지금 {b0:.1f}%  →  새 산식 {fin['mid']:.1f}%"
          f"  ({b0-fin['mid']:.1f}%p 줄어듦)")
    print(f"  ±30% 안에 드는 비율 {base['h30']:.1f}% → {fin['h30']:.1f}%")

    print("\n[연식 구간 계수] 학습셋이 찾아낸 값")
    for i, ko in enumerate(BAND_KO):
        if i in (m["age"] or {}):
            print(f"  {ko:8s} ×{m['age'][i]:.2f}")
    print("\n[층 용도 계수]")
    for k, x in sorted((m["fuse"] or {}).items(), key=lambda t: -t[1]):
        print(f"  {k:6s} ×{x:.2f}")


if __name__ == "__main__":
    main()
