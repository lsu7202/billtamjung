"""서울시 상권 폴리곤(1,650개)을 임대 산식에 넣는다(2026-08-29).

지금 산식은 부동산원 상권 **72칸**만 본다. 그래서 같은 상권 안 건물에 전부 같은 값을 매긴다.
실측(마포 망원동 486-39 / 486-1)에서 33m 떨어진 두 건물의 호가가 2.2배 갈렸는데,
우리 데이터로는 도로접면(둘 다 중로각지)·생활인구(같은 250m 격자)·공시지가(5% 차이)가
전부 사실상 같았다. 사람이 보면 갈린 이유가 분명했다 — **A는 망원시장 도로에 접하고 B는 아니다.**

새로 받은 데이터(master.trade_area)는 서울을 1,650칸으로 나누고 유형을 구분한다:
    전통시장 305 · 발달상권 249 · 골목상권 1,090 · 관광특구 6

다만 「구역 안인가」만으로는 부족했다 — 망원시장 폴리곤에 건물 134동이 들어가고
A·B 둘 다 안이다. 폴리곤이 시장 점포만이 아니라 주변 블록까지 덮기 때문이다.
그래서 **구역 안에서의 자리**까지 본다: 경계까지 거리(A 19m · B 8m — B가 가장자리),
구역 중심까지 거리, 그 구역의 건물 밀도.

    backend/.venv/bin/python scripts/rent_estimate/experiment_trade_area.py
"""
import asyncio
import math
import os
import statistics as st
from collections import defaultdict

import asyncpg
import rent_common as RC
from remeasure import (BAND_KO, band, bucket, err, fit_pow, now_unit, rate_rel,
                       show, ugroup, yrs)

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")


async def load():
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=1800)
    cr = await c.fetch("""
        SELECT building_pk pk, floor, count(*) ads,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY rent/area_c) u_c
          FROM master._crawl_clean GROUP BY 1,2 HAVING count(*) >= 2""")
    pks = list({r["pk"] for r in cr})
    print(f"  건물 {len(pks):,}동에 상권 폴리곤 붙이는 중…")
    b = await c.fetch(f"""
        SELECT b.building_pk pk, substr(b.bjd_code,1,5) gu, b.gongsi_latest::float g,
               b.approval_ymd, b.remodel_ymd, b.total_area::float ta, b.land_use lu,
               b.main_use mu, b.station_dist::float sd,
               b.elevator::float ev, b.parking::float pk_n,
               b.road_frontage rf, b.land_area::float la, b.floors_above::float fa,
               {RC.SANG_SQL} sang,
               ta1.kind ta_kind, ta1.code ta_code, ta1.area_m2 ta_area,
               ST_Distance(b.geom::geography, ST_Boundary(ta1.geom)::geography) ta_edge,
               ST_Distance(b.geom::geography, ST_Centroid(ta1.geom)::geography) ta_ctr,
               (SELECT count(*) FROM master.buildings x
                 WHERE ST_Contains(ta1.geom, x.geom)) ta_bldg
          FROM master.buildings b
          LEFT JOIN LATERAL (
            SELECT t.* FROM master.trade_area t
             WHERE ST_Contains(t.geom, b.geom)
             ORDER BY t.area_m2 ASC LIMIT 1) ta1 ON TRUE
         WHERE b.building_pk = ANY($1) AND b.gongsi_latest > 0""", pks)
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
        out.append({**bb, "floor": r["floor"], "b": bucket(r["floor"]),
                    "label": same[0]["floor"], "farea": area, "u": float(r["u_c"]),
                    "fuse": max(uses, key=uses.get) if uses else None,
                    "muse": str(bb["mu"] or "")[:2] or None, "age": age})
    return out


# 사용자가 짝을 눈으로 보고 짚은 축들(2026-08-29). 전부 우리가 이미 가진 값인데 산식이 안 쓴다.
#   20번 한강로3가 — 도로접면 등급은 둘 다 「광대로한면」인데 대지가 2,736㎡ vs 885㎡.
#     등급은 도로 **폭**만 말하고 **얼마나 길게 접했는지**를 안 담는다. 대지가 넓으면 접면도 길다.
#   8번 사당동 — 소로각지 vs 소로한면. 각지(모퉁이)는 두 면이 노출된다.
#   4번·12번 — 실제로는 고시원·빌라. 대장 용도(main_use)와 실물이 갈린다.
# 도로접면 등급을 점수로 — 폭(광대>중로>소로>세로)과 각지 여부를 나눠 본다.
ROAD_W = {"광대": 4, "중로": 3, "소로": 2, "세로": 1}


def road_score(rf):
    """(폭 등급, 각지인가) — '광대소각'·'중로각지'·'세로한면(가)' 같은 표기를 가른다."""
    s = str(rf or "")
    w = next((v for k, v in ROAD_W.items() if s.startswith(k)), None)
    if w is None:
        return None, None
    corner = ("각" in s)          # 각지·소각·세각 = 모퉁이
    return w, corner


def train(tr, kr=0.4, age=True, fuse=True, muse=True, ta=(), edge=False,
          road=False, land=False, luse=False):
    by = defaultdict(list)
    for s in tr:
        by[s["b"]].append(s)
    co = {k: fit_pow([x["g"] for x in v], [x["u"] for x in v])
          for k, v in by.items() if len(v) >= 150}
    co["_"] = fit_pow([x["g"] for x in tr], [x["u"] for x in tr])
    rr = [r for r in (rate_rel(s) for s in tr) if r]
    m = {"co": co, "rmed": st.median(rr) if rr else 1.0, "kr": kr,
         "age": None, "fuse": None, "muse": None, "ta": None, "edge": None,
         "road": None, "land": None, "luse": None}
    if age:
        res = defaultdict(list)
        for s in tr:
            bd, p = band(s["age"]), _p(s, m)
            if bd is not None and p:
                res[bd].append(s["u"] / p)
        m["age"] = {k: st.median(v) for k, v in res.items() if len(v) >= 60}
    for key, on in (("fuse", fuse), ("muse", muse)):
        if not on:
            continue
        res = defaultdict(list)
        for s in tr:
            k, p = s.get(key), _p(s, m)
            if k and p:
                res[k].append(s["u"] / p)
        m[key] = {k: st.median(v) for k, v in res.items() if len(v) >= 60}
    if ta:
        res = defaultdict(list)
        for s in tr:
            k, p = s.get("ta_kind") or "없음", _p(s, m)
            if p:
                res[k].append(s["u"] / p)
        m["ta"] = {k: st.median(v) for k, v in res.items() if len(v) >= 60}
    if road:
        res = defaultdict(list)
        for s in tr:
            w, cn = road_score(s.get("rf"))
            p = _p(s, m)
            if w is not None and p:
                res[(w, cn)].append(s["u"] / p)
        m["road"] = {k: st.median(v) for k, v in res.items() if len(v) >= 60}
    if land:
        v = [(s["la"], s) for s in tr if s.get("la")]
        v.sort(key=lambda t: t[0])
        if len(v) >= 500:
            step = len(v) // 5
            cuts, coef = [], []
            for i in range(5):
                seg = v[i*step:(i+1)*step] if i < 4 else v[i*step:]
                if seg:
                    cuts.append(seg[-1][0])
                    r = [x["u"] / _p(x, m) for _, x in seg if _p(x, m)]
                    coef.append(st.median(r) if r else 1.0)
            m["land"] = (cuts, coef)
    if luse:
        res = defaultdict(list)
        for s in tr:
            k, p = s.get("lu"), _p(s, m)
            if k and p:
                res[k].append(s["u"] / p)
        m["luse"] = {k: st.median(v) for k, v in res.items() if len(v) >= 60}
    if edge:
        # 구역 안에서의 자리 — 경계에 붙었나 안쪽인가. 망원동 짝이 이 축으로 갈렸다(19m vs 8m)
        v = [(s["ta_edge"], s) for s in tr if s.get("ta_edge") is not None]
        v.sort(key=lambda t: t[0])
        if len(v) >= 500:
            step = len(v) // 4
            cuts, coef = [], []
            for i in range(4):
                seg = v[i*step:(i+1)*step] if i < 3 else v[i*step:]
                if seg:
                    cuts.append(seg[-1][0])
                    r = [s["u"] / _p(s, m) for _, s in seg if _p(s, m)]
                    coef.append(st.median(r) if r else 1.0)
            m["edge"] = (cuts, coef)
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
    if m.get("ta"):
        k = s.get("ta_kind") or "없음"
        if k in m["ta"]:
            p *= m["ta"][k]
    if m.get("road"):
        w, cn = road_score(s.get("rf"))
        if (w, cn) in m["road"]:
            p *= m["road"][(w, cn)]
    if m.get("land") and s.get("la"):
        cuts, coef = m["land"]
        i = 0
        while i < len(cuts) - 1 and s["la"] > cuts[i]:
            i += 1
        p *= coef[i]
    if m.get("luse") and s.get("lu") in (m["luse"] or {}):
        p *= m["luse"][s["lu"]]
    if m.get("edge") and s.get("ta_edge") is not None:
        cuts, coef = m["edge"]
        i = 0
        while i < len(cuts) - 1 and s["ta_edge"] > cuts[i]:
            i += 1
        p *= coef[i]
    return p


def main():
    rows = asyncio.run(load())
    gus = sorted({s["gu"] for s in rows})
    tr = [s for s in rows if gus.index(s["gu"]) % 2 == 0]
    te = [s for s in rows if gus.index(s["gu"]) % 2 == 1]
    print(f"표본 {len(rows):,} · 학습 {len(tr):,} · 검증 {len(te):,}")
    cov = sum(1 for s in rows if s.get("ta_kind")) * 100 / len(rows)
    print(f"상권 폴리곤 안에 든 표본 {cov:.1f}%\n")

    print("[유형별 실제 단가] 어느 상권에 있느냐로 갈리나")
    g = defaultdict(list)
    for s in rows:
        g[s.get("ta_kind") or "없음"].append(s["u"])
    KO = {"R": "전통시장", "D": "발달상권", "A": "골목상권", "U": "관광특구", "없음": "상권 밖"}
    for k, v in sorted(g.items(), key=lambda t: -st.median(t[1])):
        if len(v) >= 50:
            print(f"  {KO.get(k,k):8s} n={len(v):5,}  ㎡당 중앙 {st.median(v):8,.0f}원")

    p1 = [(now_unit(s), s) for s in te]
    p1 = [(p, s) for p, s in p1 if p]
    k1 = st.median([s["u"] / p for p, s in p1])
    b0 = err([p * k1 / s["u"] for p, s in p1])
    print("\n[검증셋]")
    show("① 지금 산식", b0)
    m = train(tr)
    r2 = err([_p(s, m) / s["u"] for s in te])
    show("② 공시+상권수준+연식+용도", r2, b0["mid"])
    m3 = train(tr, ta=("kind",))
    show("③ + 상권 유형(전통시장 등)", err([_p(s, m3) / s["u"] for s in te]), b0["mid"])
    m4 = train(tr, ta=("kind",), edge=True)
    r4 = err([_p(s, m4) / s["u"] for s in te])
    show("④ + 구역 경계까지 거리", r4, b0["mid"])

    print("\n[사용자가 짝에서 짚은 축]")
    m5 = train(tr, road=True)
    show("⑤ + 도로접면(폭·각지)", err([_p(s, m5) / s["u"] for s in te]), b0["mid"])
    m6 = train(tr, road=True, land=True)
    show("⑥ + 대지면적(접면 길이 대신)", err([_p(s, m6) / s["u"] for s in te]), b0["mid"])
    m7 = train(tr, road=True, land=True, luse=True)
    r7 = err([_p(s, m7) / s["u"] for s in te])
    show("⑦ + 토지이용(주거·상업)", r7, b0["mid"])
    m8 = train(tr, road=True, land=True, luse=True, ta=("kind",), edge=True)
    show("⑧ + 상권 유형·경계거리", err([_p(s, m8) / s["u"] for s in te]), b0["mid"])

    if m7.get("road"):
        print("\n[도로접면 계수] 폭 4=광대 3=중로 2=소로 1=세로")
        for (w, cn), v in sorted(m7["road"].items(), key=lambda t: -t[1]):
            print(f"  폭{w} {'각지' if cn else '한면'}  ×{v:.2f}")
    if m7.get("land"):
        print("\n[대지면적 계수]")
        cuts, coef = m7["land"]
        prev = 0
        for cu, co in zip(cuts, coef):
            print(f"  {prev:6.0f} ~ {cu:6.0f}㎡  ×{co:.2f}")
            prev = cu
    if m7.get("luse"):
        print("\n[토지이용 계수]")
        for k, v in sorted(m7["luse"].items(), key=lambda t: -t[1]):
            print(f"  {k:8s} ×{v:.2f}")

    if m4.get("ta"):
        print("\n[상권 유형 계수]")
        for k, v in sorted(m4["ta"].items(), key=lambda t: -t[1]):
            print(f"  {KO.get(k,k):8s} ×{v:.2f}")
    if m4.get("edge"):
        print("\n[구역 경계까지 거리 계수] 가까울수록 가장자리")
        cuts, coef = m4["edge"]
        prev = 0
        for cu, co in zip(cuts, coef):
            print(f"  {prev:5.0f} ~ {cu:5.0f}m   ×{co:.2f}")
            prev = cu


if __name__ == "__main__":
    main()
