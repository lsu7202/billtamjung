"""master.sanggwon_rent_series 적재 — 상권·유형·층별 분기 임대료 시계열(추세선용).

통계표 107(오피스)/205(중대형)/305(소규모)의 서울 상권 전 분기 임대료(천원/㎡).
2013~2026 분기별. 임대추세 그래프·성장률 분석용. (건물 추정과 독립 — 마스터 참조데이터)
    python scripts/rent_estimate/build_series.py
"""
import os
import asyncio
import pandas as pd
import asyncpg
from rent_common import STAT_FILE, SHEETS, _FLOOR_NORM

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")


def load_series(sheet, series):
    d = pd.read_excel(STAT_FILE, sheet_name=sheet, header=None, skiprows=3)
    qlabels = d.iloc[0].tolist()
    qcols = [(i, str(qlabels[i])) for i in range(5, d.shape[1]) if "Q" in str(qlabels[i])]
    rows = []
    for _, r in d.iloc[1:].iterrows():
        if str(r[0]) != "서울" or "임대료" not in str(r[3]):
            continue
        sg = str(r[1]).strip()
        if "소계" in sg or "합계" in sg or sg in ("nan", "계"):
            continue
        fl = _FLOOR_NORM.get(str(r[2]).strip(), str(r[2]).strip())
        for ci, ql in qcols:
            try:
                v = float(r[ci])
            except (TypeError, ValueError):
                continue
            if v != v or v <= 0:
                continue
            y = int(ql[:4]); q = int(ql.split(".")[1][0])
            rows.append((sg, series, fl, y, q, round(v, 3)))
    return rows


async def main():
    all_rows = []
    for series, sheet in SHEETS.items():
        rs = load_series(sheet, series)
        all_rows += rs
        print(f"  {series}(시트{sheet}): {len(rs)}행")
    c = await asyncpg.connect(DSN)
    await c.execute("""DROP TABLE IF EXISTS master.sanggwon_rent_series;
      CREATE TABLE master.sanggwon_rent_series(
        sanggwon text, series text, floor text, y smallint, q smallint, rate numeric,
        PRIMARY KEY(sanggwon, series, floor, y, q))""")
    await c.executemany(
        "INSERT INTO master.sanggwon_rent_series(sanggwon,series,floor,y,q,rate) VALUES($1,$2,$3,$4,$5,$6)",
        all_rows)
    await c.execute("CREATE INDEX ON master.sanggwon_rent_series(sanggwon, series, floor)")
    n = await c.fetchval("SELECT count(*) FROM master.sanggwon_rent_series")
    rng = await c.fetchrow("SELECT min(y) miny, max(y) maxy, count(DISTINCT sanggwon) sg FROM master.sanggwon_rent_series")
    print(f"적재: {n}행 · 상권 {rng['sg']}개 · {rng['miny']}~{rng['maxy']}")
    await c.close()


if __name__ == "__main__":
    asyncio.run(main())
