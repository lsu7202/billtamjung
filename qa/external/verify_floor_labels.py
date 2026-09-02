"""층 표기 정규화 검증 — 대장 층수와 맞는지 대조(2026-08-29).

0031(층 표기 통일)이 적용됐다고 기록엔 있는데 실제 값은 하나도 안 바뀌어 있었다.
마이그레이션은 스키마(floor_raw 칸)만 만들고, 값 변환은
scripts/normalize_floor_labels.py 가 하도록 되어 있는데 **그게 안 돌았다.**

그래서 지금 DB는 지하를 다섯 가지로 부른다:
    지1층 138,579 · 지1 131,727 · 지층 99,941 · 지하1층 52,683 · 지하층 21,327
읽는 함수(app.signed_floor·rent_common.signed_floor)는 「지하」 두 글자만 찾으므로
앞의 셋(37만건)이 **지상으로 뒤집혀 읽힌다.**

돌리기 전에 검증한다 — **정규화 결과가 대장 층수(floors_above·floors_below)와 맞는가.**
층별개요에서 센 지상·지하 층수가 대장 요약과 같아야 한다. 지금 것과 고친 것을 나란히 잰다.

    backend/.venv/bin/python scripts/verify_floor_labels.py
"""
import asyncio
import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "tools"))
import asyncpg  # noqa: E402
from floor_label import normalize, signed  # noqa: E402

DSN = os.environ.get("BT_DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")


def now_signed(fl):
    """지금 쓰는 파싱(rent_common.signed_floor 와 같다) — 「지하」만 지하로 본다."""
    if not fl:
        return None
    s = str(fl)
    if "지하" in s or s.strip().upper().startswith("B"):
        n = re.sub(r"\D", "", s)
        return -int(n) if n else -1
    n = re.sub(r"\D", "", s)
    return int(n) if n else None


async def main():
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=1800)

    print("[1] 표기 종류")
    raws = [r["floor_raw"] for r in await c.fetch(
        "SELECT DISTINCT floor_raw FROM master.floor_outline WHERE floor_raw IS NOT NULL")]
    kinds = defaultdict(int)
    change = 0
    for r in raws:
        lb, k = normalize(r)
        kinds[k] += 1
        if lb and lb != r:
            change += 1
    print(f"  원본 표기 {len(raws):,}종 · 바뀔 것 {change:,}종")
    print(f"  종류별 {dict(kinds)}")

    print("\n[2] 대장 층수와 대조 — 층별개요에서 센 층수가 대장 요약과 맞나")
    rows = await c.fetch("""
        SELECT fo.building_pk pk, fo.floor_raw,
               b.floors_above::int fa, b.floors_below::int fb
          FROM master.floor_outline fo
          JOIN master.buildings b USING (building_pk)
         WHERE b.floors_above IS NOT NULL AND b.floors_below IS NOT NULL
           AND fo.floor_raw IS NOT NULL""")
    G = defaultdict(lambda: {"now_up": set(), "now_dn": set(),
                             "new_up": set(), "new_dn": set(), "fa": 0, "fb": 0})
    for r in rows:
        g = G[r["pk"]]
        g["fa"], g["fb"] = r["fa"], r["fb"]
        s1 = now_signed(r["floor_raw"])
        if s1 is not None and abs(s1) < 200:
            (g["now_up"] if s1 > 0 else g["now_dn"]).add(abs(s1))
        s2 = signed(r["floor_raw"])
        if s2 is not None and abs(s2) < 200:
            (g["new_up"] if s2 > 0 else g["new_dn"]).add(abs(s2))
    print(f"  건물 {len(G):,}동")

    def score(up_key, dn_key):
        ok_up = ok_dn = ok_both = 0
        for g in G.values():
            u = max(g[up_key]) if g[up_key] else 0
            d = max(g[dn_key]) if g[dn_key] else 0
            a = (u == g["fa"])
            b = (d == g["fb"])
            ok_up += a; ok_dn += b; ok_both += (a and b)
        n = len(G)
        return ok_up * 100 / n, ok_dn * 100 / n, ok_both * 100 / n

    n1 = score("now_up", "now_dn")
    n2 = score("new_up", "new_dn")
    print(f"\n  {'':14s} {'지상층수 일치':>12s} {'지하층수 일치':>12s} {'둘 다 일치':>12s}")
    print(f"  {'지금 파싱':14s} {n1[0]:11.1f}% {n1[1]:11.1f}% {n1[2]:11.1f}%")
    print(f"  {'정규화 후':14s} {n2[0]:11.1f}% {n2[1]:11.1f}% {n2[2]:11.1f}%")
    print(f"  {'차이':14s} {n2[0]-n1[0]:+11.1f}p {n2[1]-n1[1]:+11.1f}p {n2[2]-n1[2]:+11.1f}p")

    print("\n[3] 지하를 못 읽어서 생기는 일 — 지하가 있는 건물인데 지하 층을 하나도 못 찾는 경우")
    miss_now = sum(1 for g in G.values() if g["fb"] > 0 and not g["now_dn"])
    miss_new = sum(1 for g in G.values() if g["fb"] > 0 and not g["new_dn"])
    has_b = sum(1 for g in G.values() if g["fb"] > 0)
    print(f"  지하가 있는 건물 {has_b:,}동")
    print(f"    지금 파싱: 지하를 못 찾은 건물 {miss_now:,}동 ({miss_now*100/max(has_b,1):.1f}%)")
    print(f"    정규화 후: {miss_new:,}동 ({miss_new*100/max(has_b,1):.1f}%)")

    print("\n[4] 뒤집혀 읽히는 층 — 지금은 지상, 정규화하면 지하")
    flip = await c.fetch("""
        SELECT floor_raw, count(*) n FROM master.floor_outline
         WHERE floor_raw IS NOT NULL GROUP BY 1 ORDER BY 2 DESC""")
    tot = 0
    print(f"  {'표기':12s} {'건수':>10s} {'지금':>6s} {'정규화':>8s}")
    for r in flip:
        a, b = now_signed(r["floor_raw"]), signed(r["floor_raw"])
        if a is not None and b is not None and a > 0 and b < 0:
            tot += r["n"]
            if r["n"] >= 5000:
                print(f"  {r['floor_raw']:12s} {r['n']:10,} {a:6d} {b:8d}")
    print(f"  → 지상으로 잘못 읽히는 지하 층 합계 {tot:,}건")

    await c.close()


if __name__ == "__main__":
    asyncio.run(main())
