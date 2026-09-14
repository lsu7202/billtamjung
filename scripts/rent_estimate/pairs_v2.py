"""우리 산식은 같다는데 실제 호가는 다른 짝 — **계산 과정까지 펼쳐서**(2026-08-29).

show_raw.py 로 원본을 보니 앞서 뽑은 짝들이 부실했다:
  · 보증금·월세·면적이 **똑같은 중복 매물**을 2건으로 세고 있었다(같은 물건 재등록)
  · 한 층 안에서 매물끼리 2.5배 벌어지는데 그 중앙값을 「이 층의 값」이라 단정했다

그래서 잣대를 먼저 고친다:
  ① 중복 제거 — (보증금, 월세, 계약면적, 전용면적)이 같으면 한 건으로 센다
  ② 서로 다른 매물이 **2건 이상** 남은 층만 쓴다
  ③ 그 층 매물끼리 최고÷최저가 `--spread`(기본 1.6) 넘으면 그 층은 버린다
     — 무엇이 맞는지 모르는 층을 잣대로 쓸 수 없다

그 위에 조건을 맞추고, **우리 산식이 그 값을 어떻게 계산했는지 한 줄씩 펼친다.**
그래야 「우리는 같다고 보는데 시장은 다르다」가 눈으로 확인된다.

    backend/.venv/bin/python scripts/rent_estimate/pairs_v2.py --n 6
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
_R = 6371008.8


def dist(a, b):
    x = math.radians(b["lng"] - a["lng"]) * math.cos(math.radians((a["lat"] + b["lat"]) * 0.5))
    y = math.radians(b["lat"] - a["lat"])
    return _R * math.hypot(x, y)


async def load(spread):
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=1800)
    # ① 중복 제거 — 값이 완전히 같은 매물은 한 건
    ads = await c.fetch("""
        SELECT DISTINCT building_pk pk, floor, deposit, rent, area_c, area_e
          FROM master._crawl_rent
         WHERE building_pk IS NOT NULL AND floor IS NOT NULL
           AND area_e > 0 AND rent > 0""")
    G = defaultdict(list)
    for r in ads:
        G[(r["pk"], r["floor"])].append(
            {"dep": float(r["deposit"] or 0), "rent": float(r["rent"]),
             "ac": float(r["area_c"] or 0), "ae": float(r["area_e"]),
             "ue": float(r["rent"]) / float(r["area_e"])})
    keep = {}
    for k, v in G.items():
        if len(v) < 2:                      # ② 서로 다른 매물 2건 이상
            continue
        u = [x["ue"] for x in v]
        if max(u) / min(u) > spread:        # ③ 층 안이 벌어지면 버린다
            continue
        keep[k] = v

    pks = list({k[0] for k in keep})
    b = await c.fetch("""
        SELECT b.building_pk pk, b.addr, b.gongsi_latest::float g, b.approval_ymd,
               b.remodel_ymd, b.total_area::float ta, b.land_area::float la,
               b.floors_above::float fa, b.floors_below::float fb, b.elevator::float ev,
               b.parking::float pkn, b.road_frontage rf, b.use_zone uz, b.main_use mu,
               b.land_use lu, b.station_dist::float sd,
               ST_X(b.geom) lng, ST_Y(b.geom) lat,
               pp.day_avg::float dpop, pp.night_avg::float npop,
               """ + RC.SANG_SQL + """ sang
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
    # 건물별 계열(빌더와 같은 규칙)
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
        lab = next((r["floor"] for r in bb["_fl"] if RC.signed_floor(r["floor"]) == fl), None)
        use = next((r["use"] for r in bb["_fl"] if RC.signed_floor(r["floor"]) == fl), None)
        area = sum(r["a"] or 0 for r in bb["_fl"]
                   if RC.signed_floor(r["floor"]) == fl
                   and not any(k in (r["use"] or "") for k in RC.EXCL))
        if not lab or area <= 0:
            continue
        out.append({**bb, "floor": fl, "label": lab, "fuse": use, "farea": area,
                    "ads": v, "ue": st.median([x["ue"] for x in v]),
                    "ae": st.median([x["ae"] for x in v])})
    return out


def calc(s):
    """우리 산식이 이 층 임대료를 만드는 과정 — 단계별 값."""
    rate, mapped = RC.rate_for(s["series"], s["sang"])
    steps = []
    steps.append(("계열 판정", s["series"],
                  f"연면적 {s['ta'] or 0:,.0f}㎡ · 토지이용 {s['lu'] or '—'}"))
    steps.append(("상권", s["sang"] or "(못 찾음)",
                  "상권 요율 사용" if mapped else "서울 평균으로 대체"))
    if not rate:
        return steps, None
    rt = RC.pick_rate(s["series"], s["label"], rate)
    steps.append((f"{s['label']} 요율", f"{rt:,.1f} 천원/㎡" if rt else "—",
                  "부동산원 임대동향조사 표"))
    if not rt:
        return steps, None
    adj = RC.market_adj(s["label"])
    steps.append(("층 호가보정", f"×{adj:.2f}", "공공 실계약 → 시장 호가 정렬"))
    steps.append(("임대가능면적비", f"×{RC.EFF_RATIO:.2f}", "코어·복도 제외"))
    steps.append(("그 층 대장면적", f"{s['farea']:,.1f}㎡", "floor_outline 합계"))
    rent = rt * 1000 * s["farea"] * RC.EFF_RATIO * adj
    steps.append(("→ 우리 추정 월세", f"{rent/1e4:,.0f}만원",
                  f"= {rt:,.1f}천원 × {s['farea']:,.0f}㎡ × {RC.EFF_RATIO} × {adj:.2f}"))
    unit = rt * 1000 * RC.EFF_RATIO * adj
    steps.append(("→ 우리 추정 ㎡당", f"{unit:,.0f}원", ""))
    return steps, unit


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=6)
    ap.add_argument("--gap", type=float, default=2.0, help="실제 호가 배율 하한")
    ap.add_argument("--spread", type=float, default=1.6, help="층 안 매물 편차 상한")
    ap.add_argument("--radius", type=float, default=300.0)
    a = ap.parse_args()
    rows = asyncio.run(load(a.spread))
    print(f"잣대로 쓸 수 있는 (건물,층) {len(rows):,}개")
    print(f"  — 중복 제거 후 서로 다른 매물 2건 이상 · 층 안 편차 {a.spread}배 이내\n")

    cell = 300
    g = defaultdict(list)
    for r in rows:
        gx = int(r["lng"] * 111320 * math.cos(math.radians(r["lat"])) / cell)
        gy = int(r["lat"] * 111320 / cell)
        r["_g"] = (gx, gy)
        g[(gx, gy)].append(r)

    pairs, seen = [], set()
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
                    if d > a.radius:
                        continue
                    # 우리 산식이 같은 값을 매기는가 — 계산해서 확인한다
                    _, u1 = calc(t)
                    _, u2 = calc(c)
                    if not u1 or not u2:
                        continue
                    if not (0.9 <= u1 / u2 <= 1.11):     # 우리 추정 단가가 ±10% 안
                        continue
                    if not (0.7 <= t["ae"] / c["ae"] <= 1.43):   # 매물 크기도 비슷
                        continue
                    hi, lo = (t, c) if t["ue"] >= c["ue"] else (c, t)
                    if hi["ue"] / lo["ue"] < a.gap:
                        continue
                    seen.add(key)
                    pairs.append((hi["ue"] / lo["ue"], d, hi, lo))
    pairs.sort(key=lambda x: -x[0])
    print(f"우리 산식은 ±10% 안(사실상 같다)인데 실제 호가가 {a.gap}배 이상 갈리는 짝"
          f" {len(pairs):,}개 · 위에서 {a.n}개\n")

    for i, (ratio, d, hi, lo) in enumerate(pairs[:a.n], 1):
        fl = hi["floor"]
        fl_ko = f"지하{-fl}층" if fl < 0 else f"{fl}층"
        print("━" * 78)
        print(f"{i}.  {fl_ko} · 두 건물 {d:.0f}m 떨어짐 · 실제 호가 {ratio:.2f}배 차이")
        print("━" * 78)
        for tag, s in (("A", hi), ("B", lo)):
            print(f"\n[{tag}] {s['addr'].replace('서울특별시 ', '')}")
            print(f"    (지도에서 찾을 주소 — building_pk {s['pk']})")
            print(f"\n    ── 우리 산식이 계산한 과정 ──")
            steps, _ = calc(s)
            for k, v, note in steps:
                print(f"      {k:14s} {v:>18s}   {note}")
            print(f"\n    ── 네이버 실제 호가 {len(s['ads'])}건 ──")
            for x in sorted(s["ads"], key=lambda z: z["rent"]):
                print(f"      보증금 {x['dep']/1e4:>7,.0f}만 · 월세 {x['rent']/1e4:>6,.0f}만"
                      f" · 계약 {x['ac']:>6,.1f}㎡ · 전용 {x['ae']:>6,.1f}㎡"
                      f" → 전용㎡당 {x['ue']:>9,.0f}원")
            print(f"      → 중앙 {s['ue']:,.0f}원/㎡(전용)")
            print(f"\n    ── 우리가 아는 이 건물 ──")
            print(f"      공시지가 {s['g']/1e4:,.0f}만/㎡ · 사용승인 {str(s['approval_ymd'] or '—')[:7]}"
                  f" · 대수선 {str(s['remodel_ymd'] or '—')[:7]}")
            print(f"      연면적 {s['ta'] or 0:,.0f}㎡ · 지상{s['fa'] or 0:.0f}/지하{s['fb'] or 0:.0f}층"
                  f" · 엘리베이터 {s['ev'] if s['ev'] is not None else '—'}"
                  f" · 주차 {s['pkn'] if s['pkn'] is not None else '—'}")
            print(f"      도로 {s['rf'] or '—'} · 용도지역 {s['uz'] or '—'}"
                  f" · 역 {s['sd'] or 0:.0f}m · 그 층 용도 {s['fuse'] or '—'}")
            print(f"      낮/밤 생활인구 {s['dpop'] or 0:,.0f}/{s['npop'] or 0:,.0f}")
        print()
        print(f"  ▶ 우리는 두 건물에 거의 같은 값을 매겼는데, 시장은 {ratio:.1f}배로 갈랐다.")
        print(f"    지도에서 볼 것: 대로변인가 골목인가 · 코너인가 · 1층 노출 · 주변 업종")
        print()


if __name__ == "__main__":
    main()
