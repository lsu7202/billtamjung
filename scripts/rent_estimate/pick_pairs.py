"""조건이 같은데 값이 다른 건물 쌍을 뽑는다(2026-08-29).

남은 오차의 정체를 눈으로 보려고, **우리가 아는 조건은 전부 맞추고** 값만 갈리는
짝을 골라 낸다. 맞추는 조건:

    거리 250m 이내 · 같은 층 · 공시지가 ±12% · 계약면적 ±25%
    · 연식 ±6년 · 같은 층 용도

여기까지 같으면 우리 산식은 두 건물에 **거의 같은 값**을 매긴다. 그런데 실제 호가가
1.8배 이상 갈리는 짝만 남긴다. 그 차이가 곧 우리가 못 보는 것이다.

노이즈 방어: 한쪽에 매물이 하나뿐이면 잘못 올린 매물일 수 있으니 **양쪽 다 2건 이상**인
층만 쓰고, 층 단가는 그 층 매물들의 중앙값으로 잡는다.

    backend/.venv/bin/python scripts/rent_estimate/pick_pairs.py
    backend/.venv/bin/python scripts/rent_estimate/pick_pairs.py --n 12 --gap 2.0
"""
import argparse
import asyncio
import math
import os
import statistics as st
from collections import defaultdict

import asyncpg

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")
_R = 6371008.8


def dist(a, b):
    x = math.radians(b["lng"] - a["lng"]) * math.cos(math.radians((a["lat"] + b["lat"]) * 0.5))
    y = math.radians(b["lat"] - a["lat"])
    return _R * math.hypot(x, y)


USE_KEYS = [("의료", ["의료", "병원", "의원", "치과", "한의"]),
            ("음식", ["음식", "제과"]), ("판매", ["판매", "소매", "상점", "슈퍼"]),
            ("업무", ["사무", "업무", "오피스"]), ("교육", ["학원", "교육"]),
            ("숙박", ["숙박", "호텔"]), ("근생", ["근린생활"]),
            ("주거", ["주택", "주거", "오피스텔"]), ("창고", ["창고", "공장"])]


def ugroup(u):
    u = str(u or "")
    for k, keys in USE_KEYS:
        if any(x in u for x in keys):
            return k
    return "기타"


async def load():
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=1800)
    cr = await c.fetch("""
        SELECT cr.building_pk pk, cr.floor,
               count(*) ads,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY cr.rent/cr.area_c) unit,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY cr.area_c) area,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY cr.area_e) area_e,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY cr.rent) rent,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY cr.deposit) dep,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY cr.area_e/NULLIF(cr.area_c,0)) eff
          FROM master._crawl_rent cr
         WHERE cr.building_pk IS NOT NULL AND cr.floor IS NOT NULL
           AND cr.rent/cr.area_c BETWEEN 3000 AND 400000
         GROUP BY 1,2 HAVING count(*) >= 2""")
    pks = list({r["pk"] for r in cr})
    b = await c.fetch("""
        SELECT b.building_pk pk, b.addr, b.gongsi_latest::float g, b.approval_ymd,
               b.remodel_ymd, b.total_area::float ta, b.land_area::float la,
               b.floors_above::float fa, b.floors_below::float fb, b.elevator::float ev,
               b.parking::float pk_n, b.road_frontage rf, b.use_zone uz, b.main_use mu,
               b.station_dist::float sd, b.structure stru,
               ST_X(b.geom) lng, ST_Y(b.geom) lat,
               pp.day_avg::float dpop, pp.night_avg::float npop
          FROM master.buildings b
          LEFT JOIN master.building_pop pp ON pp.building_pk = b.building_pk
         WHERE b.building_pk = ANY($1) AND b.geom IS NOT NULL AND b.gongsi_latest > 0""", pks)
    fo = await c.fetch("SELECT building_pk pk, floor, use, floor_area::float a"
                       "  FROM master.floor_outline WHERE building_pk = ANY($1)", pks)
    await c.close()

    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from rent_common import signed_floor
    B = {r["pk"]: dict(r) for r in b}
    FU, FA = defaultdict(lambda: defaultdict(float)), defaultdict(float)
    for r in fo:
        n = signed_floor(r["floor"])
        if n is not None and r["a"]:
            FU[(r["pk"], n)][ugroup(r["use"])] += r["a"]
            FA[(r["pk"], n)] += r["a"]
    out = []
    for r in cr:
        bb = B.get(r["pk"])
        if not bb:
            continue
        u = FU.get((r["pk"], r["floor"]))
        ae = r["area_e"] and float(r["area_e"])
        out.append({**bb, "floor": r["floor"], "ads": r["ads"],
                    "unit": float(r["unit"]), "area": float(r["area"]),
                    "area_e": ae,
                    # 전용면적 기준 단가 — 계약면적은 대지지분·공용부를 얹는 관행이 있어
                    # 같은 뜻의 값이 아니다. 실제로 쓰는 면적이 비교의 바탕이다.
                    "unit_e": (float(r["rent"]) / ae) if ae else None,
                    "rent": float(r["rent"]), "dep": float(r["dep"] or 0),
                    "eff": r["eff"] and float(r["eff"]),
                    "fuse": max(u, key=u.get) if u else None,
                    "farea": FA.get((r["pk"], r["floor"]))})
    return out


def yr(v):
    s = str(v or "")[:4]
    return int(s) if s.isdigit() else None


def fmt(x, n=0, unit=""):
    return "—" if x is None else f"{x:,.{n}f}{unit}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=10)
    ap.add_argument("--gap", type=float, default=1.8, help="단가 배율 하한")
    ap.add_argument("--radius", type=float, default=250.0)
    a = ap.parse_args()
    rows = asyncio.run(load())
    print(f"후보 {len(rows):,}(건물×층, 매물 2건 이상)\n")

    # 격자로 후보 좁히기
    cell = 250
    g = defaultdict(list)
    for r in rows:
        gx = int(r["lng"] * 111320 * math.cos(math.radians(r["lat"])) / cell)
        gy = int(r["lat"] * 111320 / cell)
        r["_g"] = (gx, gy)
        g[(gx, gy)].append(r)

    pairs = []
    seen = set()
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
                    # 조건 맞추기
                    if not (0.88 <= t["g"] / c["g"] <= 1.12):
                        continue
                    if not (t.get("area_e") and c.get("area_e")):
                        continue
                    if not (0.75 <= t["area_e"] / c["area_e"] <= 1.33):
                        continue
                    if not (t.get("unit_e") and c.get("unit_e")):
                        continue
                    y1, y2 = yr(t["approval_ymd"]), yr(c["approval_ymd"])
                    if y1 is None or y2 is None or abs(y1 - y2) > 6:
                        continue
                    if t["fuse"] != c["fuse"]:
                        continue
                    hi, lo = (t, c) if t["unit_e"] >= c["unit_e"] else (c, t)
                    if hi["unit_e"] / lo["unit_e"] < a.gap:
                        continue
                    seen.add(key)
                    pairs.append((hi["unit_e"] / lo["unit_e"], d, hi, lo))
    pairs.sort(key=lambda x: -x[0])
    print(f"조건이 같은데 {a.gap}배 이상 갈리는 짝 {len(pairs):,}개 · 위에서 {a.n}개\n")

    def row(lab, f, u=""):
        h, l = f(P[2]), f(P[3])
        print(f"  {lab:12s} {str(h):>22s}   {str(l):>22s}")

    for i, P in enumerate(pairs[:a.n], 1):
        ratio, d, hi, lo = P
        fl = hi["floor"]
        fl_ko = f"지하{-fl}층" if fl < 0 else f"{fl}층"
        print(f"━━ {i}. {fl_ko} · {d:.0f}m 떨어짐 · 단가 {ratio:.2f}배 차이 "
              f"━━━━━━━━━━━━━━━━━━━")
        print(f"  {'':12s} {'▲ 비싼 쪽':>22s}   {'▼ 싼 쪽':>22s}")
        row("주소", lambda x: x["addr"].replace("서울특별시 ", ""))
        row("전용㎡당 월세", lambda x: f"{x['unit_e']:,.0f}원")
        row("계약㎡당 월세", lambda x: f"{x['unit']:,.0f}원")
        row("월세/보증금", lambda x: f"{x['rent']/1e4:,.0f}/{x['dep']/1e4:,.0f}만")
        row("매물 수", lambda x: f"{x['ads']}건")
        print("  ── 맞춘 조건 ──")
        row("공시지가", lambda x: f"{x['g']/1e4:,.0f}만원/㎡")
        row("전용면적", lambda x: f"{x['area_e']:,.0f}㎡")
        row("계약면적", lambda x: f"{x['area']:,.0f}㎡")
        row("사용승인", lambda x: str(x["approval_ymd"] or "—")[:6])
        row("층 용도", lambda x: x["fuse"] or "—")
        print("  ── 안 맞춘 것(여기에 답이 있을 수 있다) ──")
        row("대수선", lambda x: str(x["remodel_ymd"] or "—")[:6])
        row("연면적", lambda x: f"{x['ta']:,.0f}㎡" if x["ta"] else "—")
        row("층수", lambda x: f"지상{x['fa']:.0f}/지하{x['fb']:.0f}" if x["fa"] is not None else "—")
        row("그 층 대장면적", lambda x: f"{x['farea']:,.0f}㎡" if x["farea"] else "—")
        row("전용률", lambda x: f"{x['eff']:.2f}" if x["eff"] else "—")
        row("엘리베이터", lambda x: f"{x['ev']:.0f}대" if x["ev"] is not None else "—")
        row("주차", lambda x: f"{x['pk_n']:.0f}대" if x["pk_n"] is not None else "—")
        row("도로접면", lambda x: x["rf"] or "—")
        row("용도지역", lambda x: x["uz"] or "—")
        row("주용도", lambda x: str(x["mu"] or "—"))
        row("역거리", lambda x: f"{x['sd']:.0f}m" if x["sd"] is not None else "—")
        row("낮/밤인구", lambda x: f"{x['dpop']:,.0f}/{x['npop']:,.0f}"
            if x.get("dpop") and x.get("npop") else "—")
        print()


if __name__ == "__main__":
    main()
