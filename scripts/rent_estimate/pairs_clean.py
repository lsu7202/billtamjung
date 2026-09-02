"""같은 조건인데 실제로는 다른 짝 — 계산식과 함께(2026-08-29).

깨끗한 잣대(master._crawl_clean)로 다시 뽑는다. 앞서 뽑은 짝들은 좌표 스냅이 틀리고
중복 매물이 섞여서 근거로 쓸 수 없었다.

거르는 규칙:
  · 주소로 붙은 매물만 · 대장에 있는 층만 · 중복 제거(_crawl_clean 이 이미 함)
  · 한 층에 **서로 다른 매물 2건 이상**, 그 매물끼리 편차 1.5배 이내
    — 무엇이 맞는지 모르는 층은 잣대로 못 쓴다
  · 전용면적 기준으로 비교 — 계약면적은 대지지분·공용부를 얹는 관행이 있어 뜻이 갈린다

맞추는 조건(우리가 아는 것 전부):
  거리 300m · 같은 층 · 공시지가 ±12% · 전용면적 ±30% · 유효연식 ±6년 · 같은 층 용도

그리고 **우리 산식이 실제로 두 건물에 같은 값을 매기는지 계산해서 확인한다.**
±10% 안이면 「우리 눈엔 같은 건물」이다. 그런데 실제 호가가 2배 이상 갈리는 것만 남긴다.

    backend/.venv/bin/python scripts/rent_estimate/pairs_clean.py --n 6
"""
import argparse
import asyncio
import math
import os
import statistics as st
from collections import defaultdict

import asyncpg
import rent_common as RC
from remeasure import bucket, ugroup, yrs

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")
_R = 6371008.8


def dist(a, b):
    x = math.radians(b["lng"] - a["lng"]) * math.cos(math.radians((a["lat"] + b["lat"]) * 0.5))
    y = math.radians(b["lat"] - a["lat"])
    return _R * math.hypot(x, y)


async def load(spread):
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=1800)
    ads = await c.fetch("""
        SELECT building_pk pk, floor, no, deposit, rent, area_c, area_e
          FROM master._crawl_clean WHERE area_e > 0""")
    G = defaultdict(list)
    for r in ads:
        G[(r["pk"], r["floor"])].append(
            {"no": r["no"], "dep": float(r["deposit"] or 0), "rent": float(r["rent"]),
             "ac": float(r["area_c"] or 0), "ae": float(r["area_e"]),
             "ue": float(r["rent"]) / float(r["area_e"])})
    keep = {}
    for k, v in G.items():
        if len(v) < 2:
            continue
        u = [x["ue"] for x in v]
        if max(u) / min(u) > spread:
            continue
        keep[k] = v

    pks = list({k[0] for k in keep})
    b = await c.fetch(f"""
        SELECT b.building_pk pk, b.addr, b.gongsi_latest::float g, b.approval_ymd,
               b.remodel_ymd, b.total_area::float ta, b.land_area::float la,
               b.floors_above::float fa, b.floors_below::float fb, b.elevator::float ev,
               b.parking::float pkn, b.road_frontage rf, b.use_zone uz, b.main_use mu,
               b.land_use lu, b.station_dist::float sd, b.structure stru,
               ST_X(b.geom) lng, ST_Y(b.geom) lat,
               pp.day_avg::float dpop, pp.night_avg::float npop, {RC.SANG_SQL} sang
          FROM master.buildings b
          LEFT JOIN master.building_pop pp ON pp.building_pk = b.building_pk
         WHERE b.building_pk = ANY($1) AND b.geom IS NOT NULL AND b.gongsi_latest > 0""", pks)
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
    for (pk, fl), v in keep.items():
        bb = B.get(pk)
        if not bb or "_fl" not in bb:
            continue
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
        ap, rm = yrs(bb["approval_ymd"]), yrs(bb["remodel_ymd"])
        age = min(ap, rm + 5) if (ap is not None and rm is not None) \
            else (rm + 5 if rm is not None else ap)
        out.append({**bb, "floor": fl, "b": bucket(fl), "label": same[0]["floor"],
                    "farea": area, "ads": v, "age": age,
                    "fuse": max(uses, key=uses.get) if uses else None,
                    "ue": st.median([x["ue"] for x in v]),
                    "ae": st.median([x["ae"] for x in v])})
    return out


def calc(s):
    """우리 산식이 이 층 임대료를 만드는 과정 — 단계별로 펼친다."""
    rate, mapped = RC.rate_for(s["series"], s["sang"])
    steps = [("계열", s["series"], f"연면적 {s['ta'] or 0:,.0f}㎡ · 토지이용 {s['lu'] or '—'}"),
             ("상권", s["sang"] or "(못 찾음)",
              "상권 요율 사용" if mapped else "서울 평균으로 대체")]
    if not rate:
        return steps, None, None
    rt = RC.pick_rate(s["series"], s["label"], rate)
    if not rt:
        return steps, None, None
    adj = RC.market_adj(s["label"])
    unit = rt * 1000 * RC.EFF_RATIO * adj
    rent = unit * s["farea"]
    steps += [(f"{s['label']} 요율", f"{rt:,.1f} 천원/㎡", "부동산원 임대동향조사 표"),
              ("층 호가보정", f"×{adj:.2f}", "공공 실계약 → 시장 호가"),
              ("임대가능면적비", f"×{RC.EFF_RATIO:.2f}", "코어·복도 제외"),
              ("→ ㎡당 단가", f"{unit:,.0f}원", "**여기까지가 단가. 건물은 안 봤다**"),
              ("그 층 대장면적", f"{s['farea']:,.1f}㎡", "floor_outline 합계"),
              ("→ 우리 추정 월세", f"{rent/1e4:,.0f}만원",
               f"{unit:,.0f}원 × {s['farea']:,.0f}㎡")]
    return steps, unit, rent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=6)
    ap.add_argument("--gap", type=float, default=2.0)
    ap.add_argument("--spread", type=float, default=1.5)
    ap.add_argument("--radius", type=float, default=300.0)
    a = ap.parse_args()
    rows = asyncio.run(load(a.spread))
    print(f"잣대로 쓸 수 있는 (건물,층) {len(rows):,}개")
    print(f"  — 주소로 붙음 · 대장에 있는 층 · 서로 다른 매물 2건 이상 · 층 안 편차 {a.spread}배 이내\n")

    cell = 300
    g = defaultdict(list)
    for r in rows:
        gx = int(r["lng"] * 111320 * math.cos(math.radians(r["lat"])) / cell)
        gy = int(r["lat"] * 111320 / cell)
        r["_g"] = (gx, gy)
        g[(gx, gy)].append(r)

    pairs, seen, used = [], set(), set()
    for t in rows:
        gx, gy = t["_g"]
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for c in g.get((gx + dx, gy + dy), []):
                    if c["pk"] == t["pk"] or c["floor"] != t["floor"]:
                        continue
                    key = tuple(sorted([t["pk"], c["pk"]])) + (t["floor"],)
                    if key in seen:
                        continue
                    d = dist(t, c)
                    if d > a.radius or not (0.88 <= t["g"] / c["g"] <= 1.12):
                        continue
                    if not (0.7 <= t["ae"] / c["ae"] <= 1.43):
                        continue
                    if t["age"] is None or c["age"] is None or abs(t["age"] - c["age"]) > 6:
                        continue
                    if t["fuse"] != c["fuse"]:
                        continue
                    _, u1, _ = calc(t)
                    _, u2, _ = calc(c)
                    if not u1 or not u2 or not (0.9 <= u1 / u2 <= 1.11):
                        continue
                    hi, lo = (t, c) if t["ue"] >= c["ue"] else (c, t)
                    if hi["ue"] / lo["ue"] < a.gap:
                        continue
                    seen.add(key)
                    pairs.append((hi["ue"] / lo["ue"], d, hi, lo))
    pairs.sort(key=lambda x: -x[0])
    print(f"우리 산식은 ±10% 안(사실상 같은 값)인데 실제 호가가 {a.gap}배 이상 갈리는 짝"
          f" {len(pairs):,}개\n")

    shown = 0
    for ratio, d, hi, lo in pairs:
        # 한 건물이 목록을 채우지 않게 — 건물당 한 번만
        if hi["pk"] in used or lo["pk"] in used:
            continue
        used.add(hi["pk"]); used.add(lo["pk"])
        shown += 1
        fl = hi["floor"]
        fl_ko = f"지하{-fl}층" if fl < 0 else f"{fl}층"
        print("━" * 76)
        print(f"{shown}.  {fl_ko} · {d:.0f}m 떨어짐 · 실제 호가 {ratio:.2f}배 차이")
        print("━" * 76)
        for tag, s in (("A 비싼 쪽", hi), ("B 싼 쪽", lo)):
            print(f"\n[{tag}] {s['addr'].replace('서울특별시 ', '')}")
            steps, unit, rent = calc(s)
            for k, v, note in steps:
                print(f"     {k:14s} {v:>16s}   {note}")
            print(f"\n     ── 실제 네이버 호가 {len(s['ads'])}건 ──")
            for x in sorted(s["ads"], key=lambda z: z["rent"]):
                print(f"       보증금 {x['dep']/1e4:>7,.0f}만 · 월세 {x['rent']/1e4:>6,.0f}만"
                      f" · 전용 {x['ae']:>6,.1f}㎡ → 전용㎡당 {x['ue']:>9,.0f}원")
            print(f"     ── 우리가 아는 이 건물 ──")
            print(f"       공시지가 {s['g']/1e4:,.0f}만/㎡ · 연식 {s['age']}년"
                  f"(승인 {str(s['approval_ymd'] or '—')[:6]} · 대수선 {str(s['remodel_ymd'] or '—')[:6]})")
            print(f"       연면적 {s['ta'] or 0:,.0f}㎡ · 지상{s['fa'] or 0:.0f}/지하{s['fb'] or 0:.0f}"
                  f" · 엘리베이터 {s['ev'] if s['ev'] is not None else '없음'}"
                  f" · 주차 {s['pkn'] if s['pkn'] is not None else '없음'}")
            print(f"       도로 {s['rf'] or '—'} · 용도지역 {s['uz'] or '—'} · 역 {s['sd'] or 0:.0f}m"
                  f" · 층용도 {s['fuse'] or '—'}")
            print(f"       낮/밤 인구 {s['dpop'] or 0:,.0f}/{s['npop'] or 0:,.0f}")
        _, uh, _ = calc(hi)
        _, ul, _ = calc(lo)
        print(f"\n  ▶ 우리 단가: A {uh:,.0f}원 · B {ul:,.0f}원  (거의 같다)")
        print(f"    실제 호가: A {hi['ue']:,.0f}원 · B {lo['ue']:,.0f}원  ({ratio:.1f}배)")
        print()
        if shown >= a.n:
            break


if __name__ == "__main__":
    main()
