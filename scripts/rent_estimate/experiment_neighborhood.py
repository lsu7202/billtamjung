"""구역 대신 **건물마다 주변을 직접 잰다**(2026-08-29).

구역(폴리곤) 방식은 한계가 뚜렷했다. 부동산원 72칸 → 서울시 1,650칸으로 23배 촘촘히
바꿔 넣어도 0.4%p 밖에 안 줄었다. 이유는 망원동에서 드러난다 — 망원시장 폴리곤 하나에
건물 134동이 들어가고 그 안에서 A·B 가 2.2배 갈린다. **구역을 잘게 나눠도 한 칸에
여러 건물이 들어가는 한 그 안의 차이는 그대로 남는다.**

그래서 칸을 없앤다. 건물마다 반경 안을 직접 세면 경계가 사라진다.
망원동에서 시험 삼아 재보니 실제로 갈렸다:

    반경 50m 근생 건물 : A 14동 · B 8동
    주변 평균 대지     : A 187㎡ · B 269㎡   (A 쪽이 잘게 쪼개짐 = 시장 도로)

재는 것(반경 30·50·100m):
  · 건물 수 — 촘촘한가
  · 근생 비율 — 점포가 몰렸나
  · 평균 대지 — 필지가 잘게 쪼개졌나(시장·상점가의 특징)
  · 평균 연면적 — 큰 건물 동네인가
  · 공시지가 상대 — 주변보다 이 땅이 비싼가

    backend/.venv/bin/python scripts/rent_estimate/experiment_neighborhood.py
"""
import asyncio
import math
import os
import statistics as st
from collections import defaultdict

import asyncpg
import rent_common as RC
from remeasure import (band, bucket, err, fit_pow, now_unit, rate_rel, show,
                       ugroup, yrs)

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")

# 주변을 재는 반경. 30m=바로 옆집 · 50m=이 골목 · 100m=이 블록
RADII = (30, 50, 100)


async def load():
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=3600)
    cr = await c.fetch("""
        SELECT building_pk pk, floor, count(*) ads,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY rent/area_c) u_c
          FROM master._crawl_clean GROUP BY 1,2 HAVING count(*) >= 2""")
    pks = list({r["pk"] for r in cr})
    print(f"  건물 {len(pks):,}동")

    b = await c.fetch(f"""
        SELECT b.building_pk pk, substr(b.bjd_code,1,5) gu, b.gongsi_latest::float g,
               b.approval_ymd, b.remodel_ymd, b.total_area::float ta, b.land_use lu,
               b.main_use mu, b.station_dist::float sd, b.land_area::float la,
               b.road_frontage rf, {RC.SANG_SQL} sang
          FROM master.buildings b WHERE b.building_pk = ANY($1) AND b.gongsi_latest > 0""", pks)

    # 주변 재기 — 반경마다 한 번씩. 건물 9천 동 × 3 반경이라 SQL 한 방에 시킨다.
    NB = defaultdict(dict)
    for R in RADII:
        print(f"  반경 {R}m 주변 세는 중…")
        rows = await c.fetch(f"""
            SELECT t.building_pk pk,
                   count(*) n,
                   count(*) FILTER (WHERE substr(x.main_use,1,2) IN ('03','04')) n_gen,
                   avg(x.land_area)::float avg_la,
                   avg(x.total_area)::float avg_ta,
                   avg(x.gongsi_latest)::float avg_g
              FROM master.buildings t
              JOIN master.buildings x
                ON ST_DWithin(x.geom::geography, t.geom::geography, {R})
             WHERE t.building_pk = ANY($1)
             GROUP BY 1""", pks)
        for r in rows:
            NB[r["pk"]][R] = dict(r)

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
        same = [x for x in bb["_fl"] if RC.signed_floor(x["floor"]) == r["floor"]]
        if not same:
            continue
        area = sum(x["a"] or 0 for x in same
                   if not any(k in (x["use"] or "") for k in RC.EXCL))
        if area <= 0:
            continue
        uses = defaultdict(float)
        for x in same:
            uses[ugroup(x["use"])] += x["a"] or 0
        ap, rm = yrs(bb["approval_ymd"]), yrs(bb["remodel_ymd"])
        age = min(ap, rm + 5) if (ap is not None and rm is not None) \
            else (rm + 5 if rm is not None else ap)
        s = {**bb, "floor": r["floor"], "b": bucket(r["floor"]), "label": same[0]["floor"],
             "farea": area, "u": float(r["u_c"]),
             "fuse": max(uses, key=uses.get) if uses else None,
             "muse": str(bb["mu"] or "")[:2] or None, "age": age}
        for R in RADII:
            d = NB.get(r["pk"], {}).get(R)
            if not d or not d["n"]:
                continue
            s[f"n{R}"] = d["n"]
            s[f"gen{R}"] = d["n_gen"] / d["n"]                  # 근생 비율
            s[f"la{R}"] = d["avg_la"]                           # 주변 평균 대지
            s[f"ta{R}"] = d["avg_ta"]
            # 이 땅이 주변보다 비싼가 — 구역 평균이 아니라 **반경 평균** 대비
            s[f"gr{R}"] = (bb["g"] / d["avg_g"]) if d["avg_g"] else None
        out.append(s)
    return out


AXES = {}
for _R in RADII:
    AXES[f"n{_R}"] = f"반경{_R}m 건물 수"
    AXES[f"gen{_R}"] = f"반경{_R}m 근생 비율"
    AXES[f"la{_R}"] = f"반경{_R}m 평균 대지"
    AXES[f"gr{_R}"] = f"반경{_R}m 공시지가 상대"


def train(tr, kr=0.4, axes=()):
    by = defaultdict(list)
    for s in tr:
        by[s["b"]].append(s)
    co = {k: fit_pow([x["g"] for x in v], [x["u"] for x in v])
          for k, v in by.items() if len(v) >= 150}
    co["_"] = fit_pow([x["g"] for x in tr], [x["u"] for x in tr])
    rr = [r for r in (rate_rel(s) for s in tr) if r]
    m = {"co": co, "rmed": st.median(rr) if rr else 1.0, "kr": kr,
         "age": None, "fuse": None, "muse": None, "q": {}}
    res = defaultdict(list)
    for s in tr:
        bd, p = band(s["age"]), _p(s, m)
        if bd is not None and p:
            res[bd].append(s["u"] / p)
    m["age"] = {k: st.median(v) for k, v in res.items() if len(v) >= 60}
    for key in ("fuse", "muse"):
        res = defaultdict(list)
        for s in tr:
            k, p = s.get(key), _p(s, m)
            if k and p:
                res[k].append(s["u"] / p)
        m[key] = {k: st.median(v) for k, v in res.items() if len(v) >= 60}
    for key in axes:
        v = [(s[key], s) for s in tr if s.get(key) is not None]
        v.sort(key=lambda t: t[0])
        if len(v) < 500:
            continue
        step = len(v) // 5
        cuts, coef = [], []
        for i in range(5):
            seg = v[i*step:(i+1)*step] if i < 4 else v[i*step:]
            if seg:
                cuts.append(seg[-1][0])
                r = [x["u"] / _p(x, m) for _, x in seg if _p(x, m)]
                coef.append(st.median(r) if r else 1.0)
        m["q"][key] = (cuts, coef)
    return m


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
    for key, (cuts, coef) in (m.get("q") or {}).items():
        x = s.get(key)
        if x is None:
            continue
        i = 0
        while i < len(cuts) - 1 and x > cuts[i]:
            i += 1
        p *= coef[i]
    return p


def main():
    rows = asyncio.run(load())
    gus = sorted({s["gu"] for s in rows})
    tr = [s for s in rows if gus.index(s["gu"]) % 2 == 0]
    te = [s for s in rows if gus.index(s["gu"]) % 2 == 1]
    print(f"표본 {len(rows):,} · 학습 {len(tr):,} · 검증 {len(te):,}\n")

    p1 = [(now_unit(s), s) for s in te]
    p1 = [(p, s) for p, s in p1 if p]
    k1 = st.median([s["u"] / p for p, s in p1])
    b0 = err([p * k1 / s["u"] for p, s in p1])
    print("[검증셋]")
    show("① 지금 산식", b0)
    m = train(tr)
    base = err([_p(s, m) / s["u"] for s in te])
    show("② 공시+상권수준+연식+용도", base, b0["mid"])

    print("\n[주변을 직접 재는 축 — 하나씩]")
    got = []
    for key, ko in AXES.items():
        mm = train(tr, axes=(key,))
        r = err([_p(s, mm) / s["u"] for s in te])
        show(f"  + {ko}", r, b0["mid"])
        if r and r["mid"] < base["mid"] - 0.15:
            got.append((r["mid"], key, ko))
    got.sort()

    if got:
        print(f"\n[도움이 된 축을 쌓는다] {len(got)}개")
        cur, sel = base["mid"], []
        for _, key, ko in got:
            trial = sel + [key]
            mm = train(tr, axes=tuple(trial))
            r = err([_p(s, mm) / s["u"] for s in te])
            keep = r and r["mid"] < cur - 0.05
            show(f"  {'+' if keep else '×'} {ko}", r, b0["mid"])
            if keep:
                sel, cur = trial, r["mid"]
        if sel:
            mm = train(tr, axes=tuple(sel))
            fin = err([_p(s, mm) / s["u"] for s in te])
            print(f"\n[최종] 지금 {b0['mid']:.1f}% → {fin['mid']:.1f}%"
                  f"  ({b0['mid']-fin['mid']:.1f}%p) · ±30% {fin['h30']:.1f}%")
            for key in sel:
                cuts, coef = mm["q"][key]
                print(f"\n  [{AXES[key]}]")
                prev = 0
                for cu, co in zip(cuts, coef):
                    print(f"    {prev:9,.1f} ~ {cu:9,.1f}   ×{co:.2f}")
                    prev = cu
    else:
        print("\n주변을 재는 축 중 도움이 되는 것이 없다.")


if __name__ == "__main__":
    main()
